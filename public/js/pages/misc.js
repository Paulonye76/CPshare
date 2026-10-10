// Profile, Settings, Help, Privacy, Terms, auth forms, Admin, Menu.
import { esc, fmtBytes } from '../lib/format.js';
import { $, $$, toast, notice, planned, getJSON, confirmDialog } from '../ui.js';
import { getSettings, saveSettings, getHistory, clearHistory } from '../store.js';
import { opfsSupported } from '../storage.js';

export const more = {
  title: 'Menu', nav: 'more',
  render: () => `<h1>Menu</h1><div class="menu">
    <a href="#/rewards-info">Reward and Payment Instructions<span>Rules</span></a><a href="#/withdraw">Withdrawal<span>Planned</span></a>
    <a href="#/history">Transaction History<span></span></a><a href="#/profile">User Profile<span></span></a><a href="#/settings">Settings<span></span></a>
    <a href="#/help">Help and Support<span></span></a><a href="#/privacy">Privacy Policy<span></span></a><a href="#/terms">Terms and Conditions<span></span></a>
    <a href="#/login">Login<span>Planned</span></a><a href="#/register">Registration<span>Planned</span></a><a href="#/admin-login">Admin Login<span>Planned</span></a></div>`,
};

export const profile = {
  title: 'User Profile', nav: 'more',
  render: () => `<h1>Profile</h1><div class="stack">
    <div class="card stack"><div class="field"><label for="dn">Device name</label><input id="dn" type="text" maxlength="30" autocomplete="off"><p class="small muted" style="margin:6px 0 0">The other device sees this name when you connect.</p></div><button class="btn primary" id="save" type="button">Save name</button></div>
    <div class="card"><h2>On this device</h2><div class="kv" id="usage"></div></div>
    <div class="card"><h2>Account</h2>${notice('dev', `${planned('Planned')} You are not signed in. Accounts (email sign-up, verification, password reset) arrive in Phase 3. <a href="#/login">Login</a> · <a href="#/register">Register</a>`)}</div></div>`,
  mount(root) {
    $(root, '#dn').value = getSettings().deviceName;
    const h = getHistory().filter((x) => x.status === 'completed');
    const sum = (d) => h.filter((x) => x.dir === d).reduce((a, x) => a + x.bytes, 0);
    $(root, '#usage').innerHTML = [['Transfers completed', h.length], ['Sent', fmtBytes(sum('sent'))], ['Received', fmtBytes(sum('received'))]].map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    $(root, '#save').addEventListener('click', () => {
      const name = $(root, '#dn').value.trim().replace(/[\u0000-\u001f<>]/g, '').slice(0, 30);
      if (!name) return toast('Enter a device name', 'error');
      saveSettings({ deviceName: name }); toast('Device name saved', 'ok');
    });
  },
};

