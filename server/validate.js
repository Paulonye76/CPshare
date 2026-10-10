// Strict validation of WebRTC signaling payloads. Output is rebuilt from
// whitelisted fields, so nothing unexpected is ever relayed to the other device.
const MAX_SDP = 20000;
const MAX_CANDIDATE = 2000;

const isStr = (v, max) => typeof v === 'string' && v.length <= max;

export function validateSignal(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  if (p.type === 'offer' || p.type === 'answer') {
    if (!isStr(p.sdp, MAX_SDP) || p.sdp.length < 10) return null;
    return { type: p.type, sdp: p.sdp };
  }
  if (p.type === 'candidate') {
    if (p.candidate === null) return { type: 'candidate', candidate: null };
    const c = p.candidate;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    if (!isStr(c.candidate, MAX_CANDIDATE)) return null;
    if (c.sdpMid != null && !isStr(c.sdpMid, 64)) return null;
    if (c.sdpMLineIndex != null && !(Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex < 16)) return null;
    if (c.usernameFragment != null && !isStr(c.usernameFragment, 128)) return null;
    return {
      type: 'candidate',
      candidate: {
        candidate: c.candidate,
        sdpMid: c.sdpMid ?? null,
        sdpMLineIndex: c.sdpMLineIndex ?? null,
        usernameFragment: c.usernameFragment ?? undefined,
      },
    };
  }
  return null;
}
