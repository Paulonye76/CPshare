import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { loadConfig, PROPOSED_REWARD_RULES } from './config.js';
import { PairingStore } from './pairing.js';
import { RateLimiter } from './ratelimit.js';
import { registerSocketHandlers, originAllowed } from './socketHandlers.js';

const config = loadConfig();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);

// ---- Security headers -------------------------------------------------------
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
      "connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// ---- API --------------------------------------------------------------------
const apiLimiter = new RateLimiter({ capacity: 120, refillPerSec: 2 });
app.use('/api', (req, res, next) => {
  if (!apiLimiter.consume(req.ip)) return res.status(429).json({ error: 'rate_limited' });
  next();
});
app.use(express.json({ limit: '10kb' }));

const store = new PairingStore(config);

app.get('/api/health', (_req, res) => res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()), activeSessions: store.size }));

app.get('/api/config', (_req, res) =>
  res.json({
    app: 'CP Share',
    version: '0.1.0',
    turnConfigured: config.ice.turnUrls.length > 0,
    features: { transfer: true, accounts: false, rewards: false, wallet: false, withdrawals: false, admin: false },
  }),
);

// Informational only. These rules are NOT active and credit nothing.
app.get('/api/rewards/rules', (_req, res) => res.json(PROPOSED_REWARD_RULES));

// The server, not the browser, decides eligibility. In Phase 1 nobody is eligible.
app.get('/api/rewards/eligibility', (_req, res) =>
  res.json({ eligible: false, status: 'not_enabled', message: 'Rewards are not active yet. This is a development build.' }),
);

// Authenticated areas exist as server-side gates already. No auth system exists in
// Phase 1, so every request is denied. The frontend can never grant itself access.
const denyUnauthenticated = (_req, res) => res.status(401).json({ error: 'authentication_required' });
app.use('/api/admin', denyUnauthenticated);
app.use('/api/wallet', denyUnauthenticated);
app.use('/api/withdrawals', denyUnauthenticated);

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ---- Static frontend --------------------------------------------------------
app.use(express.static(publicDir, { maxAge: '1h', etag: true }));

// ---- HTTP(S) + Socket.IO ----------------------------------------------------
let server;
if (config.tls.keyFile && config.tls.certFile) {
  server = https.createServer({ key: fs.readFileSync(config.tls.keyFile), cert: fs.readFileSync(config.tls.certFile) }, app);
} else {
  server = http.createServer(app);
}

const io = new Server(server, {
  maxHttpBufferSize: 32 * 1024, // signaling only; file data must never use this channel
  pingInterval: 10000,
  pingTimeout: 10000,
  allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, req.headers.host, config.allowedOrigins)),
});

const handlers = registerSocketHandlers(io, { store, config });
const sweeper = setInterval(() => handlers.sweep(), 15000);
sweeper.unref();

server.listen(config.port, config.host, () => {
  const scheme = config.tls.keyFile ? 'https' : 'http';
  console.log(`CP Share listening on ${scheme}://${config.host}:${config.port}`);
  if (!config.ice.turnUrls.length) console.log('No TURN server configured: transfers across restrictive networks may fail. See README.');
});

const shutdown = () => {
  clearInterval(sweeper);
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
