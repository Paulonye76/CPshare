// CP Share transfer protocol over a single ordered RTCDataChannel.
//
// Control messages are JSON strings, file data is binary chunks:
//   sender   -> manifest {files,totalSize,name}      receiver -> accept | reject{reason}
//   sender   -> file-start{i} , chunks... , file-end{i,size,sha256}
//   receiver -> wnd{n}  (cumulative bytes processed: end-to-end flow control)
//   receiver -> file-ack{i,ok,reason}   (after SHA-256 + size verification)
//   sender   -> done                    receiver -> complete{ok}
//   either   -> cancel | error{code,message}
// A transfer is "successful" only when the RECEIVER sends complete{ok:true}.
import { Sha256 } from './lib/sha256.js';
import { sanitizeFilename, uniqueName } from './lib/filename.js';
import { openSink, storageMode, estimateFree, MEMORY_LIMIT_BYTES } from './storage.js';

export const PROTOCOL_VERSION = 1;
export const LIMITS = { maxFiles: 5000, maxFileSize: 2 ** 40, maxNameLen: 1024 };
const WINDOW_BYTES = 8 * 1024 * 1024; // max unacknowledged bytes in flight

export class TransferError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Validate an untrusted manifest. Returns {ok, files?, error?} */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || !Array.isArray(m.files)) return { ok: false, error: 'Malformed transfer request.' };
  if (m.files.length < 1 || m.files.length > LIMITS.maxFiles) return { ok: false, error: `Transfer must contain 1 to ${LIMITS.maxFiles} files.` };
  const used = new Set();
  const files = [];
  let total = 0;
  for (const f of m.files) {
    if (!f || typeof f.name !== 'string' || f.name.length > LIMITS.maxNameLen) return { ok: false, error: 'Invalid file name in request.' };
    if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > LIMITS.maxFileSize) return { ok: false, error: 'Invalid file size in request.' };
    const type = typeof f.type === 'string' ? f.type.slice(0, 100) : '';
    files.push({ name: uniqueName(sanitizeFilename(f.name), used), originalName: f.name.slice(0, 200), size: f.size, type });
    total += f.size;
  }
  return { ok: true, files, totalSize: total };
}

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'rejected']);

export class TransferSession {
  /**
   * @param {object} o
   * @param {RTCDataChannel} o.channel
   * @param {'sender'|'receiver'} o.role
   * @param {File[]} [o.files]            sender only
   * @param {string} [o.deviceName]
   * @param {number} [o.chunkSize]        bytes per message (clamped to the peer's SCTP limit)
   * @param {number} [o.stallMs]          abort if no progress for this long
   * @param {string} [o.storagePref]      'auto' | 'memory'
   * @param {number} [o.maxMessageSize]   peer SCTP limit if known (pc.sctp.maxMessageSize)
   * @param {object} [o.events]           onManifest,onAccepted,onProgress,onFileDone,onComplete,onError,onCancel,onReject
   */
  constructor({ channel, role, files = [], deviceName = 'Device', chunkSize = 65536, stallMs = 30000, acceptTimeoutMs = 120000, storagePref = 'auto', maxMessageSize = 0, events = {} }) {
    this.channel = channel;
    this.role = role;
    this.files = files;
    this.deviceName = deviceName;
    this.stallMs = stallMs;
    this.acceptTimeoutMs = acceptTimeoutMs;
    this.storagePref = storagePref;
    this.events = events;
    this.state = 'init';

    this.chunkSize = Math.max(4096, Math.min(chunkSize, 262144, maxMessageSize || 262144));
    this.highWater = Math.max(1 << 20, this.chunkSize * 8);

    this.sentBytes = 0;
    this.ackedBytes = 0;
    this.filesDone = 0;
    this.totalSize = 0;
    this.manifest = null; // receiver: validated manifest
    this.rx = null;
    this.received = [];
    this.nextFile = 0; // index of the next file-start we expect (files are pipelined)
    this.processedBytes = 0;
    this.lastReported = 0;
    this.sinks = new Set();
    this.pendingFinal = new Set();
    this.wakers = [];
    this.samples = [];
    this.peak = 0;
    this.startedAt = 0;
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
    this.curIndex = 0;

    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = this.highWater / 2;
    channel.onmessage = (e) => this._onMessage(e.data);
    channel.onbufferedamountlow = () => this._notify();
    channel.onclose = () => this._onClose();
    channel.onerror = () => {};

    this.tick = setInterval(() => this._tick(), 250);

    if (role === 'sender') {
      this.totalSize = files.reduce((a, f) => a + f.size, 0);
      this.prefix = [];
      let acc = 0;
      for (const f of files) { this.prefix.push(acc); acc += f.size; }
      this.state = 'awaiting-accept';
      if (channel.readyState === 'open') this._sendManifest();
      else channel.onopen = () => this._sendManifest();
    } else {
      this.state = 'awaiting-manifest';
    }
  }

