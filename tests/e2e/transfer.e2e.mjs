// End-to-end test of the REAL transfer engine: two browser pages, real RTCPeerConnection
// + RTCDataChannel, real chunking/backpressure/SHA-256. Only the signaling relay is
// bridged in-process (the Socket.IO server is covered separately by unit tests).
//
//   npm i -D playwright && npx playwright install chromium
//   node tests/e2e/transfer.e2e.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire(import.meta.url);
  ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright'));
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });

// Runs inside each page.
const pageInit = async ({ role, opts }) => {
  const { createPeer } = await import('/js/rtc.js');
  const { TransferSession } = await import('/js/transfer.js');
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const sha = async (blob) => hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const mk = (size) => { const u = new Uint8Array(size); for (let o = 0; o < size; o += 65536) crypto.getRandomValues(u.subarray(o, Math.min(o + 65536, size))); return u; };
  const files = (opts.files || []).map((f) => new File([mk(f.size)], f.name, { type: f.type || '' }));
  const w = window;
  w.__events = [];
  w.__progress = 0;
  let resolveDone;
  w.__done = new Promise((r) => { resolveDone = r; });
  const finish = (kind, data) => { w.__events.push(kind); resolveDone({ kind, data }); };

  const events = {
    onManifest: (m) => {
      w.__events.push('manifest');
      w.__manifest = m;
      setTimeout(() => (opts.decision === 'reject' ? w.__session.reject() : w.__session.accept()), 50);
    },
    onAccepted: () => w.__events.push('accepted'),
    onProgress: (p) => { w.__progress = p.percent; w.__lastProgress = p; },
    onFileDone: (f) => w.__events.push('file:' + f.name),
    onComplete: async (stats) => {
      const out = role === 'receiver' ? await Promise.all(w.__session.received.map(async (r) => ({ name: r.name, size: r.size, sha: await sha(r.blob) }))) : await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, sha: await sha(f) })));
      finish('complete', { stats, files: out });
    },
    onError: (e) => finish('error', e),
    onCancel: (e) => finish('cancel', e),
    onReject: (e) => finish('reject', e),
  };

  const peer = createPeer({
    role,
    iceServers: [],
    sendSignal: (m) => w.__out(m),
    onState: (s) => { w.__state = s; },
    onChannel: (ch) => {
      if (opts.tamper) {
        const orig = ch.send.bind(ch);
        let n = 0;
        ch.send = (d) => { if (typeof d !== 'string' && ++n === opts.tamper) { d = new Uint8Array(d); d[0] ^= 0xff; } return orig(d); };
      }
      w.__session = new TransferSession({ channel: ch, role, files, deviceName: role + '-dev', chunkSize: opts.chunkSize || 65536, storagePref: opts.storage || 'auto', stallMs: 15000, events });
    },
  });
  w.__peer = peer;
  w.__in = (m) => peer.handleSignal(m);
  if (role === 'sender') w.__sha = Promise.all(files.map((f) => sha(f)));
  if (role === 'sender') setTimeout(() => peer.start(), 0);
};

