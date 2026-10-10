// Central, env-driven configuration. No secrets are hard-coded here.
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const list = (v, d = []) => {
  const a = String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return a.length ? a : d;
};

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    trustProxy: env.TRUST_PROXY === 'true',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    codeTtlMs: int(env.PAIRING_CODE_TTL_SECONDS, 300) * 1000,
    pairedMaxMs: int(env.PAIRED_SESSION_MAX_SECONDS, 7200) * 1000,
    maxSessions: int(env.MAX_SESSIONS, 5000),
    maxConnsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 20),
    tls: { keyFile: env.TLS_KEY_FILE || '', certFile: env.TLS_CERT_FILE || '' },
    ice: {
      stunUrls: list(env.STUN_URLS, ['stun:stun.l.google.com:19302']),
      turnUrls: list(env.TURN_URLS),
      turnSecret: env.TURN_SECRET || '',
      turnTtlSeconds: int(env.TURN_TTL_SECONDS, 3600),
      turnUsername: env.TURN_USERNAME || '',
      turnCredential: env.TURN_CREDENTIAL || '',
    },
  };
}

// PROPOSED reward rules. Informational only in Phase 1: nothing here is active,
// and nothing here credits money. Later phases move this into the reward_rules table.
export const PROPOSED_REWARD_RULES = {
  active: false,
  status: 'proposed',
  currency: 'NGN',
  minWithdrawal: 15000,
  rules: [
    { id: 'apps', label: 'Send 1 eligible application', quantity: 1, reward: 30 },
    { id: 'photos', label: 'Send 100 eligible photos', quantity: 100, reward: 30 },
    { id: 'videos', label: 'Send 50 eligible videos', quantity: 50, reward: 30 },
    { id: 'songs', label: 'Send 50 eligible songs', quantity: 50, reward: 30 },
    { id: 'documents', label: 'Send 50 eligible documents or files', quantity: 50, reward: 30 },
  ],
  note: 'Each activity earns the listed amount once in total, not per file.',
};