  // ---------- helpers ----------
  _emit(name, arg) { try { this.events[name]?.(arg); } catch (e) { console.error(e); } }
  _send(obj) { this.channel.send(JSON.stringify(obj)); }
  _trySend(obj) { try { if (this.channel.readyState === 'open') this._send(obj); } catch { /* ignore */ } }
  _notify() { for (const w of this.wakers.splice(0)) w(); }
  _wake() { return new Promise((res) => { this.wakers.push(res); setTimeout(res, 250); }); }
  _active() { return this.state === 'transferring'; }
  _touch() { this.lastActivity = Date.now(); }

  _terminal(state, event, arg) {
    if (TERMINAL.has(this.state)) return;
    this.state = state;
    clearInterval(this.tick);
    this._notify();
    for (const s of this.sinks) s.abort().catch(() => {});
    this.sinks.clear();
    if (state !== 'done') this.received.forEach((r) => r.release?.());
    this._emit(event, arg);
  }

  _fail(code, message, notifyPeer = true) {
    if (TERMINAL.has(this.state)) return;
    if (notifyPeer) this._trySend({ t: 'error', code, message });
    this._terminal('failed', 'onError', { code, message });
  }

  /** Cancel from this side. */
  cancel() {
    if (TERMINAL.has(this.state)) return;
    this._trySend({ t: 'cancel' });
    this._terminal('cancelled', 'onCancel', { by: 'self' });
  }

  /** Release resources after the UI is done with the session. */
  dispose() {
    clearInterval(this.tick);
    this.received.forEach((r) => r.release?.());
    try { this.channel.close(); } catch { /* ignore */ }
  }

  // ---------- progress / watchdog ----------
  _currentBytes() {
    return this.role === 'sender' ? this.ackedBytes : this.processedBytes;
  }

  _progress() {
    const total = this.role === 'sender' ? this.totalSize : this.manifest?.totalSize || 0;
    const bytes = Math.min(this._currentBytes(), total);
    const now = Date.now();
    this.samples.push([now, bytes]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 3000) this.samples.shift();
    const [t0, b0] = this.samples[0];
    const speed = now > t0 ? ((bytes - b0) * 1000) / (now - t0) : 0;
    if (speed > this.peak) this.peak = speed;
    const list = this.role === 'sender' ? this.files : this.manifest.files;
    const idx = Math.min(this.curIndex, list.length - 1);
    let fileBytes = 0;
    if (this.role === 'sender') fileBytes = Math.max(0, Math.min(list[idx].size, bytes - this.prefix[idx]));
    else fileBytes = this.rx ? Math.min(this.rx.processed, this.rx.size) : 0;
    return {
      bytes, total, percent: total ? (bytes / total) * 100 : 100, speed,
      fileIndex: idx, fileName: list[idx]?.name || '', fileBytes, fileSize: list[idx]?.size || 0,
      filesDone: this.filesDone, filesTotal: list.length,
      etaSec: speed > 0 ? (total - bytes) / speed : null,
    };
  }

  _tick() {
    if (this.state === 'transferring') {
      this._emit('onProgress', this._progress());
      if (Date.now() - this.lastActivity > this.stallMs) {
        this._fail('timeout', 'The transfer stalled: no data was exchanged for too long. Check both devices are still connected and try again.');
      }
    } else if (this.state === 'awaiting-accept' || this.state === 'awaiting-manifest') {
      if (Date.now() - this.createdAt > this.acceptTimeoutMs) {
        this._fail('timeout', this.role === 'sender' ? 'The other device did not respond in time.' : 'No transfer request arrived in time.');
      }
    }
  }

  _onClose() {
    if (TERMINAL.has(this.state)) return;
    this._fail('connection-lost', 'The connection to the other device was lost.', false);
  }

  // ---------- sender ----------
  _sendManifest() {
    if (this.state !== 'awaiting-accept') return;
    this._send({
      t: 'manifest', v: PROTOCOL_VERSION, name: this.deviceName, totalSize: this.totalSize,
      files: this.files.map((f) => ({ name: f.name, size: f.size, type: f.type || '' })),
    });
    this._touch();
  }

