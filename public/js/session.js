// Orchestrates one send/receive session: signaling -> WebRTC -> TransferSession.
// The UI only reads sessionStore and calls the exported functions.
import { Signaling } from './signaling.js';
import { createPeer } from './rtc.js';
import { TransferSession } from './transfer.js';
import { sessionStore, INITIAL_SESSION, getSettings, addHistory } from './store.js';
import { saveBlob } from './storage.js';
import { encodeSignal, decodeSignal } from './lib/offline-codec.js';
import { requestCameraPermission } from './scanner.js';

const CONNECT_TIMEOUT_MS = 20000;
const ctx = { sig: null, peer: null, transfer: null, timers: [], inbox: [], channelOpen: false, t0: 0 };
const set = (p) => sessionStore.set(p);
const phase = () => sessionStore.get().phase;

function clearTimers() { ctx.timers.forEach(clearTimeout); ctx.timers = []; }

function teardown() {
  clearTimers();
  try { ctx.transfer?.dispose(); } catch { /* ignore */ }
  try { ctx.peer?.close(); } catch { /* ignore */ }
  try { ctx.sig?.close(); } catch { /* ignore */ }
  Object.assign(ctx, { sig: null, peer: null, transfer: null, inbox: [], channelOpen: false });
}

export function resetSession() {
  teardown();
  sessionStore.set({ ...INITIAL_SESSION });
}

function fail(code, message) {
  if (['done', 'failed', 'cancelled', 'rejected'].includes(phase())) return;
  clearTimers();
  const s = sessionStore.get();
  logHistory('failed', message);
  set({ phase: 'failed', error: { code, message } });
  try { ctx.peer?.close(); ctx.sig?.close(); } catch { /* ignore */ }
  void s;
}

function logHistory(status, note = '') {
  const s = sessionStore.get();
  const list = s.role === 'sender' ? s.files : s.manifest?.files || [];
  if (!list.length) return;
  addHistory({
    dir: s.role === 'sender' ? 'sent' : 'received', count: list.length,
    bytes: list.reduce((a, f) => a + f.size, 0), peer: s.peerName || '', status, note,
  });
}

function attachChannel(channel, role) {
  const settings = getSettings();
  channel.addEventListener('open', () => {
    ctx.channelOpen = true;
    clearTimers();
    set({ connectMs: Math.round(performance.now() - ctx.t0) });
  });
  const s = sessionStore.get();
  ctx.transfer = new TransferSession({
    channel, role, files: role === 'sender' ? s.files : [], deviceName: settings.deviceName,
    chunkSize: settings.chunkKB * 1024, stallMs: settings.stallSec * 1000, storagePref: settings.storagePref,
    events: {
      onManifest: (m) => set({ phase: 'awaiting-accept', manifest: m, peerName: m.name }),
      onAccepted: () => set({ phase: 'transferring' }),
      onProgress: (p) => set({ progress: p }),
      onFileDone: (entry) => {
        set({ received: [...ctx.transfer.received] });
        if (getSettings().autoSave) saveBlob(entry.blob, entry.name);
      },
      onComplete: (stats) => {
        logHistory('completed');
        set({ phase: 'done', result: stats, received: [...(ctx.transfer?.received || [])] });
        try { ctx.peer?.close(); ctx.sig?.close(); } catch { /* ignore */ }
      },
      onError: (e) => { logHistory('failed', e.message); set({ phase: 'failed', error: e }); },
      onCancel: (e) => { logHistory('cancelled'); set({ phase: 'cancelled', cancelBy: e.by }); },
      onReject: (e) => { logHistory('rejected'); set({ phase: 'rejected', rejectReason: e.reason }); },
    },
  });
}

function makePeer(role, iceServers) {
  ctx.t0 = performance.now();
  ctx.peer = createPeer({
    role, iceServers,
    sendSignal: (m) => ctx.sig?.send('signal', m),
    onChannel: (ch) => attachChannel(ch, role),
    onState: (st) => { if (st === 'failed' || st === 'closed') { if (!['done', 'cancelled', 'rejected'].includes(phase())) fail('connection', 'The connection to the other device failed. If the devices are on different networks, a relay (TURN) server is needed. See Help.'); } },
  });
  for (const m of ctx.inbox.splice(0)) ctx.peer.handleSignal(m).catch(() => {});
  ctx.timers.push(setTimeout(() => {
    if (!ctx.channelOpen) fail('connect-timeout', 'Could not open a direct connection in time. The devices may be on networks that block direct links. A relay (TURN) server is needed for this. See Help.');
  }, CONNECT_TIMEOUT_MS));
}

function wireSignaling(sig) {
  sig.on('signal', (m) => { if (ctx.peer) ctx.peer.handleSignal(m).catch(() => fail('signal', 'Connection setup failed.')); else ctx.inbox.push(m); });
  sig.on('peer:left', () => { if (!ctx.channelOpen && ['waiting', 'connecting'].includes(phase())) fail('peer-left', 'The other device left before the connection was ready.'); });
  sig.on('session:expired', () => { if (!ctx.channelOpen) fail('expired', 'The pairing code expired. Create a new code.'); });
  sig.on('disconnect', () => { if (!ctx.channelOpen && ['waiting', 'connecting'].includes(phase())) fail('signaling', 'Lost the connection to the CP Share server.'); });
}

