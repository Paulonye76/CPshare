// Offline pairing end-to-end: NO signaling server at all. The sender's QR is rendered by the
// app, read back from a real screenshot with OpenCV (python3+cv2), and fed to the receiver
// (via the paste box standing in for the camera, which headless Chromium cannot aim at a QR).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
let chromium; try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright')); }
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'public');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0]; const p = path.join(root, u === '/' ? 'index.html' : decodeURIComponent(u));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const results = []; const check = (n, c, x = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const decodeShot = async (page, name) => {
  const f = `/tmp/${name}.png`; await page.locator('#qr').screenshot({ path: f });
  return execFileSync('python3', [path.join(here, '..', 'tools', 'qr_decode.py'), f]).toString();
};

const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'], acceptDownloads: true });
const snd = await ctx.newPage(); const rcv = await ctx.newPage(); const errs = [];
snd.on('pageerror', (e) => errs.push('sender ' + e.message)); rcv.on('pageerror', (e) => errs.push('receiver ' + e.message));

const files = [{ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: crypto.randomBytes(2 * 1024 * 1024 + 11) }, { name: 'note.txt', buffer: Buffer.from('offline hello') }];
await snd.goto(`${base}/#/offline-send`); await snd.reload();
await snd.setInputFiles('#file-input', files); await snd.click('#go');
await snd.waitForSelector('#qr[data-p]', { state: 'visible', timeout: 20000 });
const offer = await snd.getAttribute('#qr', 'data-p');
check('sender shows an offline QR code (no server involved)', /^CPS1:/.test(offer), offer);
console.log(`    offer code is ${offer.length} characters`);
check('offer QR read back from a screenshot matches', (await decodeShot(snd, 'offer')) === offer);

await rcv.goto(`${base}/#/offline-receive`); await rcv.reload();
await rcv.click('#go'); await rcv.waitForSelector('#video', { state: 'visible' });
await rcv.click('summary'); await rcv.fill('#paste', 'CPS1:garbage'); await rcv.click('#paste-go');
await rcv.waitForTimeout(300);
check('receiver rejects a bad code and stays on the scan step', await rcv.locator('#video').isVisible());
await rcv.fill('#paste', offer); await rcv.click('#paste-go');
await rcv.waitForSelector('#qr[data-p]', { state: 'visible', timeout: 20000 });
const answer = await rcv.getAttribute('#qr', 'data-p');
check('receiver shows a reply QR; decoded screenshot matches', (await decodeShot(rcv, 'answer')) === answer);
console.log(`    reply code is ${answer.length} characters`);

await snd.click('summary'); await snd.fill('#paste', offer); await snd.click('#paste-go');
await snd.waitForTimeout(300);
const toastText = await snd.locator('.toast').first().innerText().catch(() => '');
check('sender refuses its own offer code as a reply', /sender's code/i.test(toastText), toastText);
await snd.fill('#paste', answer); await snd.click('#paste-go');

await rcv.waitForSelector('#accept', { state: 'visible', timeout: 30000 });
check('receiver sees the incoming files after offline pairing', /photo\.jpg/.test(await rcv.locator('#incoming').innerText()));
const dls = []; rcv.on('download', (d) => dls.push(d));
await rcv.click('#accept');
await snd.waitForURL(/#\/success/, { timeout: 60000 }); await rcv.waitForURL(/#\/success/, { timeout: 60000 });
await rcv.waitForTimeout(800);
const want = Object.fromEntries(files.map((f) => [f.name, crypto.createHash('sha256').update(f.buffer).digest('hex')]));
const got = await Promise.all(dls.map(async (d) => [d.suggestedFilename(), crypto.createHash('sha256').update(fs.readFileSync(await d.path())).digest('hex')]));
check('files arrived intact over the offline link', got.length === 2 && got.every(([n, h]) => want[n] === h), JSON.stringify(got));

// ---- offline cache: second load with the network gone ----
const page = await ctx.newPage();
await page.goto(`${base}/`); await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.goto(`${base}/#/help`); await page.reload();
await page.waitForSelector('#view h1');
check('app opens with the network OFF (service worker cache)', /Help and support/i.test(await page.locator('#view h1').innerText()));
await page.goto(`${base}/#/offline-send`); await page.reload();
check('offline mode page also loads with the network OFF', /Send offline/i.test(await page.locator('#view h1').innerText()));
await ctx.setOffline(false);

await browser.close(); server.close();
check('no script errors', errs.length === 0, errs.join('; '));
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} check(s) FAILED` : '\nAll offline checks passed'); process.exit(bad ? 1 : 0);
