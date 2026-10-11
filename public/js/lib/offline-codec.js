// Offline pairing codec: squeezes a data-channel-only WebRTC session description into
// ~100-150 bytes so it fits a small QR code, and rebuilds a standard SDP from it.
// Only IPv4 host addresses are used (same Wi-Fi / hotspot). No server and no STUN involved.
const PREFIX = 'CPS1:';
const SAFE = /^[A-Za-z0-9+/]{4,64}$/;

const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export class CodecError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function encodeSignal({ type, sdp }) {
  const get = (re) => re.exec(sdp)?.[1];
  const ufrag = get(/a=ice-ufrag:(\S+)/);
  const pwd = get(/a=ice-pwd:(\S+)/);
  const fp = get(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/);
  if (!ufrag || !pwd || !fp || !SAFE.test(ufrag) || !SAFE.test(pwd)) throw new CodecError('bad-sdp', 'Could not read the connection details.');
  const fpBytes = fp.split(':').map((h) => parseInt(h, 16));
  if (fpBytes.length !== 32 || fpBytes.some((x) => !(x >= 0 && x <= 255))) throw new CodecError('bad-sdp', 'Could not read the connection details.');
  const seen = new Set();
  const cands = [];
  for (const m of sdp.matchAll(/a=candidate:\S+ \d+ udp \d+ (\d+)\.(\d+)\.(\d+)\.(\d+) (\d+) typ host/g)) {
    const k = m.slice(1, 6).join('.');
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push(m.slice(1, 6).map(Number));
  }
  if (!cands.length) throw new CodecError('no-local-address', 'This phone did not expose a local network address. Allow camera access, connect to the same Wi-Fi or hotspot, and try again.');
  const use = cands.slice(0, 4);
  const out = [1, type === 'offer' ? 0 : 1, ufrag.length, ...[...ufrag].map((c) => c.charCodeAt(0)), pwd.length, ...[...pwd].map((c) => c.charCodeAt(0)), ...fpBytes, use.length];
  for (const [a, b, c, d, port] of use) out.push(a, b, c, d, port >> 8, port & 255);
  return PREFIX + b64u(Uint8Array.from(out));
}

export function decodeSignal(text, expectType) {
  const bad = () => new CodecError('bad-code', 'That is not a valid CP Share offline code.');
  if (typeof text !== 'string' || !text.startsWith(PREFIX) || text.length > 400) throw bad();
  let u;
  try { u = unb64u(text.slice(PREFIX.length).trim()); } catch { throw bad(); }
  let i = 0;
  const take = (n) => { if (i + n > u.length) throw bad(); const s = u.subarray(i, i + n); i += n; return s; };
  if (take(1)[0] !== 1) throw bad();
  const type = take(1)[0] === 0 ? 'offer' : 'answer';
  if (expectType && type !== expectType) throw new CodecError('wrong-type', type === 'offer' ? 'This is the sender\'s code. Scan the other phone\'s reply code instead.' : 'This is a reply code. Scan the sender\'s code first.');
  const str = (n) => String.fromCharCode(...take(n));
  const ufrag = str(take(1)[0]);
  const pwd = str(take(1)[0]);
  if (!SAFE.test(ufrag) || !SAFE.test(pwd)) throw bad();
  const fp = [...take(32)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const n = take(1)[0];
  if (n < 1 || n > 4) throw bad();
  const cands = [];
  for (let k = 0; k < n; k++) { const c = take(6); cands.push(`${c[0]}.${c[1]}.${c[2]}.${c[3]} ${(c[4] << 8) | c[5]}`); }
  if (i !== u.length) throw bad();
  const lines = [
    'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${type === 'offer' ? 'actpass' : 'active'}`, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144',
    ...cands.map((c, k) => `a=candidate:${k + 1} 1 udp ${2113937151 - k} ${c} typ host generation 0`), 'a=end-of-candidates',
  ];
  return { type, sdp: lines.join('\r\n') + '\r\n' };
}