export async function startSend(files) {
  resetSession();
  set({ role: 'sender', phase: 'creating', files });
  try {
    const sig = new Signaling();
    ctx.sig = sig;
    await sig.connect();
    wireSignaling(sig);
    let iceServers = [];
    sig.on('peer:joined', () => { set({ phase: 'connecting' }); makePeer('sender', iceServers); ctx.peer.start().catch(() => fail('offer', 'Could not start the connection.')); });
    const res = await sig.request('session:create', {});
    if (!res?.ok) throw new Error(res?.error === 'rate_limited' ? 'Too many codes requested. Wait a minute and try again.' : 'Could not create a pairing code. Try again.');
    iceServers = res.iceServers || [];
    set({ code: res.code, expiresAt: res.expiresAt, phase: 'waiting' });
  } catch (e) {
    fail('setup', e.message);
  }
}

const JOIN_ERRORS = {
  invalid: 'That code is not valid or has expired. Check it and try again.',
  expired: 'That code has expired. Ask the sender for a new one.',
  full: 'That code is already in use by another device.',
  self: 'You cannot receive your own code on the same device.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  busy: 'The server is busy. Try again shortly.',
};

export async function startReceive(code) {
  resetSession();
  set({ role: 'receiver', phase: 'creating', code });
  try {
    const sig = new Signaling();
    ctx.sig = sig;
    await sig.connect();
    wireSignaling(sig);
    const res = await sig.request('session:join', { code });
    if (!res?.ok) throw new Error(JOIN_ERRORS[res?.error] || 'Could not join. Try again.');
    set({ phase: 'connecting' });
    makePeer('receiver', res.iceServers || []);
  } catch (e) {
    fail('setup', e.message);
  }
}

export const acceptIncoming = () => ctx.transfer?.accept();
export function rejectIncoming() { ctx.transfer?.reject(); }
export function cancelTransfer() {
  if (ctx.transfer && ctx.transfer.state !== 'init') ctx.transfer.cancel();
  else { logHistory('cancelled'); set({ phase: 'cancelled', cancelBy: 'self' }); teardown(); }
}
// ---------- Offline pairing (no server, no internet): QR codes carry the connection details ----------
const offlinePeerState = (st) => {
  if (st === 'failed' || st === 'closed') {
    if (!['done', 'cancelled', 'rejected'].includes(phase())) fail('connection', 'Could not connect. Make sure both phones are on the same Wi-Fi or one is using the other\'s hotspot, then try again.');
  }
};

export async function startOfflineSend(files) {
  resetSession();
  set({ role: 'sender', phase: 'offline-prepare', files, offline: true });
  try {
    await requestCameraPermission(); // also lets the browser expose this phone's real local address
    ctx.t0 = performance.now();
    ctx.peer = createPeer({
      role: 'sender', iceServers: [], gatherAll: true,
      sendSignal: (m) => { try { set({ phase: 'offline-show-offer', offlinePayload: encodeSignal(m) }); } catch (e) { fail('offline', e.message); } },
      onChannel: (ch) => attachChannel(ch, 'sender'), onState: offlinePeerState,
    });
    await ctx.peer.start();
  } catch (e) { fail('offline', e.message); }
}

export async function offlineApplyAnswer(text) {
  try {
    const m = decodeSignal(text.trim(), 'answer');
    await ctx.peer.handleSignal(m);
    set({ phase: 'connecting' });
    ctx.timers.push(setTimeout(() => { if (!ctx.channelOpen) fail('connect-timeout', 'Could not connect in time. Make sure both phones are on the same Wi-Fi or hotspot.'); }, CONNECT_TIMEOUT_MS));
    return true;
  } catch (e) { return e.message; }
}

export async function startOfflineReceive() {
  resetSession();
  set({ role: 'receiver', phase: 'offline-scan-offer', offline: true });
  try { await requestCameraPermission(); } catch (e) { fail('offline', e.message); }
}

export async function offlineApplyOffer(text) {
  try {
    const m = decodeSignal(text.trim(), 'offer');
    ctx.t0 = performance.now();
    ctx.peer = createPeer({
      role: 'receiver', iceServers: [], gatherAll: true,
      sendSignal: (a) => { try { set({ phase: 'offline-show-answer', offlinePayload: encodeSignal(a) }); } catch (e) { fail('offline', e.message); } },
      onChannel: (ch) => attachChannel(ch, 'receiver'), onState: offlinePeerState,
    });
    ctx.timers.push(setTimeout(() => { if (!ctx.channelOpen) fail('connect-timeout', 'The sender did not scan your reply code in time. Start again.'); }, 120000));
    await ctx.peer.handleSignal(m);
    return true;
  } catch (e) { return e.message; }
}

export const isActive = () => ['creating', 'waiting', 'connecting', 'awaiting-accept', 'transferring', 'offline-prepare', 'offline-show-offer', 'offline-scan-offer', 'offline-show-answer'].includes(phase());
