// Offline mode: pair two phones with QR codes (no server, no internet). Works on the same
// Wi-Fi or when one phone's hotspot is joined by the other. Needs camera + Chrome QR scanning.
import { esc, fmtBytes } from '../lib/format.js';
import { categoryOf } from '../lib/filename.js';
import { encodeQR, drawQR } from '../lib/qr.js';
import { $, showPhases, notice, toast } from '../ui.js';
import { sessionStore } from '../store.js';
import { scannerSupported, startScanner } from '../scanner.js';
import { startOfflineSend, offlineApplyAnswer, startOfflineReceive, offlineApplyOffer, cancelTransfer, resetSession } from '../session.js';

function mountScanner(root, onText) {
  let stop = null;
  const status = $(root, '#scan-status');
  const begin = async () => {
    if (stop) return;
    if (!scannerSupported()) { status.textContent = 'This browser cannot scan QR codes. Use Chrome on Android, or paste the code below.'; return; }
    try {
      let busy = false;
      stop = await startScanner($(root, '#video'), async (text) => {
        if (busy || !text.startsWith('CPS1:')) return;
        busy = true;
        const r = await onText(text);
        if (r !== true) { status.textContent = r; busy = false; }
      });
      status.textContent = 'Point the camera at the QR code.';
    } catch { status.textContent = 'Could not open the camera. Allow camera access, or paste the code below.'; }
  };
  return { begin, end: () => { stop?.(); stop = null; } };
}

function pasteBlock() {
  return `<details><summary>Camera not working? Paste the code instead</summary><div class="stack" style="padding-bottom:12px"><input id="paste" type="text" autocomplete="off" spellcheck="false" placeholder="CPS1:..."><button class="btn" id="paste-go" type="button">Use pasted code</button></div></details>`;
}

const setupQR = (root, s) => {
  const c = $(root, '#qr');
  if (c && s.offlinePayload && c.dataset.p !== s.offlinePayload) { c.dataset.p = s.offlinePayload; drawQR(c, encodeQR(s.offlinePayload, 'M'), 6); $(root, '#payload').value = s.offlinePayload; }
};

export const offlineSend = {
  title: 'Offline Send', nav: 'send',
  render: () => `<h1>Send offline</h1>
  <p class="muted">No internet needed. Both phones must be on the same Wi-Fi, or one phone's hotspot must be switched on and the other connected to it.</p>
  <div class="stack">
    <div data-phases="idle failed cancelled rejected done" class="card stack">
      <button class="btn" id="pick" type="button">Choose files</button><input type="file" id="file-input" multiple hidden>
      <div id="selected"></div>
      <button class="btn primary lg" id="go" type="button" disabled>Start offline mode</button>
      <p class="small muted center" style="margin:0"><a href="#/send">Use online mode instead</a></p>
    </div>
    <div id="err" hidden></div>
    <div data-phases="offline-prepare" hidden><div class="card center">Preparing a secure link…</div></div>
    <div data-phases="offline-show-offer" hidden class="stack">
      <div class="card center stack"><h2 style="margin:0">Step 1</h2><p class="muted" style="margin:0">On the other phone open <b>Receive → Offline mode</b> and scan this code.</p>
        <canvas id="qr" class="qr" role="img" aria-label="Pairing QR code"></canvas></div>
      <div class="card stack"><h2 style="margin:0">Step 2</h2><p class="muted" style="margin:0">Then scan the reply code shown on the other phone.</p>
        <video id="video" class="scan" muted playsinline></video><p class="small muted" id="scan-status" style="margin:0"></p>
        <button class="btn primary" id="scan" type="button">Open camera</button>
        <details><summary>Camera not working? Copy codes by hand</summary><div class="stack" style="padding-bottom:12px"><label for="payload">Your code (send it to the other phone)</label><input id="payload" type="text" readonly><label for="paste">Their reply code</label><input id="paste" type="text" autocomplete="off" spellcheck="false" placeholder="CPS1:..."><button class="btn" id="paste-go" type="button">Use reply code</button></div></details></div>
      <div class="center"><button class="btn ghost" data-act="cancel" type="button">Cancel</button></div>
    </div>
    <div data-phases="connecting" hidden><div class="card center"><b>Connecting…</b><p class="muted small">Keep both phones on the same network.</p></div></div>
  </div>`,
  mount(root) {
    let files = [];
    const input = $(root, '#file-input');
    const paint = () => {
      $(root, '#selected').innerHTML = files.length ? `<ul class="filelist">${files.map((f, i) => `<li><span class="name">${esc(f.name)}</span><span class="meta">${esc(categoryOf(f.name, f.type))} · ${fmtBytes(f.size)}</span><button class="iconbtn" data-rm="${i}" type="button" aria-label="Remove">×</button></li>`).join('')}</ul>` : '<div class="empty">No files selected yet.</div>';
      $(root, '#go').disabled = !files.length;
    };
    paint();
    const sc = mountScanner(root, (t) => offlineApplyAnswer(t));
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'pick') input.click();
      else if (b.dataset.rm != null) { files.splice(+b.dataset.rm, 1); paint(); }
      else if (b.id === 'go') startOfflineSend(files);
      else if (b.id === 'scan') sc.begin();
      else if (b.id === 'paste-go') { const r = await offlineApplyAnswer($(root, '#paste').value); if (r !== true) toast(r, 'error', 6000); }
      else if (b.dataset.act === 'cancel') { sc.end(); cancelTransfer(); resetSession(); }
    });
    input.addEventListener('change', () => { files.push(...input.files); input.value = ''; paint(); });
    const paintState = (s) => {
      showPhases(root, s.offline && s.role === 'sender' ? s.phase : 'idle');
      if (s.phase !== 'offline-show-offer') sc.end();
      setupQR(root, s);
      const err = $(root, '#err');
      if (s.offline && s.role === 'sender' && ['failed', 'cancelled', 'rejected'].includes(s.phase)) { err.hidden = false; err.innerHTML = notice('err', `<b>Could not send</b><br>${esc(s.error?.message || 'The transfer ended.')}`); } else err.hidden = true;
    };
    paintState(sessionStore.get());
    const unsub = sessionStore.subscribe(paintState);
    return () => { unsub(); sc.end(); };
  },
};

