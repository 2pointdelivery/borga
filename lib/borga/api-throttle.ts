/**
 * Per-credential fixed-window throttle for the public API and other costly
 * routes (vibe-check #10). The proxy already limits per IP; this stops one
 * leaked key (or one session spread over many IPs) from burning the budget.
 * In-memory per process, like the proxy limiter — approximate under
 * horizontal scaling, exact for the single-instance deployment.
 */

export interface ThrottleVerdict {
  limited: boolean;
  retryAfterSec: number;
}

export class KeyThrottle {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private max: number,
    private windowMs = 60_000,
    private now: () => number = Date.now,
    private maxKeys = 20_000,
  ) {}

  take(key: string): ThrottleVerdict {
    const t = this.now();
    if (this.hits.size > this.maxKeys && !this.hits.has(key)) {
      // Evict the stalest entry instead of growing forever under key rotation.
      let oldest: string | null = null;
      let oldestReset = Infinity;
      for (const [k, v] of this.hits) {
        if (v.reset < oldestReset) { oldest = k; oldestReset = v.reset; }
      }
      if (oldest) this.hits.delete(oldest);
    }
    const rec = this.hits.get(key);
    if (!rec || rec.reset < t) {
      this.hits.set(key, { count: 1, reset: t + this.windowMs });
      return { limited: false, retryAfterSec: 0 };
    }
    rec.count += 1;
    if (rec.count <= this.max) return { limited: false, retryAfterSec: 0 };
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil((rec.reset - t) / 1000)) };
  }
}
