/** Small in-memory token bucket, keyed by string (usually client IP). */
export class RateLimiter {
  constructor({ capacity, refillPerSec, now = () => Date.now() }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.buckets = new Map();
  }

  consume(key, cost = 1) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, t };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + ((t - b.t) / 1000) * this.refillPerSec);
    b.t = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return true;
    }
    return false;
  }

  sweep(maxIdleMs = 600000) {
    const t = this.now();
    for (const [k, b] of this.buckets) if (t - b.t > maxIdleMs) this.buckets.delete(k);
  }
}
