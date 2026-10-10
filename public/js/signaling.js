// Thin wrapper around the Socket.IO client for pairing + WebRTC signaling ONLY.
// File data never travels through this socket.
export class Signaling {
  constructor() { this.socket = null; this.handlers = new Map(); }

  connect() {
    return new Promise((resolve, reject) => {
      if (typeof window.io !== 'function') return reject(new Error('Could not load the connection client. Is the CP Share server running?'));
      const s = window.io({ transports: ['websocket', 'polling'], reconnection: false, timeout: 8000 });
      this.socket = s;
      const t = setTimeout(() => reject(new Error('Could not reach the CP Share server. Check your internet connection.')), 9000);
      s.once('connect', () => { clearTimeout(t); resolve(); });
      s.once('connect_error', () => { clearTimeout(t); reject(new Error('Could not reach the CP Share server. Check your internet connection.')); });
      s.on('disconnect', (r) => this.handlers.get('disconnect')?.(r));
      for (const ev of ['peer:joined', 'peer:left', 'signal', 'session:expired']) s.on(ev, (d) => this.handlers.get(ev)?.(d));
    });
  }

  on(ev, fn) { this.handlers.set(ev, fn); }

  request(ev, data) {
    return new Promise((resolve, reject) => {
      this.socket.timeout(8000).emit(ev, data, (err, res) => (err ? reject(new Error('The server did not respond.')) : resolve(res)));
    });
  }

  send(ev, data) { this.socket?.emit(ev, data); }

  close() {
    try { this.socket?.emit('session:leave'); this.socket?.close(); } catch { /* ignore */ }
    this.socket = null;
    this.handlers.clear();
  }
}
