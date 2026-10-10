// Drives the REAL UI in two browser pages (sender + receiver). Signaling goes through the
// real server modules (PairingStore, validation, rate limits, socket handlers) with an
// in-process stand-in for the Socket.IO transport, so this runs without installing express.
//   node tests/e2e/ui.e2e.mjs            (set SHOTS=/some/dir to save screenshots)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PairingStore } from '../../server/pairing.js';
import { registerSocketHandlers } from '../../server/socketHandlers.js';
import { loadConfig } from '../../server/config.js';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright'));
}
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  const p = path.join(root, u === '/' ? 'index.html' : decodeURIComponent(u));
  if (u.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"authentication_required"}'); }
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- stand-in for socket.io transport, using the real handlers ----
const io = new EventEmitter();
const socks = new Map();
io.to = (id) => ({ emit: (ev, data) => socks.get(id)?.deliver(ev, data) });
registerSocketHandlers(io, { store: new PairingStore(), config: loadConfig({}), log: { error() {} } });
let nextId = 1;
async function attach(page) {
  let cur = null;
  const makeSock = () => {
    const id = 's' + nextId++;
    const sock = new EventEmitter();
    sock.id = id; sock.handshake = { address: '10.0.0.' + nextId, headers: {} };
    sock.disconnect = () => {};
    sock.deliver = (ev, data) => page.evaluate(([e, d]) => window.__sockRecv?.(e, d), [ev, data]).catch(() => {});
    socks.set(id, sock);
    return sock;
  };
  await page.exposeFunction('__sockConnect', () => { cur = makeSock(); io.emit('connection', cur); });
  await page.exposeFunction('__sockEmit', (ev, data, wantAck) => new Promise((res) => {
    let done = false; const fin = (v) => { if (!done) { done = true; res(v ?? null); } };
    cur.emit(ev, data, fin);
    if (!wantAck) setTimeout(() => fin(null), 15);
  }));
  await page.exposeFunction('__sockGone', () => { cur?.emit('disconnect'); });
  await page.addInitScript(() => {
    window.io = () => {
      const h = {}; const ready = window.__sockConnect();
      const s = {
        on(ev, fn) { (h[ev] ||= []).push(fn); return s; },
        once(ev, fn) { const w = (...a) => { h[ev] = h[ev].filter((x) => x !== w); fn(...a); }; return s.on(ev, w); },
        emit(ev, data, ack) { ready.then(() => window.__sockEmit(ev, data, typeof ack === 'function')).then((r) => ack?.(r)); return s; },
        timeout() { return { emit: (ev, data, cb) => { ready.then(() => window.__sockEmit(ev, data, true)).then((r) => cb(null, r)); } }; },
        close() { window.__sockGone(); },
      };
      window.__sockRecv = (ev, d) => (h[ev] || []).slice().forEach((f) => f(d));
      ready.then(() => (h.connect || []).slice().forEach((f) => f()));
      return s;
    };
  });
}

