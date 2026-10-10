import { randomInt } from 'node:crypto';

// 32 symbols, no I/O/0/1 to avoid misreading. 8 chars = 40 bits of entropy.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

export function normalizeCode(input) {
  if (typeof input !== 'string' || input.length > 32) return null;
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}

/**
 * In-memory pairing sessions. One sender + at most one receiver per code.
 * A code is single-use: once a receiver joins, nobody else can join.
 * If either side leaves, the session is destroyed (create a new code).
 */
export class PairingStore {
  constructor({ codeTtlMs = 300000, pairedMaxMs = 7200000, maxSessions = 5000, now = () => Date.now(), rand = randomInt } = {}) {
    this.codeTtlMs = codeTtlMs;
    this.pairedMaxMs = pairedMaxMs;
    this.maxSessions = maxSessions;
    this.now = now;
    this.rand = rand;
    this.sessions = new Map(); // code -> session
    this.bySocket = new Map(); // socketId -> code
  }

  get size() {
    return this.sessions.size;
  }

  _generateCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      let c = '';
      for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[this.rand(CODE_ALPHABET.length)];
      if (!this.sessions.has(c)) return c;
    }
    throw new Error('code_generation_failed');
  }

  create(socketId) {
    if (this.bySocket.has(socketId)) return { ok: false, error: 'already_in_session' };
    if (this.sessions.size >= this.maxSessions) return { ok: false, error: 'busy' };
    const code = this._generateCode();
    const t = this.now();
    const session = { code, sender: socketId, receiver: null, createdAt: t, expiresAt: t + this.codeTtlMs };
    this.sessions.set(code, session);
    this.bySocket.set(socketId, code);
    return { ok: true, code, expiresAt: session.expiresAt };
  }

  join(rawCode, socketId) {
    const code = normalizeCode(rawCode);
    if (!code) return { ok: false, error: 'invalid' };
    const s = this.sessions.get(code);
    if (!s) return { ok: false, error: 'invalid' };
    if (s.receiver) return { ok: false, error: 'full' };
    if (this.now() >= s.expiresAt) {
      this._delete(s);
      return { ok: false, error: 'expired' };
    }
    if (s.sender === socketId) return { ok: false, error: 'self' };
    if (this.bySocket.has(socketId)) return { ok: false, error: 'already_in_session' };
    s.receiver = socketId;
    s.expiresAt = this.now() + this.pairedMaxMs;
    this.bySocket.set(socketId, code);
    return { ok: true, code, sender: s.sender };
  }

  peerOf(socketId) {
    const s = this.sessions.get(this.bySocket.get(socketId));
    if (!s || !s.receiver) return null;
    return s.sender === socketId ? s.receiver : s.sender;
  }

  _delete(s) {
    this.sessions.delete(s.code);
    this.bySocket.delete(s.sender);
    if (s.receiver) this.bySocket.delete(s.receiver);
  }

  /** Remove the session this socket belongs to. Returns the other socket id (if any). */
  leave(socketId) {
    const code = this.bySocket.get(socketId);
    if (!code) return null;
    const s = this.sessions.get(code);
    if (!s) {
      this.bySocket.delete(socketId);
      return null;
    }
    const peer = s.sender === socketId ? s.receiver : s.sender;
    this._delete(s);
    return { code, peer };
  }

  /** Remove expired sessions. Returns [{code, sockets}] so callers can notify. */
  sweep() {
    const t = this.now();
    const removed = [];
    for (const s of [...this.sessions.values()]) {
      if (t >= s.expiresAt) {
        removed.push({ code: s.code, sockets: [s.sender, s.receiver].filter(Boolean) });
        this._delete(s);
      }
    }
    return removed;
  }
}