  async _sendAll() {
    try {
      for (let i = 0; i < this.files.length; i++) {
        const f = this.files[i];
        this.curIndex = i;
        this._send({ t: 'file-start', i });
        const hash = new Sha256();
        const read = (o) => f.slice(o, Math.min(o + this.chunkSize, f.size)).arrayBuffer().then((b) => new Uint8Array(b));
        let off = 0;
        let pending = f.size ? read(0) : null;
        while (pending) {
          const buf = await pending;
          if (!this._active()) return;
          off += buf.length;
          pending = off < f.size ? read(off) : null; // read-ahead overlaps with hashing/sending
          hash.update(buf);
          await this._waitWindow();
          if (!this._active()) return;
          this.channel.send(buf);
          this.sentBytes += buf.length;
          this._touch();
        }
        this._send({ t: 'file-end', i, size: f.size, sha256: hash.hex() });
      }
      this._send({ t: 'done' });
    } catch (err) {
      if (!TERMINAL.has(this.state)) {
        if (err?.name === 'NotReadableError' || err?.name === 'NotFoundError') {
          this._fail('read-error', 'A selected file could not be read. It may have been moved or deleted.');
        } else {
          this._fail('send-failed', 'Sending failed. The connection may have dropped.');
        }
      }
    }
  }

  async _waitWindow() {
    while (this._active()) {
      const inflight = this.sentBytes - this.ackedBytes;
      if (inflight < WINDOW_BYTES && this.channel.bufferedAmount < this.highWater) return;
      await this._wake();
    }
  }

  // ---------- receiver ----------
  /** Receiver user pressed Accept. */
  async accept() {
    if (this.state !== 'awaiting-accept' || !this.manifest) return;
    const mode = await storageMode(this.storagePref);
    this.mode = mode;
    if (mode === 'memory') {
      const big = this.manifest.files.find((f) => f.size > MEMORY_LIMIT_BYTES);
      if (big) return this._declineStorage(`"${big.name}" is too large to receive safely in this browser mode. Open CP Share over HTTPS (or localhost) so files stream to disk, then try again.`);
    }
    const free = await estimateFree();
    if (free != null && this.manifest.totalSize > free * 0.95) {
      return this._declineStorage('Not enough free storage on this device for this transfer.');
    }
    this.state = 'transferring';
    this.startedAt = Date.now();
    this._touch();
    this._send({ t: 'accept' });
    this._emit('onAccepted', {});
  }

  _declineStorage(message) {
    this._trySend({ t: 'reject', reason: 'storage' });
    this._terminal('failed', 'onError', { code: 'storage', message });
  }

  reject() {
    if (this.state !== 'awaiting-accept') return;
    this._trySend({ t: 'reject', reason: 'declined' });
    this._terminal('rejected', 'onReject', { reason: 'declined', by: 'self' });
  }

  _addChunk(u8) {
    const rx = this.rx;
    if (!rx || rx.received + u8.length > rx.size) return this._fail('protocol', 'Received more data than announced.');
    rx.hash.update(u8); // synchronous, in arrival order
    rx.received += u8.length;
    rx.chain = rx.chain.then(async () => {
      if (!this._active()) return;
      await (await rx.sinkPromise).write(u8);
      rx.processed += u8.length;
      this.processedBytes += u8.length;
      this._touch();
      if (this.processedBytes - this.lastReported >= Math.max(this.chunkSize * 4, 524288)) {
        this.lastReported = this.processedBytes;
        this._trySend({ t: 'wnd', n: this.processedBytes });
      }
    });
    rx.chain.catch((e) => this._storageError(e));
  }

  _storageError(e) {
    if (e?.name === 'QuotaExceededError') this._fail('storage', 'This device ran out of storage during the transfer.');
    else this._fail('write-failed', 'Could not save the incoming file on this device.');
  }

  _startFile(i) {
    const f = this.manifest.files[i];
    if (!f || i !== this.nextFile || this.rx) return this._fail('protocol', 'Unexpected file order from the sender.');
    this.nextFile += 1;
    this.curIndex = i;
    const sinkPromise = openSink({ mode: this.mode, type: f.type }).then((s) => { this.sinks.add(s); return s; });
    sinkPromise.catch((e) => this._storageError(e));
    this.rx = { index: i, name: f.name, size: f.size, type: f.type, hash: new Sha256(), received: 0, processed: 0, sinkPromise, chain: Promise.resolve() };
  }

  _endFile(m) {
    const rx = this.rx;
    if (!rx || m.i !== rx.index) return this._fail('protocol', 'Unexpected end-of-file marker.');
    this.rx = null;
    const task = rx.chain.then(async () => {
      if (!this._active()) return;
      const sink = await rx.sinkPromise;
      const hex = rx.hash.hex();
      const sizeOk = rx.received === rx.size && m.size === rx.size;
      const hashOk = typeof m.sha256 === 'string' && m.sha256.toLowerCase() === hex;
      if (!sizeOk || !hashOk) {
        await sink.abort();
        this.sinks.delete(sink);
        this._trySend({ t: 'file-ack', i: rx.index, ok: false, reason: 'integrity' });
        throw new TransferError('integrity', `"${rx.name}" arrived damaged (checksum mismatch) and was discarded.`);
      }
      const blob = await sink.close();
      this.sinks.delete(sink);
      this.lastReported = this.processedBytes;
      this._trySend({ t: 'wnd', n: this.processedBytes });
      const entry = { index: rx.index, name: rx.name, size: rx.size, type: rx.type, sha256: hex, blob, release: () => sink.release() };
      this.received.push(entry);
      this.received.sort((a, b) => a.index - b.index);
      this.filesDone += 1;
      this._trySend({ t: 'file-ack', i: rx.index, ok: true });
      this._emit('onFileDone', entry);
    });
    this.pendingFinal.add(task);
    task.finally(() => this.pendingFinal.delete(task)).catch((e) => {
      if (e instanceof TransferError) this._fail(e.code, e.message);
      else this._storageError(e);
    });
  }