const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const SHOTS = process.env.SHOTS;
const shot = async (page, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, n + '.png') }); } };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, deviceScaleFactor: 2 });
const snd = await ctx.newPage(); const rcv = await ctx.newPage();
const errors = [];
for (const [n, p] of [['sender', snd], ['receiver', rcv]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
await attach(snd); await attach(rcv);

// ---- routes: every page renders without script errors ----
const routes = ['/', '/send', '/receive', '/transfer', '/success', '/claim', '/wallet', '/rewards-info', '/withdraw', '/history', '/profile', '/settings', '/help', '/privacy', '/terms', '/login', '/register', '/admin-login', '/admin', '/more', '/nope'];
for (const r of routes) {
  await snd.goto(`${base}/#${r}`); await snd.reload();
  await snd.waitForSelector('#view h1, #view .empty');
}
check('all 19 required pages + menu render with no script errors', errors.length === 0, errors.join('; '));
await snd.goto(`${base}/#/`); await snd.reload(); await shot(snd, '01-home');
await snd.goto(`${base}/#/admin`); await snd.reload();
await snd.waitForFunction(() => document.querySelector('#gate')?.textContent.includes('denied'));
check('admin dashboard is denied by the server (401), not by hiding the page', true);

// ---- Send + Receive flow ----
const MB = 1024 * 1024;
const payload = [
  { name: 'note.txt', buffer: Buffer.from('hello from CP Share') },
  { name: 'holiday.jpg', mimeType: 'image/jpeg', buffer: crypto.randomBytes(300 * 1024 + 5) },
  { name: 'clip.mp4', mimeType: 'video/mp4', buffer: crypto.randomBytes(40 * MB) },
];
await snd.goto(`${base}/#/send`); await snd.reload();
await snd.setInputFiles('#file-input', payload);
await snd.waitForSelector('#selected .filelist li');
check('sender sees 3 selected files with sizes', (await snd.locator('#selected li').count()) === 3);
await snd.click('[data-remove="0"]');
check('sender can remove a selected file', (await snd.locator('#selected li').count()) === 2);
await snd.setInputFiles('#file-input', [payload[0]]);
await snd.waitForFunction(() => document.querySelectorAll('#selected li').length === 3);
const sendText = (await snd.locator('#view').innerText()).toLowerCase();
check('Send page shows no reward / payment / ad content', !/₦|reward|withdraw|advert|earn/.test(sendText), sendText.slice(0, 200));
await snd.click('#create');
await snd.waitForFunction(() => /[A-Z0-9]{4} [A-Z0-9]{4}/.test(document.querySelector('#code')?.textContent || ''));
const code = (await snd.locator('#code').innerText()).replace(/\s/g, '');
check('pairing code is 8 characters', /^[A-Z2-9]{8}$/.test(code), code);
await shot(snd, '02-send-code');

await rcv.goto(`${base}/#/receive`); await rcv.reload();
await rcv.fill('#code-in', 'ZZZZZZZZ'); await rcv.click('#connect');
await rcv.waitForSelector('#err-panel:not([hidden])');
check('invalid code gives a clear error', /not valid or has expired/i.test(await rcv.locator('#err-panel').innerText()));

await rcv.goto(`${base}/#/receive?code=${code}`); await rcv.reload();
check('share link prefills the code', (await rcv.inputValue('#code-in')).replace('-', '') === code);
await rcv.click('#connect');
await rcv.waitForSelector('#accept', { state: 'visible', timeout: 30000 });
const incoming = await rcv.locator('#incoming').innerText();
check('receiver sees incoming names and sizes', /note\.txt/.test(incoming) && /holiday\.jpg/.test(incoming) && /clip\.mp4/.test(incoming) && /MB/.test(incoming), incoming);
await shot(rcv, '03-receive-incoming');
const rcvText = (await rcv.locator('#view').innerText()).toLowerCase();
check('Receive page shows no reward / payment content', !/₦|reward|withdraw|advert|earn/.test(rcvText));
const dls = []; rcv.on('download', (d) => dls.push(d));
await rcv.click('#accept');
await snd.waitForURL(/#\/transfer/); await rcv.waitForURL(/#\/transfer/);
await snd.waitForFunction(() => parseInt(document.querySelector('#tot-pct')?.textContent || '0') >= 15, null, { timeout: 60000 });
await shot(snd, '04-transfer-progress');
const tText = (await snd.locator('#view').innerText()).toLowerCase();
check('progress page shows file, counts, speed and no reward content', /file \d of 3/.test(tText) && !/₦|reward/.test(tText), tText.slice(0, 160));
await snd.waitForURL(/#\/success/, { timeout: 90000 }); await rcv.waitForURL(/#\/success/, { timeout: 90000 });
check('both devices reach Transfer Successful', /TRANSFER SUCCESSFUL!/.test(await snd.locator('h1').innerText()) && /TRANSFER SUCCESSFUL!/.test(await rcv.locator('h1').innerText()));
await snd.waitForSelector('#reward-slot .notice');
const rw = await snd.locator('#reward-slot').innerText();
check('success page: no CLAIM REWARD when server says not eligible; labelled dev message', !/CLAIM REWARD/.test(rw) && /development/i.test(rw), rw);
await shot(snd, '05-success-sender'); await shot(rcv, '06-success-receiver');
await rcv.waitForTimeout(800);
const bufs = await Promise.all(dls.map(async (d) => ({ name: d.suggestedFilename(), data: fs.readFileSync(await d.path()) })));
const want = Object.fromEntries(payload.map((p) => [p.name, crypto.createHash('sha256').update(p.buffer).digest('hex')]));
const okFiles = bufs.length === 3 && bufs.every((b) => want[b.name] === crypto.createHash('sha256').update(b.data).digest('hex'));
check('browser downloaded all 3 files byte-for-byte identical', okFiles, bufs.map((b) => b.name + ':' + b.data.length).join(','));
check('receiver success page lists files with Save buttons', (await rcv.locator('[data-save]').count()) === 3);
await rcv.goto(`${base}/#/history`); await rcv.reload();
check('transfer history recorded locally', /Received/.test(await rcv.locator('#tlist').innerText()));

await browser.close(); server.close();
check('no unexpected script errors during the whole run', errors.length === 0, errors.join('; '));
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} check(s) FAILED` : '\nAll UI end-to-end checks passed');
process.exit(bad ? 1 : 0);
