// Local-only preferences and history (localStorage). Nothing here is a source of truth
// for money: balances and rewards will only ever come from the backend.
const SKEY = 'cpshare.settings.v1';
const HKEY = 'cpshare.history.v1';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

const DEFAULTS = { deviceName: '', chunkKB: 64, stallSec: 30, storagePref: 'auto', autoSave: true };

export function getSettings() {
  const s = { ...DEFAULTS, ...read(SKEY, {}) };
  if (!s.deviceName) {
    s.deviceName = 'CP-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    write(SKEY, s);
  }
  return s;
}
export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  write(SKEY, s);
  return s;
}

export const getHistory = () => read(HKEY, []);
export function addHistory(entry) {
  const list = [{ id: Date.now() + Math.random().toString(16).slice(2, 6), at: Date.now(), ...entry }, ...getHistory()].slice(0, 100);
  write(HKEY, list);
}
export const clearHistory = () => write(HKEY, []);

export function createStore(init) {
  let s = init;
  const subs = new Set();
  return {
    get: () => s,
    set(p) { const prev = s; s = { ...s, ...p }; subs.forEach((f) => f(s, prev)); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

export const INITIAL_SESSION = {
  role: null, phase: 'idle', code: null, expiresAt: null, peerName: null, files: [], manifest: null,
  progress: null, error: null, result: null, received: [], connectMs: null, cancelBy: null, rejectReason: null,
};
export const sessionStore = createStore({ ...INITIAL_SESSION });