  async _finishReceive() {
    try {
      await Promise.all([...this.pendingFinal]);
    } catch {
      return; // already failed above
    }
    if (!this._active()) return;
    const ok = this.received.length === this.manifest.files.length && this.processedBytes === this.manifest.totalSize;
    if (!ok) return this._fail('incomplete', 'The transfer ended before all files arrived.');
    this._send({ t: 'complete', ok: true });
    const stats = this._stats();
    this._terminal('done', 'onComplete', stats);
  }

  _stats() {
    const ms = Math.max(1, Date.now() - this.startedAt);
    const bytes = this.role === 'sender' ? this.totalSize : this.manifest.totalSize;
    return { durationMs: ms, bytes, files: this.role === 'sender' ? this.files.length : this.manifest.files.length, avgSpeed: (bytes * 1000) / ms, peakSpeed: this.peak, chunkSize: this.chunkSize, storage: this.mode || null };
  }

  // ---------- inbound messages ----------
  _onMessage(data) {
    if (TERMINAL.has(this.state)) return;
    this._touch();
    if (typeof data !== 'string') {
      if (this.role !== 'receiver' || !this._active()) return this._fail('protocol', 'Unexpected binary data.');
      return this._addChunk(new Uint8Array(data));
    }
    let m;
    try { m = JSON.parse(data); } catch { return this._fail('protocol', 'Received a malformed message.'); }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return this._fail('protocol', 'Received a malformed message.');

    if (m.t === 'cancel') return this._terminal('cancelled', 'onCancel', { by: 'peer' });
    if (m.t === 'error') return this._terminal('failed', 'onError', { code: String(m.code || 'peer-error').slice(0, 40), message: String(m.message || 'The other device reported an error.').slice(0, 300) });
    return this.role === 'sender' ? this._senderMsg(m) : this._receiverMsg(m);
  }

  _senderMsg(m) {
    switch (m.t) {
      case 'accept':
        if (this.state !== 'awaiting-accept') return;
        this.state = 'transferring';
        this.startedAt = Date.now();
        this._emit('onAccepted', {});
        this._sendAll();
        break;
      case 'reject':
        if (this.state !== 'awaiting-accept') return;
        this._terminal('rejected', 'onReject', { reason: m.reason === 'storage' ? 'storage' : 'declined', by: 'peer' });
        break;
      case 'wnd':
        if (Number.isFinite(m.n) && m.n >= this.ackedBytes && m.n <= this.sentBytes) { this.ackedBytes = m.n; this._notify(); }
        break;
      case 'file-ack':
        if (m.ok === true) this.filesDone += 1;
        else this._fail('integrity', 'The other device reported that a file arrived damaged. Please try again.', false);
        break;
      case 'complete':
        if (m.ok === true && this.filesDone === this.files.length) {
          this.ackedBytes = this.totalSize;
          this._terminal('done', 'onComplete', this._stats());
        } else this._fail('incomplete', 'The other device could not confirm all files.', false);
        break;
      default:
        break; // ignore unknown messages (forward compatibility)
    }
  }

  _receiverMsg(m) {
    switch (m.t) {
      case 'manifest': {
        if (this.state !== 'awaiting-manifest') return;
        const v = validateManifest(m);
        if (!v.ok) return this._fail('protocol', v.error);
        this.manifest = { ...v, name: typeof m.name === 'string' ? m.name.slice(0, 60) : 'Unknown device' };
        this.state = 'awaiting-accept';
        this.createdAt = Date.now();
        this._emit('onManifest', this.manifest);
        break;
      }
      case 'file-start':
        if (!this._active() || !Number.isInteger(m.i)) return this._fail('protocol', 'Unexpected message from the sender.');
        this._startFile(m.i);
        break;
      case 'file-end':
        if (!this._active()) return this._fail('protocol', 'Unexpected message from the sender.');
        this._endFile(m);
        break;
      case 'done':
        if (!this._active()) return;
        this._finishReceive();
        break;
      default:
        break;
    }
  }
}
