import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PairingStore, normalizeCode, CODE_ALPHABET } from '../server/pairing.js';
import { validateSignal } from '../server/validate.js';
import { RateLimiter } from '../server/ratelimit.js';
import { buildIceServers } from '../server/ice.js';
import { registerSocketHandlers, originAllowed } from '../server/socketHandlers.js';
import { loadConfig } from '../server/config.js';

test('codes: 8 chars from the unambiguous alphabet, normalized input', () => {
  const s = new PairingStore();
  for (let i = 0; i < 200; i++) {
    const r = s.create('s' + i);
    assert.equal(r.code.length, 8);
    assert.ok([...r.code].every((c) => CODE_ALPHABET.includes(c)));
  }
  assert.equal(normalizeCode('abcd-2345'), 'ABCD2345');
  assert.equal(normalizeCode('ABCD-234'), null);
  assert.equal(normalizeCode('ABCD-23O1'), null); // O and 1 are not in the alphabet
  assert.equal(normalizeCode({}), null);
});

test('pairing: single use, two devices max, expiry, cleanup', () => {
  let t = 1000;
  const s = new PairingStore({ codeTtlMs: 5000, pairedMaxMs: 10000, now: () => t });
  const { code } = s.create('A');
  assert.equal(s.join('WRONG123', 'B').error, 'invalid');
  assert.equal(s.join(code, 'A').error, 'self');
  assert.equal(s.join(code, 'B').ok, true);
  assert.equal(s.join(code, 'C').error, 'full');
  assert.equal(s.peerOf('A'), 'B');
  assert.equal(s.peerOf('B'), 'A');
  assert.equal(s.peerOf('C'), null);
  assert.deepEqual(s.leave('B'), { code, peer: 'A' });
  assert.equal(s.size, 0);
  assert.equal(s.join(code, 'D').error, 'invalid');

  const c2 = s.create('E').code;
  t += 5001;
  assert.equal(s.join(c2, 'F').error, 'expired');
  const c3 = s.create('G').code;
  t += 6000;
  assert.deepEqual(s.sweep().map((x) => x.code), [c3]);
  assert.equal(s.size, 0);
});

test('pairing: session limits and one session per socket', () => {
  const s = new PairingStore({ maxSessions: 2 });
  assert.ok(s.create('1').ok);
  assert.equal(s.create('1').error, 'already_in_session');
  assert.ok(s.create('2').ok);
  assert.equal(s.create('3').error, 'busy');
});

test('signal validation rejects malformed input and strips unknown fields', () => {
  assert.equal(validateSignal(null), null);
  assert.equal(validateSignal('x'), null);
  assert.equal(validateSignal({ type: 'evil' }), null);
  assert.equal(validateSignal({ type: 'offer', sdp: 'x' }), null);
  assert.equal(validateSignal({ type: 'offer', sdp: 'v'.repeat(30000) }), null);
  assert.equal(validateSignal({ type: 'candidate', candidate: { candidate: 5 } }), null);
  assert.equal(validateSignal({ type: 'candidate', candidate: { candidate: 'a', sdpMLineIndex: -1 } }), null);
  assert.deepEqual(validateSignal({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0', extra: 'x' }), { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0' });
  assert.deepEqual(validateSignal({ type: 'candidate', candidate: null }), { type: 'candidate', candidate: null });
  const c = validateSignal({ type: 'candidate', candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0, __proto__x: 1, junk: 1 } });
  assert.equal(c.candidate.junk, undefined);
});

test('rate limiter refills over time', () => {
  let t = 0;
  const r = new RateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
  assert.ok(r.consume('k') && r.consume('k'));
  assert.equal(r.consume('k'), false);
  t += 1000;
  assert.ok(r.consume('k'));
  assert.ok(r.consume('other'));
});

test('ICE servers: STUN default, TURN static or ephemeral, never leaks the secret', () => {
  const base = { stunUrls: ['stun:s'], turnUrls: [], turnSecret: '', turnTtlSeconds: 60, turnUsername: '', turnCredential: '' };
  assert.deepEqual(buildIceServers(base), [{ urls: ['stun:s'] }]);
  const st = buildIceServers({ ...base, turnUrls: ['turn:t'], turnUsername: 'u', turnCredential: 'p' });
  assert.equal(st[1].username, 'u');
  const eph = buildIceServers({ ...base, turnUrls: ['turn:t'], turnSecret: 'topsecret' }, 1_000_000);
  assert.equal(eph[1].username, '1060:cpshare');
  assert.ok(eph[1].credential && !JSON.stringify(eph).includes('topsecret'));
  assert.deepEqual(buildIceServers({ ...base, turnUrls: ['turn:t'] }), [{ urls: ['stun:s'] }]); // TURN without creds is skipped
});

