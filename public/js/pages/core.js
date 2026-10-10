// Home, Send, Receive, Transfer Progress, Transfer Successful.
// IMPORTANT: Send/Receive/Transfer pages show NO reward amounts, ads or payment promotions.
import { esc, fmtBytes, fmtSpeed, fmtDuration } from '../lib/format.js';
import { categoryOf, isRisky } from '../lib/filename.js';
import { logo, icons, $, $$, toast, confirmDialog, showPhases, setText, setWidth, notice, getJSON } from '../ui.js';
import { sessionStore, getSettings } from '../store.js';
import { startSend, startReceive, acceptIncoming, rejectIncoming, cancelTransfer, resetSession } from '../session.js';
import { saveBlob, storageMode } from '../storage.js';

const TYPES = ['Apps (APK files, where your device allows)', 'Photos and images', 'Videos', 'Music and audio', 'PDF documents', 'Word documents', 'Excel files', 'PowerPoint files', 'ZIP archives', 'Any other file your device can pick'];

export const home = {
  title: 'Home', nav: 'home',
  render: () => `
  <section class="hero">
    <div class="hero-logo">${logo(72)}</div>
    <h1>Share Without Limits.</h1>
    <p class="lead">CP Share sends photos, videos, music, documents and apps straight from one device to another. Pick your files, share a short code, and the other device receives them.</p>
    <div class="row"><a class="btn primary lg" href="#/send">Send Files</a><a class="btn lg" href="#/receive">Receive Files</a></div>
  </section>
  <section class="block"><h2>How it works</h2>
    <ol class="steps"><li><b>Pick files</b><br><span class="muted">Choose one or many on the sender.</span></li><li><b>Share the code</b><br><span class="muted">Type the 8-character code on the receiver.</span></li><li><b>Receive</b><br><span class="muted">The receiver accepts and the files transfer.</span></li></ol></section>
  <section class="block"><h2>What you can send</h2><ul class="chips">${TYPES.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
  <section class="block"><h2>Built for real transfers</h2>
    <div class="grid g2"><div class="card"><ul class="checks">
      <li>Direct device-to-device connection when the networks allow it.</li>
      <li>Large files are sent in small pieces, so phones do not run out of memory.</li>
      <li>Send many files in one session and watch progress for each file and overall.</li></ul></div>
    <div class="card"><ul class="checks">
      <li>Every file is checked with a SHA-256 fingerprint before it counts as received.</li>
      <li>Cancel any time from either device.</li>
      <li>A relay server can be configured for networks that block direct links.</li></ul></div></div></section>
  <section class="block"><h2>Privacy and security</h2><div class="card"><ul class="checks">
    <li>Files travel over an encrypted WebRTC connection. When a direct link works, they do not pass through the CP Share server.</li>
    <li>Pairing codes work for one receiving device and expire after a few minutes.</li>
    <li>Received files are saved, never opened or run automatically. Only accept files from people you trust. Apps and programs from strangers can be dangerous.</li>
    <li>If a direct link is impossible and a relay is set up, encrypted data passes through that relay.</li></ul>
    <p class="small muted" style="margin-top:14px">Read the <a href="#/privacy">Privacy Policy</a> and <a href="#/terms">Terms</a>.</p></div></section>`,
};

// ---------------- SEND ----------------
const PICKS = [['Apps', '.apk,.xapk'], ['Photos', 'image/*'], ['Videos', 'video/*'], ['Music', 'audio/*'], ['Documents', '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.rtf,.csv'], ['ZIP', '.zip,.rar,.7z'], ['Any file', '']];

