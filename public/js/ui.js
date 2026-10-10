import { esc } from './lib/format.js';

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => [...root.querySelectorAll(sel)];

export function logo(size = 40) {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="CP Share logo"><defs><linearGradient id="cpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2E2BC"/><stop offset="1" stop-color="#C79A3B"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="#0B1426"/><rect x=".75" y=".75" width="62.5" height="62.5" rx="15.25" fill="none" stroke="#2A3A5E" stroke-width="1.5"/><path d="M44 18.5A19 19 0 1 0 44 45.5" fill="none" stroke="url(#cpg)" stroke-width="6.5" stroke-linecap="round"/><path d="M28 22v21M28 22h7.5a6.5 6.5 0 0 1 0 13H28" fill="none" stroke="#F5F6FA" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  home: ic('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  send: ic('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'),
  receive: ic('<path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>'),
  wallet: ic('<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M16 13h2"/><path d="M3 10h18"/>'),
  menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
};

export function toast(msg, kind = 'info', ms = 4200) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'err' : kind === 'ok' ? 'ok' : ''}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Keep going', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<h2>${esc(title)}</h2><p class="muted">${esc(message)}</p><div class="row"><button class="btn" data-v="0">${esc(cancelText)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(confirmText)}</button></div>`;
    d.addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v != null) d.close(v); });
    d.addEventListener('close', () => { resolve(d.returnValue === '1'); d.remove(); });
    document.body.appendChild(d);
    d.showModal();
  });
}

/** Show only elements whose data-phases list contains `phase`. */
export function showPhases(root, phase) {
  for (const el of $$(root, '[data-phases]')) el.hidden = !el.dataset.phases.split(' ').includes(phase);
}

export const setText = (root, sel, text) => { const el = $(root, sel); if (el) el.textContent = text; };
export const setWidth = (root, sel, pct) => { const el = $(root, sel); if (el) el.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`; };

export const planned = (what = 'Planned feature') => `<span class="badge">${esc(what)}</span>`;
export const notice = (kind, inner) => `<div class="notice ${kind}">${inner}</div>`;

export async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, body };
}