test('origin check', () => {
  assert.ok(originAllowed('http://a.com', 'a.com'));
  assert.ok(!originAllowed('http://evil.com', 'a.com'));
  assert.ok(!originAllowed('not a url', 'a.com'));
  assert.ok(originAllowed('https://x.org', 'a.com', ['https://x.org']));
  assert.ok(!originAllowed('http://a.com', 'a.com', ['https://x.org']));
});

// ---- socket handler logic with a fake Socket.IO ----
function fakeIo() {
  const io = new EventEmitter();
  io.sockets = new Map();
  io.to = (id) => ({ emit: (ev, data) => io.sockets.get(id)?.received.push([ev, data]) });
  io.connect = (id, address = '1.2.3.4') => {
    const sock = new EventEmitter();
    sock.id = id;
    sock.handshake = { address, headers: {} };
    sock.received = [];
    sock.disconnected = false;
    sock.disconnect = () => { sock.disconnected = true; };
    sock.call = (ev, payload) => new Promise((res) => { sock.emit(ev, payload, res); });
    io.sockets.set(id, sock);
    io.emit('connection', sock);
    return sock;
  };
  return io;
}

test('socket flow: create, join, relay validated signals, peer-left cleanup', async () => {
  const io = fakeIo();
  const store = new PairingStore();
  const cfg = loadConfig({});
  const h = registerSocketHandlers(io, { store, config: cfg, log: { error() {} } });
  const A = io.connect('A');
  const B = io.connect('B');
  const created = await A.call('session:create', {});
  assert.ok(created.ok && created.code && Array.isArray(created.iceServers));
  const bad = await B.call('session:join', { code: 'ZZZZZZZZ' });
  assert.deepEqual(bad, { ok: false, error: 'invalid' });
  assert.equal((await B.call('session:join', 'nope')).error, 'invalid');
  const joined = await B.call('session:join', { code: created.code });
  assert.ok(joined.ok);
  assert.deepEqual(A.received.at(-1), ['peer:joined', {}]);

  assert.equal((await A.call('signal', { type: 'bogus' })).error, 'invalid_signal');
  const sdp = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1';
  assert.ok((await A.call('signal', { type: 'offer', sdp, x: 1 })).ok);
  assert.deepEqual(B.received.at(-1), ['signal', { type: 'offer', sdp }]);

  const C = io.connect('C');
  assert.equal((await C.call('signal', { type: 'offer', sdp })).error, 'no_peer'); // outsiders cannot inject

  A.emit('disconnect');
  assert.deepEqual(B.received.at(-1), ['peer:left', {}]);
  assert.equal(store.size, 0);
  h.sweep();
});

test('socket: join attempts are rate limited (code guessing)', async () => {
  const io = fakeIo();
  registerSocketHandlers(io, { store: new PairingStore(), config: loadConfig({}), log: { error() {} } });
  const B = io.connect('B');
  let limited = 0;
  for (let i = 0; i < 20; i++) if ((await B.call('session:join', { code: 'AAAAAAAA' })).error === 'rate_limited') limited++;
  assert.ok(limited >= 10);
});

test('socket: per-IP connection cap', () => {
  const io = fakeIo();
  const cfg = { ...loadConfig({}), maxConnsPerIp: 2 };
  registerSocketHandlers(io, { store: new PairingStore(), config: cfg, log: { error() {} } });
  io.connect('1'); io.connect('2');
  const third = io.connect('3');
  assert.ok(third.disconnected);
});

test('expired sessions notify both sockets on sweep', async () => {
  let t = 0;
  const io = fakeIo();
  const store = new PairingStore({ codeTtlMs: 1000, now: () => t });
  const h = registerSocketHandlers(io, { store, config: loadConfig({}), log: { error() {} } });
  const A = io.connect('A');
  await A.call('session:create', {});
  t = 2000;
  h.sweep();
  assert.deepEqual(A.received.at(-1), ['session:expired', {}]);
});
