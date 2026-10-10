import { createHmac } from 'node:crypto';

/**
 * Build the iceServers list that is sent to browsers via signaling.
 * - STUN alone does NOT guarantee connectivity; configure TURN for production.
 * - With TURN_SECRET (coturn `use-auth-secret`) credentials are short-lived.
 */
export function buildIceServers(ice, nowMs = Date.now()) {
  const out = [];
  if (ice.stunUrls?.length) out.push({ urls: ice.stunUrls });
  if (ice.turnUrls?.length) {
    if (ice.turnSecret) {
      const exp = Math.floor(nowMs / 1000) + ice.turnTtlSeconds;
      const username = `${exp}:cpshare`;
      const credential = createHmac('sha1', ice.turnSecret).update(username).digest('base64');
      out.push({ urls: ice.turnUrls, username, credential });
    } else if (ice.turnUsername && ice.turnCredential) {
      out.push({ urls: ice.turnUrls, username: ice.turnUsername, credential: ice.turnCredential });
    }
  }
  return out;
}