export const settings = {
  title: 'Settings', nav: 'more',
  render: () => `<h1>Settings</h1><div class="stack"><div class="card stack">
    <div class="field"><label for="chunk">Chunk size</label><select id="chunk"><option value="16">16 KB (most compatible)</option><option value="32">32 KB</option><option value="64">64 KB (recommended)</option><option value="128">128 KB</option><option value="256">256 KB (fastest on good links)</option></select></div>
    <div class="field"><label for="stall">Stop a stalled transfer after</label><select id="stall"><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option></select></div>
    <div class="field"><label for="store">Where received files are held</label><select id="store"><option value="auto">Automatic (disk when supported)</option><option value="memory">Memory only</option></select><p class="small muted" style="margin:6px 0 0" id="store-note"></p></div>
    <label class="switch"><input type="checkbox" id="auto"> Save each file automatically when it finishes</label>
    <div class="field"><label for="cur">Display currency</label><select id="cur" disabled><option>NGN (launch currency)</option></select><p class="small muted" style="margin:6px 0 0">${planned('Planned')} Other currencies need an exchange-rate source.</p></div>
  </div><div class="card"><h2>Data on this device</h2><button class="btn danger" id="clear" type="button">Clear transfer history</button></div></div>`,
  mount(root) {
    const s = getSettings();
    $(root, '#chunk').value = String(s.chunkKB); $(root, '#stall').value = String(s.stallSec); $(root, '#store').value = s.storagePref; $(root, '#auto').checked = !!s.autoSave;
    $(root, '#store-note').textContent = opfsSupported() ? 'This browser can stream received files to disk.' : 'This page is not in a secure context (HTTPS or localhost), so received files are held in memory. Use HTTPS for large files.';
    const save = (patch) => { saveSettings(patch); toast('Saved', 'ok', 1500); };
    $(root, '#chunk').addEventListener('change', (e) => save({ chunkKB: +e.target.value }));
    $(root, '#stall').addEventListener('change', (e) => save({ stallSec: +e.target.value }));
    $(root, '#store').addEventListener('change', (e) => save({ storagePref: e.target.value }));
    $(root, '#auto').addEventListener('change', (e) => save({ autoSave: e.target.checked }));
    $(root, '#clear').addEventListener('click', async () => { if (await confirmDialog({ title: 'Clear history?', message: 'This removes the transfer list stored in this browser.', confirmText: 'Clear', cancelText: 'Cancel', danger: true })) { clearHistory(); toast('History cleared', 'ok'); } });
  },
};

const QA = [
  ['The other device cannot connect', 'Check both devices are online and the code was typed exactly. Codes expire after a few minutes and work for one device. Create a new code and try again.'],
  ['It works on Wi-Fi but not across different networks', 'Some networks block direct device links. A relay (TURN) server is needed for those cases. The server administrator configures this; see the README. Without one, cross-network transfers can fail.'],
  ['A transfer is slow', 'Speed depends on the network and both devices. Staying on the same Wi-Fi helps. Close other apps, keep both screens on, and try a larger chunk size in Settings.'],
  ['Large files fail on my phone', 'Open CP Share over HTTPS so incoming files stream to disk instead of memory. In memory-only mode each file is limited to 1 GB.'],
  ['A file did not save', 'Your browser may have blocked multiple downloads. Use the Save button next to each file on the success page, and allow downloads for this site.'],
  ['I received an app (APK)', 'Only install apps from people you trust. Android will ask for permission to install from this browser. CP Share never installs or opens files for you.'],
  ['A file arrived damaged', 'CP Share checks every file with SHA-256 and discards any that do not match. Ask the sender to send it again.'],
];
export const help = {
  title: 'Help and Support', nav: 'more',
  render: () => `<h1>Help and support</h1><div class="stack"><div>${QA.map(([q, a]) => `<details><summary>${esc(q)}</summary><p class="muted">${esc(a)}</p></details>`).join('')}</div>
    <div class="card"><h2>Contact support</h2>${notice('dev', `${planned('Planned')} Support tickets arrive with accounts. No support address is set up in this development build.`)}</div></div>`,
};

