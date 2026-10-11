// WebRTC connection + data channel setup. Signaling messages travel through the
// callbacks you provide; file bytes travel only over the RTCDataChannel.
export const CHANNEL_LABEL = 'cp-transfer';

// gatherAll: wait until ICE gathering finishes and send ONE complete description (no trickle).
// Used by offline QR pairing, where the description is carried in a QR code.
export function createPeer({ role, iceServers, sendSignal, onChannel, onState, gatherAll = false }) {
  const pc = new RTCPeerConnection({ iceServers: iceServers || [] });
  const pending = [];
  let remoteSet = false;
  let disconnectTimer = null;
  let closed = false;

  const emitState = (s) => { if (!closed) onState?.(s); };

  const gathered = () => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', on); resolve(); };
    const on = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, 4000);
    pc.addEventListener('icegatheringstatechange', on);
  });

  pc.onicecandidate = (e) => gatherAll || sendSignal({ type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null });
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    clearTimeout(disconnectTimer);
    if (s === 'disconnected') {
      // Wi-Fi blips often self-heal; give it a few seconds before declaring failure.
      disconnectTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') emitState('failed'); }, 8000);
    }
    emitState(s);
  };

  if (role === 'sender') {
    onChannel(pc.createDataChannel(CHANNEL_LABEL, { ordered: true }));
  } else {
    pc.ondatachannel = (e) => { if (e.channel.label === CHANNEL_LABEL) onChannel(e.channel); };
  }

  async function addCandidate(c) {
    if (!c) return;
    try { await pc.addIceCandidate(c); } catch { /* stale or invalid candidate: ignore */ }
  }

  return {
    pc,
    async start() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (gatherAll) await gathered();
      sendSignal({ type: 'offer', sdp: pc.localDescription.sdp });
    },
    async handleSignal(m) {
      if (closed || !m) return;
      if (m.type === 'offer' && role === 'receiver') {
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        remoteSet = true;
        for (const c of pending.splice(0)) await addCandidate(c);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (gatherAll) await gathered();
        sendSignal({ type: 'answer', sdp: pc.localDescription.sdp });
      } else if (m.type === 'answer' && role === 'sender') {
        await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        remoteSet = true;
        for (const c of pending.splice(0)) await addCandidate(c);
      } else if (m.type === 'candidate') {
        if (!remoteSet) pending.push(m.candidate);
        else await addCandidate(m.candidate);
      }
    },
    close() {
      closed = true;
      clearTimeout(disconnectTimer);
      try { pc.close(); } catch { /* ignore */ }
    },
  };
}
