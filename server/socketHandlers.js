import { buildIceServers } from './ice.js';
import { validateSignal } from './validate.js';
import { RateLimiter } from './ratelimit.js';

export function clientIp(socket, config) {
  if (config.trustProxy) {
    const xff = socket.handshake?.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  }
  return socket.handshake?.address || 'unknown';
}

/** Does the browser Origin match this server (or the allow-list)? */
export function originAllowed(origin, host, allowed = []) {
  if (!origin) return true; // non-browser clients; they get no cookies/ambient authority here
  if (allowed.length) return allowed.includes(origin);
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Pairing + signaling. File bytes NEVER pass through here: this only relays
 * small, validated SDP/ICE messages between the two paired sockets.
 */
export function registerSocketHandlers(io, { store, config, log = console, now = () => Date.now() }) {
  const ipConns = new Map();
  const limits = {
    create: new RateLimiter({ capacity: 10, refillPerSec: 10 / 60 }),
    join: new RateLimiter({ capacity: 8, refillPerSec: 8 / 60 }),
    signal: new RateLimiter({ capacity: 200, refillPerSec: 50 }),
  };

  io.on('connection', (socket) => {
    const ip = clientIp(socket, config);
    const n = (ipConns.get(ip) || 0) + 1;
    ipConns.set(ip, n);
    if (n > config.maxConnsPerIp) {
      socket.disconnect(true);
      ipConns.set(ip, n - 1);
      return;
    }

    const guard = (limiter, handler) => (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!limiter.consume(ip)) return reply({ ok: false, error: 'rate_limited' });
      try {
        handler(payload, reply);
      } catch (err) {
        log.error?.('socket handler error', err?.message);
        reply({ ok: false, error: 'server_error' });
      }
    };

    const leave = () => {
      const r = store.leave(socket.id);
      if (r?.peer) io.to(r.peer).emit('peer:left', {});
    };

    socket.on('session:create', guard(limits.create, (_p, reply) => {
      const r = store.create(socket.id);
      if (!r.ok) return reply({ ok: false, error: r.error });
      reply({ ok: true, code: r.code, expiresAt: r.expiresAt, iceServers: buildIceServers(config.ice, now()) });
    }));

    socket.on('session:join', guard(limits.join, (p, reply) => {
      if (!p || typeof p !== 'object') return reply({ ok: false, error: 'invalid' });
      const r = store.join(p.code, socket.id);
      if (!r.ok) return reply({ ok: false, error: r.error });
      reply({ ok: true, iceServers: buildIceServers(config.ice, now()) });
      io.to(r.sender).emit('peer:joined', {});
    }));

    socket.on('signal', guard(limits.signal, (p, reply) => {
      const peer = store.peerOf(socket.id);
      if (!peer) return reply({ ok: false, error: 'no_peer' });
      const clean = validateSignal(p);
      if (!clean) return reply({ ok: false, error: 'invalid_signal' });
      io.to(peer).emit('signal', clean);
      reply({ ok: true });
    }));

    socket.on('session:leave', () => leave());

    socket.on('disconnect', () => {
      ipConns.set(ip, Math.max(0, (ipConns.get(ip) || 1) - 1));
      leave();
    });
  });

  return {
    sweep() {
      for (const { sockets } of store.sweep()) for (const id of sockets) io.to(id).emit('session:expired', {});
      for (const l of Object.values(limits)) l.sweep();
    },
  };
}