const draft = '<b>Draft for development.</b> This text describes how the prototype behaves today and must be reviewed by a qualified lawyer before public launch.';
export const privacy = {
  title: 'Privacy Policy', nav: 'more',
  render: () => `<h1>Privacy Policy</h1><div class="stack">${notice('dev', draft)}<div class="card stack">
    <h3>What stays on your devices</h3><p class="muted">Your files go from one device to the other over an encrypted WebRTC connection. When a direct link is possible they do not pass through the CP Share server. If a relay server is configured and needed, encrypted data passes through that relay.</p>
    <h3>What the server sees</h3><p class="muted">To pair devices the server handles short-lived pairing codes and connection setup messages (including network addresses needed to connect). It does not receive file names or file contents. Pairing sessions are held in memory and deleted when they end or expire.</p>
    <h3>What is stored in your browser</h3><p class="muted">Your device name, settings and a list of recent transfers (counts, sizes and results, not file names). You can clear them in Settings.</p>
    <h3>Accounts, rewards and payments</h3><p class="muted">Not available yet. When added, this policy will describe the data collected for accounts, advertising and payouts.</p></div></div>`,
};
export const terms = {
  title: 'Terms and Conditions', nav: 'more',
  render: () => `<h1>Terms and Conditions</h1><div class="stack">${notice('dev', draft)}<div class="card stack">
    <h3>Use of CP Share</h3><p class="muted">Share only files you have the right to share. Do not use CP Share for illegal content, malware or abuse.</p>
    <h3>Files from others</h3><p class="muted">Files from untrusted senders can be dangerous. You are responsible for what you accept and open.</p>
    <h3>No guarantees</h3><p class="muted">This is a prototype. Direct connections and transfer speed are not guaranteed and depend on your networks and devices.</p>
    <h3>Rewards</h3><p class="muted">Rewards are not active. If introduced, they will be subject to published rules, verification, limits and fraud checks, and can be changed or withdrawn.</p></div></div>`,
};

function authForm(kind) {
  const reg = kind === 'register';
  const admin = kind === 'admin';
  return {
    title: reg ? 'Registration' : admin ? 'Admin Login' : 'Login', nav: 'more',
    render: () => `<h1>${reg ? 'Create account' : admin ? 'Admin login' : 'Log in'}</h1><div class="stack">
      ${notice('dev', `${planned('Planned')} ${admin ? 'Admin sign-in with server-side roles' : 'Accounts'} arrive in Phase 3. This form does not send or store anything.`)}
      <form class="card stack" id="f" novalidate>
        <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="email" required></div>
        <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required></div>
        ${reg ? '<div class="field"><label for="pw2">Confirm password</label><input id="pw2" type="password" autocomplete="new-password" required></div>' : ''}
        <button class="btn primary" type="submit">${reg ? 'Create account' : 'Log in'}</button>
        <p class="small muted">${reg ? 'Have an account? <a href="#/login">Log in</a>' : admin ? '' : 'New here? <a href="#/register">Create an account</a>'}</p></form></div>`,
    mount(root) {
      $(root, '#f').addEventListener('submit', (e) => {
        e.preventDefault();
        $$(root, 'input').forEach((i) => { i.value = ''; });
        toast('Accounts are not available yet. Nothing was sent.', 'info', 5000);
      });
    },
  };
}
export const login = authForm('login');
export const register = authForm('register');
export const adminLogin = authForm('admin');

const ADMIN_WIDGETS = ['Total registered users', 'Active users', 'Total and failed transfers', 'File volume transferred', 'Advertising revenue', 'Pending and approved rewards', 'Outstanding reward liabilities', 'Withdrawal requests and failures', 'Suspicious activity', 'System health', 'Audit logs'];
export const admin = {
  title: 'Admin Dashboard', nav: 'more',
  render: () => `<h1>Admin dashboard</h1><div class="stack"><div id="gate" class="notice">Asking the server for access…</div>
    <div class="card"><h2>Planned dashboard</h2><ul class="chips">${ADMIN_WIDGETS.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
    <p class="small muted" style="margin-top:12px">Planned admin actions: review accounts and suspicious claims, review withdrawals, reconcile payments, edit reward rules, export reports and suspend accounts with an audited reason.</p></div></div>`,
  mount(root) {
    getJSON('/api/admin/summary').then(({ status }) => {
      $(root, '#gate').className = 'notice err';
      $(root, '#gate').innerHTML = status === 401 ? '<b>Access denied by the server (401).</b> Admin routes are protected on the server and nothing on this page can unlock them. Admin sign-in and roles arrive in Phase 3.' : `Unexpected response (${status}).`;
    }).catch(() => { $(root, '#gate').textContent = 'Could not reach the server.'; });
  },
};