async function scenario(name, { sender = {}, receiver = {}, during, expectSender, expectReceiver }) {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const b = await ctx.newPage();
  a.on('pageerror', (e) => console.log('  [sender pageerror]', e.message));
  b.on('pageerror', (e) => console.log('  [receiver pageerror]', e.message));
  await a.goto(base + '/'); await b.goto(base + '/');
  await a.exposeFunction('__out', (m) => { b.evaluate((x) => window.__in?.(x), m).catch(() => {}); });
  await b.exposeFunction('__out', (m) => { a.evaluate((x) => window.__in?.(x), m).catch(() => {}); });
  // receiver first so it's ready to answer, then the sender starts negotiation
  await b.evaluate(pageInit, { role: 'receiver', opts: receiver });
  await a.evaluate(pageInit, { role: 'sender', opts: sender });
  if (during) during({ a, b });
  const [sa, sb] = await Promise.all([
    a.evaluate(() => Promise.race([window.__done, new Promise((r) => setTimeout(() => r({ kind: 'test-timeout' }), 90000))])),
    b.evaluate(() => Promise.race([window.__done, new Promise((r) => setTimeout(() => r({ kind: 'test-timeout' }), 90000))])),
  ]);
  const extra = { a, b };
  let ok = true;
  const check = (cond, msg) => { if (!cond) { ok = false; console.log('  ✗', msg); } };
  expectSender?.(sa, check, extra);
  expectReceiver?.(sb, check, extra);
  if (sa.kind === 'error' || sb.kind === 'error') console.log('    errors:', JSON.stringify({ sender: sa.data, receiver: sb.data }));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}   (sender=${sa.kind}, receiver=${sb.kind})`);
  await ctx.close();
  return { ok, sa, sb };
}

const MB = 1024 * 1024;
const manyFiles = [
  { name: 'empty.txt', size: 0 },
  { name: 'one.bin', size: 1 },
  { name: 'photo.jpg', size: 300 * 1024 + 17, type: 'image/jpeg' },
  { name: 'photo.jpg', size: 4096, type: 'image/jpeg' },        // duplicate name
  { name: '../../evil.exe', size: 2048 },                         // path traversal attempt
  { name: 'movie.mp4', size: 40 * MB + 123, type: 'video/mp4' }, // multi-chunk, backpressure
];

const results = [];
const verifyFull = (sa, check, { }) => {};
for (const storage of ['auto', 'memory']) {
  results.push(await scenario(`multi-file transfer, integrity, safe names (receiver storage=${storage})`, {
    sender: { files: manyFiles }, receiver: { storage },
    expectSender: (s, check) => check(s.kind === 'complete', 'sender should complete only after receiver confirmation'),
    expectReceiver: (s, check) => {
      check(s.kind === 'complete', 'receiver should complete');
      if (s.kind !== 'complete') return;
      const got = s.data.files;
      check(got.length === manyFiles.length, `expected ${manyFiles.length} files, got ${got.length}`);
      const names = got.map((f) => f.name);
      check(new Set(names.map((n) => n.toLowerCase())).size === names.length, 'names must be unique: ' + names.join(', '));
      check(!names.some((n) => /[\\/]/.test(n)), 'no path separators in saved names: ' + names.join(', '));
      check(names.includes('photo.jpg') && names.includes('photo (1).jpg'), 'duplicate filename must be renamed: ' + names.join(', '));
      check(names.includes('evil.exe'), 'traversal name must be flattened: ' + names.join(', '));
      check(s.data.stats.storage === (storage === 'memory' ? 'memory' : 'opfs'), `storage mode was ${s.data.stats.storage}`);
      console.log(`    ${(s.data.stats.bytes / MB).toFixed(1)} MB in ${s.data.stats.durationMs} ms, avg ${(s.data.stats.avgSpeed / MB).toFixed(1)} MB/s, storage=${s.data.stats.storage}`);
    },
  }));
}

// cross-check hashes sent vs received (independent WebCrypto SHA-256) in a dedicated run
{
  let senderFiles, receiverFiles;
  const r = await scenario('sender and receiver SHA-256 (WebCrypto) match for every file', {
    sender: { files: manyFiles.slice(0, 5) }, receiver: {},
    expectSender: (s) => { senderFiles = s.data?.files; },
    expectReceiver: (s) => { receiverFiles = s.data?.files; },
  });
  let ok = r.ok && senderFiles && receiverFiles && senderFiles.every((f, i) => f.sha === receiverFiles[i].sha && f.size === receiverFiles[i].size);
  console.log(`${ok ? 'PASS' : 'FAIL'}  hash cross-check`);
  results.push({ ok });
}

results.push(await scenario('receiver rejects the transfer', {
  sender: { files: [{ name: 'a.txt', size: 1000 }] }, receiver: { decision: 'reject' },
  expectSender: (s, c) => c(s.kind === 'reject', 'sender should see rejection'),
  expectReceiver: (s, c) => c(s.kind === 'reject', 'receiver should end as rejected'),
}));

results.push(await scenario('corrupted chunk is detected and the file is discarded', {
  sender: { files: [{ name: 'big.bin', size: 5 * MB }], tamper: 20 }, receiver: {},
  expectSender: (s, c) => c(s.kind === 'error', 'sender must not report success (got ' + s.kind + ')'),
  expectReceiver: (s, c) => c(s.kind === 'error' && s.data.code === 'integrity', 'receiver must flag integrity failure (got ' + JSON.stringify(s) + ')'),
}));

results.push(await scenario('sender cancels mid-transfer', {
  sender: { files: [{ name: 'big.bin', size: 120 * MB }] }, receiver: {},
  during: ({ a }) => { (async () => { for (;;) { await new Promise((r) => setTimeout(r, 100)); const p = await a.evaluate(() => window.__progress).catch(() => 0); if (p > 5) { await a.evaluate(() => window.__session.cancel()); return; } } })(); },
  expectSender: (s, c) => c(s.kind === 'cancel' && s.data.by === 'self', 'sender cancelled'),
  expectReceiver: (s, c) => c(s.kind === 'cancel' && s.data.by === 'peer', 'receiver must be told about the cancel'),
}));

results.push(await scenario('connection lost mid-transfer is reported as an error on the receiver', {
  sender: { files: [{ name: 'big.bin', size: 120 * MB }] }, receiver: {},
  during: ({ a, b }) => { (async () => { for (;;) { await new Promise((r) => setTimeout(r, 100)); const p = await b.evaluate(() => window.__progress).catch(() => 0); if (p > 5) { await a.evaluate(() => window.__peer.close()); return; } } })(); },
  expectSender: (s, c) => c(s.kind === 'error', 'sender gets error (got ' + s.kind + ')'),
  expectReceiver: (s, c) => c(s.kind === 'error', 'receiver gets error, never "complete" (got ' + s.kind + ')'),
}));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nAll end-to-end scenarios passed');
process.exit(failed ? 1 : 0);
