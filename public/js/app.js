// CP Share app shell: hash router, navigation, global session banner.
import { logo, icons, $, $$, toast } from './ui.js';
import { sessionStore } from './store.js';
import { isActive } from './session.js';
import { cleanupStaging } from './storage.js';
import * as core from './pages/core.js';
import * as rw from './pages/rewards.js';
import * as misc from './pages/misc.js';
import * as off from './pages/offline.js';

const routes = {
  '/': core.home, '/send': core.send, '/receive': core.receive, '/transfer': core.transfer, '/success': core.success,
  '/claim': rw.claim, '/wallet': rw.wallet, '/rewards-info': rw.rewardsInfo, '/withdraw': rw.withdraw, '/history': rw.history,
  '/profile': misc.profile, '/settings': misc.settings, '/help': misc.help, '/privacy': misc.privacy, '/terms': misc.terms,
  '/offline-send': off.offlineSend, '/offline-receive': off.offlineReceive, '/login': misc.login, '/register': misc.register, '/admin-login': misc.adminLogin, '/admin': misc.admin, '/more': misc.more,
};
const notFound = { title: 'Not found', nav: '', render: () => '<h1>Page not found</h1><p class="muted">That page does not exist.</p><a class="btn primary" href="#/">Go home</a>' };

const NAV = [['/', 'Home', 'home'], ['/send', 'Send', 'send'], ['/receive', 'Receive', 'receive'], ['/wallet', 'Wallet', 'wallet'], ['/more', 'More', 'menu']];
const TOP = [['/', 'Home', 'home'], ['/send', 'Send', 'send'], ['/receive', 'Receive', 'receive'], ['/wallet', 'Wallet', 'wallet'], ['/history', 'History', 'more'], ['/settings', 'Settings', 'more'], ['/help', 'Help', 'more'], ['/profile', 'Profile', 'more']];
const FOOT = [['/', 'Home'], ['/send', 'Send Files'], ['/receive', 'Receive Files'], ['/help', 'Help'], ['/privacy', 'Privacy Policy'], ['/terms', 'Terms'], ['/admin-login', 'Admin']];

const view = $(document, '#view');
let cleanup = null;

function currentRoute() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}

function paintNav(active) {
  $(document, '#tabbar').innerHTML = NAV.map(([p, l, i]) => `<a href="#${p}" ${active === (p === '/more' ? 'more' : p.slice(1) || 'home') || (p === '/' && active === 'home') ? 'aria-current="page"' : ''}>${icons[i]}<span>${l}</span></a>`).join('');
  $(document, '#topnav').innerHTML = TOP.map(([p, l, k]) => `<a href="#${p}" ${location.hash.slice(1).split('?')[0] === p || (p === '/' && !location.hash.slice(1)) ? 'aria-current="page"' : ''}>${l}</a>`).join('');
}

function route() {
  const { path, params } = currentRoute();
  const page = routes[path] || notFound;
  try { cleanup?.(); } catch (e) { console.error(e); }
  view.innerHTML = page.render();
  document.title = `${page.title} · CP Share`;
  cleanup = page.mount?.(view, params) || null;
  paintNav(page.nav);
  paintBanner();
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

function paintBanner() {
  const b = $(document, '#active-banner');
  const s = sessionStore.get();
  const { path } = currentRoute();
  const onFlow = ['/send', '/receive', '/transfer', '/offline-send', '/offline-receive'].includes(path);
  if (s.phase === 'transferring' && path !== '/transfer') { b.hidden = false; b.innerHTML = 'A transfer is in progress. <a href="#/transfer">View progress</a>'; }
  else if (['waiting', 'connecting', 'awaiting-accept', 'offline-show-offer', 'offline-scan-offer', 'offline-show-answer'].includes(s.phase) && !onFlow) { b.hidden = false; b.innerHTML = `A ${s.role === 'sender' ? 'send' : 'receive'} session is open. <a href="#/${s.offline ? 'offline-' : ''}${s.role === 'sender' ? 'send' : 'receive'}">Return</a>`; }
  else b.hidden = true;
}

// Move people to the right screen when a session changes phase.
sessionStore.subscribe((s, prev) => {
  if (s.phase !== prev.phase) {
    const { path } = currentRoute();
    const flow = ['/send', '/receive', '/offline-send', '/offline-receive'];
    if (s.phase === 'awaiting-accept' && ['/offline-send', '/offline-receive'].includes(path)) location.hash = s.role === 'sender' ? '#/send' : '#/receive';
    else if (s.phase === 'transferring' && flow.includes(path)) location.hash = '#/transfer';
    else if (s.phase === 'done' && [...flow, '/transfer'].includes(path)) location.hash = '#/success';
    else if (s.phase === 'failed') toast(s.error?.message || 'Transfer failed', 'error', 6000);
  }
  paintBanner();
});

window.addEventListener('beforeunload', (e) => { if (isActive() && sessionStore.get().phase === 'transferring') { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', route);

$(document, '#brand-logo').innerHTML = logo(36);
$(document, '#footer').innerHTML = `<nav aria-label="Footer">${FOOT.map(([p, l]) => `<a href="#${p}">${l}</a>`).join('')}</nav><p>CP Share · Share Without Limits. · Development build, not production-ready.</p>`;
cleanupStaging();
route();

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
