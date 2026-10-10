// WebRTC connection + data channel setup. Signaling messages travel through the
// callbacks you provide; file bytes travel only over the RTCDataChannel.
export const CHANNEL_LABEL = 'cp-transfer';

export function createPeer({ role, iceServers, sendSignal, onChannel, onState }) {
  const pc = new RTCPeerConnection({ iceServers: iceServers || [] });
  const pending = [];
  let remoteSet = false;
  let disconnectTimer = null;
  let closed = false;

  const emitState = (s) => { if (!closed) onState?.(s); };

  pc.onicecandidate = (e) => sendSignal({ type: 'candidate', candidate: e.candidate ? e.candidate.toJSON() : null });
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