export const offlineReceive = {
  title: 'Offline Receive', nav: 'receive',
  render: () => `<h1>Receive offline</h1>
  <p class="muted">No internet needed. Both phones must be on the same Wi-Fi, or one phone's hotspot must be switched on and the other connected to it.</p>
  <div class="stack">
    <div data-phases="idle failed cancelled rejected done" class="card stack"><button class="btn primary lg" id="go" type="button">Start offline mode</button>
      <p class="small muted center" style="margin:0"><a href="#/receive">Use online mode instead</a></p></div>
    <div id="err" hidden></div>
    <div data-phases="offline-scan-offer" hidden class="card stack"><h2 style="margin:0">Step 1</h2><p class="muted" style="margin:0">On the sending phone choose <b>Send → Offline mode</b>, then scan the code it shows.</p>
      <video id="video" class="scan" muted playsinline></video><p class="small muted" id="scan-status" style="margin:0"></p>
      <button class="btn primary" id="scan" type="button">Open camera</button>${pasteBlock()}
      <button class="btn ghost" data-act="cancel" type="button">Cancel</button></div>
    <div data-phases="offline-show-answer" hidden class="stack"><div class="card center stack"><h2 style="margin:0">Step 2</h2><p class="muted" style="margin:0">Show this reply code to the sending phone and let it scan.</p>
      <canvas id="qr" class="qr" role="img" aria-label="Reply QR code"></canvas>
      <details><summary>Copy code by hand</summary><div class="stack" style="padding-bottom:12px"><input id="payload" type="text" readonly></div></details></div>
      <p class="center muted">Waiting for the sender…</p><div class="center"><button class="btn ghost" data-act="cancel" type="button">Cancel</button></div></div>
    <div data-phases="connecting" hidden><div class="card center"><b>Connecting…</b></div></div>
  </div>`,
  mount(root) {
    const sc = mountScanner(root, (t) => offlineApplyOffer(t));
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'go') startOfflineReceive();
      else if (b.id === 'scan') sc.begin();
      else if (b.id === 'paste-go') { const r = await offlineApplyOffer($(root, '#paste').value); if (r !== true) toast(r, 'error', 6000); }
      else if (b.dataset.act === 'cancel') { sc.end(); cancelTransfer(); resetSession(); }
    });
    const paintState = (s) => {
      showPhases(root, s.offline && s.role === 'receiver' ? s.phase : 'idle');
      if (s.phase !== 'offline-scan-offer') sc.end();
      setupQR(root, s);
      const err = $(root, '#err');
      if (s.offline && s.role === 'receiver' && ['failed', 'cancelled', 'rejected'].includes(s.phase)) { err.hidden = false; err.innerHTML = notice('err', `<b>Could not receive</b><br>${esc(s.error?.message || 'The transfer ended.')}`); } else err.hidden = true;
    };
    paintState(sessionStore.get());
    const unsub = sessionStore.subscribe(paintState);
    return () => { unsub(); sc.end(); };
  },
};