export const send = {
  title: 'Send Files', nav: 'send',
  render: () => `
  <h1>Send files</h1>
  <p class="muted">Choose what to share, then create a code for the receiving device.</p>
  <div class="stack">
  <div id="pick-panel" data-phases="idle failed cancelled rejected done">
    <div class="card stack">
      <div class="drop" id="drop"><p><b>Choose files to send</b></p><p class="muted small">Tap a category, or drop files here.</p>
        <div class="picker" id="picker" style="justify-content:center">${PICKS.map(([l, a], i) => `<button class="btn" type="button" data-pick="${i}">${l}</button>`).join('')}</div>
        <input type="file" id="file-input" multiple hidden></div>
      <div id="selected"></div>
      <button class="btn primary lg" id="create" type="button" disabled>Create pairing code</button>
    </div>
  </div>
  <div id="err-panel" data-phases="failed cancelled rejected" hidden></div>
  <div data-phases="creating" hidden><div class="card center">Creating a secure code…</div></div>
  <div data-phases="waiting" hidden>
    <div class="ticket"><div class="muted small">Enter this code on the receiving device</div>
      <div class="code" id="code" aria-live="polite"></div>
      <div class="timer" aria-hidden="true"><i id="timer-fill"></i></div>
      <p class="muted small" style="margin-top:10px" id="expiry"></p>
      <div class="row" style="justify-content:center;margin-top:8px"><button class="btn" id="copy" type="button">Copy code</button><button class="btn" id="share" type="button">Share link</button></div></div>
    <p class="center muted" style="margin-top:14px">Waiting for the other device to join…</p>
    <div class="center"><button class="btn ghost" id="cancel-wait" type="button">Cancel</button></div>
  </div>
  <div data-phases="connecting" hidden><div class="card center"><b>Connecting to the other device…</b><p class="muted small">This usually takes a few seconds.</p><button class="btn ghost" data-act="cancel" type="button">Cancel</button></div></div>
  <div data-phases="awaiting-accept" hidden><div class="card center"><b>Connected to <span id="peer-name"></span></b><p class="muted">Waiting for them to accept your files…</p><button class="btn ghost" data-act="cancel" type="button">Cancel</button></div></div>
  </div>`,
  mount(root) {
    let files = [];
    const input = $(root, '#file-input');
    const key = (f) => `${f.name}|${f.size}|${f.lastModified}`;
    const paintSelected = () => {
      const box = $(root, '#selected');
      const total = files.reduce((a, f) => a + f.size, 0);
      box.innerHTML = files.length
        ? `<ul class="filelist">${files.map((f, i) => `<li><span class="name" title="${esc(f.name)}">${esc(f.name)}</span><span class="meta">${esc(categoryOf(f.name, f.type))} · ${fmtBytes(f.size)}</span><button class="iconbtn" type="button" data-remove="${i}" aria-label="Remove ${esc(f.name)}">×</button></li>`).join('')}</ul><p class="muted small" style="margin:10px 0 0">${files.length} file${files.length > 1 ? 's' : ''} · ${fmtBytes(total)}</p>`
        : '<div class="empty">No files selected yet.</div>';
      $(root, '#create').disabled = !files.length;
    };
    const add = (list) => {
      const seen = new Set(files.map(key));
      for (const f of list) if (!seen.has(key(f))) { files.push(f); seen.add(key(f)); }
      paintSelected();
    };
    const s0 = sessionStore.get();
    if (s0.role === 'sender' && s0.files.length) files = [...s0.files];
    paintSelected();

    root.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.pick != null) { input.accept = PICKS[+t.dataset.pick][1]; input.click(); }
      else if (t.dataset.remove != null) { files.splice(+t.dataset.remove, 1); paintSelected(); }
      else if (t.id === 'create') { startSend(files); }
      else if (t.id === 'copy') { copyText($(root, '#code').textContent.replace(/\s/g, '')).then(() => toast('Code copied', 'ok')); }
      else if (t.id === 'share') {
        const link = `${location.origin}/#/receive?code=${sessionStore.get().code}`;
        if (navigator.share) navigator.share({ title: 'CP Share', text: 'Receive my files with CP Share', url: link }).catch(() => {});
        else copyText(link).then(() => toast('Link copied', 'ok'));
      } else if (t.id === 'cancel-wait' || t.dataset.act === 'cancel') { cancelTransfer(); resetSession(); }
    });
    input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
    const drop = $(root, '#drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add([...(e.dataTransfer?.files || [])]); });

    let timer;
    const paint = (s) => {
      showPhases(root, s.role === 'sender' ? s.phase : 'idle');
      if (s.role === 'sender' && s.code) {
        setText(root, '#code', `${s.code.slice(0, 4)} ${s.code.slice(4)}`);
        setText(root, '#peer-name', s.peerName || 'the other device');
      }
      clearInterval(timer);
      if (s.role === 'sender' && s.phase === 'waiting') {
        const total = s.expiresAt - Date.now();
        const upd = () => {
          const left = Math.max(0, s.expiresAt - Date.now());
          setWidth(root, '#timer-fill', (left / total) * 100);
          setText(root, '#expiry', left ? `Code expires in ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : 'Code expired');
        };
        upd(); timer = setInterval(upd, 1000);
      }
      const ep = $(root, '#err-panel');
      if (s.role === 'sender' && ['failed', 'cancelled', 'rejected'].includes(s.phase)) {
        ep.hidden = false;
        ep.innerHTML = notice(s.phase === 'failed' ? 'err' : 'warn', `<b>${s.phase === 'failed' ? 'Transfer failed' : s.phase === 'rejected' ? 'The other device declined' : 'Transfer cancelled'}</b><br>${esc(s.error?.message || (s.phase === 'rejected' ? (s.rejectReason === 'storage' ? 'The other device does not have enough storage.' : 'The receiver chose not to accept these files.') : 'You can create a new code to try again.'))}`);
      } else if (ep) ep.hidden = true;
    };
    paint(sessionStore.get());
    const unsub = sessionStore.subscribe(paint);
    return () => { unsub(); clearInterval(timer); };
  },
};

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch { /* ignore */ } t.remove();
  }
}

// ---------------- RECEIVE ----------------
export const receive = {
  title: 'Receive Files', nav: 'receive',
  render: () => `
  <h1>Receive files</h1>
  <p class="muted">Enter the code shown on the sending device.</p>
  <div class="stack">
  <div data-phases="idle failed cancelled rejected done">
    <div class="card stack"><div><label for="code-in">Pairing code</label>
      <input id="code-in" class="codeinput" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="XXXX-XXXX" aria-describedby="code-help"></div>
      <p class="small muted" id="code-help">The code has 8 letters and numbers and is valid for a few minutes.</p>
      <button class="btn primary lg" id="connect" type="button" disabled>Connect</button></div>
  </div>
  <div id="err-panel" hidden></div>
  <div data-phases="creating connecting" hidden><div class="card center"><b>Connecting to the sender…</b><p class="muted small">This usually takes a few seconds.</p><button class="btn ghost" data-act="cancel" type="button">Cancel</button></div></div>
  <div data-phases="awaiting-accept" hidden>
    <div class="card stack"><h2>Incoming files from <span id="from"></span></h2>
      <div id="incoming"></div>
      <div id="risk" class="notice warn" hidden><b>Careful:</b> this transfer includes apps or programs. Only accept them from someone you trust. Installing unknown apps can harm your device.</div>
      <p class="small muted">Files are saved to your downloads. They are never opened or run automatically. Make sure you know the sender.</p>
      <p class="small muted" id="mode"></p>
      <div class="row"><button class="btn primary lg" id="accept" type="button">Accept</button><button class="btn lg" id="reject" type="button">Reject</button></div></div>
  </div></div>`,
  mount(root, params) {
    const input = $(root, '#code-in');
    const fmt = () => {
      const c = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      input.value = c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
      $(root, '#connect').disabled = c.length !== 8;
    };
    input.addEventListener('input', fmt);
    if (params.get('code')) { input.value = params.get('code'); fmt(); }
    const go = () => { const c = input.value.replace(/[^A-Za-z0-9]/g, ''); if (c.length === 8) startReceive(c); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.id === 'connect') go();
      else if (t.id === 'accept') { t.disabled = true; acceptIncoming(); }
      else if (t.id === 'reject') rejectIncoming();
      else if (t.dataset.act === 'cancel') { cancelTransfer(); resetSession(); }
    });
    const paint = async (s) => {
      showPhases(root, s.role === 'receiver' ? s.phase : 'idle');
      const ep = $(root, '#err-panel');
      if (s.role === 'receiver' && ['failed', 'cancelled', 'rejected'].includes(s.phase)) {
        ep.hidden = false;
        ep.innerHTML = notice(s.phase === 'failed' ? 'err' : 'warn', `<b>${s.phase === 'failed' ? 'Could not receive' : 'Transfer ended'}</b><br>${esc(s.error?.message || 'The transfer was cancelled.')}`);
      } else ep.hidden = true;
      if (s.role === 'receiver' && s.phase === 'awaiting-accept' && s.manifest) {
        setText(root, '#from', s.manifest.name);
        const total = s.manifest.files.reduce((a, f) => a + f.size, 0);
        $(root, '#incoming').innerHTML = `<ul class="filelist">${s.manifest.files.map((f) => `<li><span class="name" title="${esc(f.name)}">${esc(f.name)}</span><span class="meta">${esc(categoryOf(f.name, f.type))} · ${fmtBytes(f.size)}</span></li>`).join('')}</ul><p class="muted small" style="margin:10px 0 0">${s.manifest.files.length} file${s.manifest.files.length > 1 ? 's' : ''} · ${fmtBytes(total)}</p>`;
        $(root, '#risk').hidden = !s.manifest.files.some((f) => isRisky(f.name));
        const m = await storageMode(getSettings().storagePref);
        setText(root, '#mode', m === 'opfs' ? 'Large files are written to disk as they arrive.' : 'This browser mode keeps incoming files in memory (up to 1 GB per file). Open CP Share over HTTPS for larger files.');
      }
    };
    paint(sessionStore.get());
    const unsub = sessionStore.subscribe(paint);
    return unsub;
  },
};

// ---------------- TRANSFER PROGRESS ----------------
export const transfer = {
  title: 'Transfer Progress', nav: 'send',
  render: () => `
  <h1 id="t-title">Transfer</h1>
  <div id="t-empty" data-phases="idle" hidden><div class="empty">No transfer in progress.<div class="row" style="justify-content:center;margin-top:14px"><a class="btn primary" href="#/send">Send Files</a><a class="btn" href="#/receive">Receive Files</a></div></div></div>
  <div data-phases="creating waiting connecting awaiting-accept" hidden><div class="card center">Getting ready… <div class="row" style="justify-content:center;margin-top:12px"><a class="btn" id="back-link" href="#/send">Go to pairing</a></div></div></div>
  <div class="card stack" data-phases="transferring" hidden>
    <div><div class="muted small" id="peer-line"></div><h2 id="cur-name" style="word-break:break-all;margin-top:4px"></h2>
      <div class="bar thin" role="progressbar" aria-label="Current file" id="file-bar"><i id="file-fill"></i></div>
      <div class="stat"><span id="file-count"></span><b id="file-pct"></b></div></div>
    <div><div class="muted small">Total progress</div><div class="bar" role="progressbar" aria-label="Total progress" id="tot-bar"><i id="tot-fill"></i></div>
      <div class="stat"><span id="tot-bytes"></span><b id="tot-pct"></b></div></div>
    <div class="kv"><div><span>Speed</span><b id="speed">—</b></div><div><span>Time left</span><b id="eta">—</b></div><div><span>Files done</span><b id="done">0</b></div></div>
    <button class="btn danger" id="cancel" type="button">Cancel transfer</button>
  </div>
  <div id="t-end" hidden></div>`,
  mount(root) {
    root.addEventListener('click', async (e) => {
      if (e.target.closest('#cancel')) {
        const ok = await confirmDialog({ title: 'Cancel this transfer?', message: 'Files that have not finished will be discarded.', confirmText: 'Cancel transfer', cancelText: 'Keep going', danger: true });
        if (ok) cancelTransfer();
      }
    });
    const paint = (s) => {
      showPhases(root, s.phase);
      setText(root, '#t-title', s.role === 'receiver' ? 'Receiving files' : 'Sending files');
      $(root, '#back-link').setAttribute('href', s.role === 'receiver' ? '#/receive' : '#/send');
      const end = $(root, '#t-end');
      if (['failed', 'cancelled', 'rejected'].includes(s.phase)) {
        end.hidden = false;
        const msg = s.phase === 'failed' ? s.error?.message : s.phase === 'cancelled' ? (s.cancelBy === 'peer' ? 'The other device cancelled the transfer.' : 'You cancelled the transfer.') : 'The transfer was declined.';
        end.innerHTML = `${notice(s.phase === 'failed' ? 'err' : 'warn', `<b>${s.phase === 'failed' ? 'Transfer failed' : 'Transfer stopped'}</b><br>${esc(msg)}`)}<div class="row" style="margin-top:14px"><a class="btn primary" href="${s.role === 'receiver' ? '#/receive' : '#/send'}" id="retry">Try again</a><a class="btn" href="#/">Home</a></div><p class="small muted">Troubleshooting tips are in <a href="#/help">Help</a>.</p>`;
        $(end, '#retry').addEventListener('click', () => resetSession());
      } else end.hidden = true;
      const p = s.progress;
      if (s.phase === 'transferring' && p) {
        setText(root, '#peer-line', s.role === 'receiver' ? `From ${s.peerName || 'sender'}` : `To ${s.peerName || 'receiver'}`);
        setText(root, '#cur-name', p.fileName);
        setWidth(root, '#file-fill', p.fileSize ? (p.fileBytes / p.fileSize) * 100 : 100);
        setText(root, '#file-count', `File ${Math.min(p.fileIndex + 1, p.filesTotal)} of ${p.filesTotal} · ${fmtBytes(p.fileBytes)} / ${fmtBytes(p.fileSize)}`);
        setText(root, '#file-pct', `${p.fileSize ? Math.floor((p.fileBytes / p.fileSize) * 100) : 100}%`);
        setWidth(root, '#tot-fill', p.percent);
        setText(root, '#tot-bytes', `${fmtBytes(p.bytes)} of ${fmtBytes(p.total)}`);
        setText(root, '#tot-pct', `${Math.floor(p.percent)}%`);
        setText(root, '#speed', fmtSpeed(p.speed));
        setText(root, '#eta', p.etaSec != null && isFinite(p.etaSec) ? fmtDuration(p.etaSec * 1000) : '—');
        setText(root, '#done', `${p.filesDone}/${p.filesTotal}`);
        $(root, '#file-bar').setAttribute('aria-valuenow', Math.floor(p.fileSize ? (p.fileBytes / p.fileSize) * 100 : 100));
        $(root, '#tot-bar').setAttribute('aria-valuenow', Math.floor(p.percent));
      }
    };
    paint(sessionStore.get());
    return sessionStore.subscribe(paint);
  },
};

// ---------------- TRANSFER SUCCESSFUL ----------------
export const success = {
  title: 'Transfer Successful', nav: 'send',
  render: () => `
  <div id="s-empty" hidden><div class="empty">There is no finished transfer to show.<div class="row" style="justify-content:center;margin-top:14px"><a class="btn primary" href="#/send">Send Files</a><a class="btn" href="#/receive">Receive Files</a></div></div></div>
  <div id="s-body" hidden>
    <div class="success"><div class="check">${icons.check.replace('currentColor', '#5FCB9A')}</div><h1>TRANSFER SUCCESSFUL!</h1><p class="muted">Your files have been shared successfully.</p></div>
    <div class="stack">
      <div class="kv" id="stats"></div>
      <div id="saved" class="card" hidden><h2>Received files</h2><ul class="filelist" id="saved-list"></ul>
        <p class="small muted" style="margin:12px 0 0">Files are saved through your browser's downloads. They are never opened automatically. Scan files from unknown senders before opening them.</p></div>
      <div id="reward-slot"></div>
      <div class="row"><a class="btn primary" href="#/" id="done-btn">Done</a><a class="btn" href="#/send">Send more</a></div>
    </div></div>`,
  mount(root) {
    const s = sessionStore.get();
    if (s.phase !== 'done' || !s.result) { $(root, '#s-empty').hidden = false; return; }
    $(root, '#s-body').hidden = false;
    const r = s.result;
    $(root, '#stats').innerHTML = [
      ['Files', r.files], ['Total size', fmtBytes(r.bytes)], ['Time', fmtDuration(r.durationMs)], ['Average speed', fmtSpeed(r.avgSpeed)],
      ['Peak speed', fmtSpeed(r.peakSpeed)], ['Connected in', s.connectMs != null ? `${s.connectMs} ms` : '—'],
    ].map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    if (s.role === 'receiver') {
      $(root, '#saved').hidden = false;
      $(root, '#saved-list').innerHTML = s.received.map((f, i) => `<li><span class="name">${esc(f.name)}</span><span class="meta">${fmtBytes(f.size)}</span><button class="btn" style="min-height:40px;padding:0 14px" data-save="${i}" type="button">Save</button></li>`).join('');
      root.addEventListener('click', (e) => { const b = e.target.closest('[data-save]'); if (b) { const f = sessionStore.get().received[+b.dataset.save]; if (f) saveBlob(f.blob, f.name); } });
    } else {
      // The server decides eligibility. We never assume it.
      getJSON('/api/rewards/eligibility').then(({ body }) => {
        $(root, '#reward-slot').innerHTML = body?.eligible === true
          ? `<div class="center"><a class="btn primary lg" href="#/claim">CLAIM REWARD</a></div>`
          : notice('dev', `<b>Development build:</b> rewards are not active, so there is nothing to claim. ${esc(body?.message || '')}`);
      }).catch(() => { $(root, '#reward-slot').innerHTML = notice('dev', '<b>Development build:</b> rewards are not active.'); });
    }
    $(root, '#done-btn').addEventListener('click', () => { /* keep received blobs until user leaves success page */ });
    return () => { if (sessionStore.get().phase === 'done') resetSession(); };
  },
};
