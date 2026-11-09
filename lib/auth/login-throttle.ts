/**
 * Per-account sign-in throttle. Pure (the clock is injected) so it can be unit tested.
 *
 * The proxy already limits sign-in attempts per IP address. That does not stop one account being guessed from many addresses,
 * so failures are also counted per email. After MAX_FAILURES wrong attempts inside the window the account is locked until the
 * oldest of them ages out; a correct password does not bypass the lock (an attacker must not learn the password was right).
 *
 * Every email is counted the same way, including ones that have no account, so the lock does not reveal which emails exist.
 * Trade-off: someone can lock a known email for the window by failing on purpose. The window is short and the real owner can
 * still reset the password by email.
 */

export const MAX_FAILURES = 8;
export const WINDOW_MS = 15 * 60_000;
const MAX_KEYS = 20_000;

export type Verdict = { locked: false } | { locked: true; retryAfterSec: number };

export class LoginThrottle {
  private failures = new Map<string, number[]>();

  constructor(private now: () => number = Date.now) {}

  private key(email: string): string {
    return email.trim().toLowerCase().slice(0, 254);
  }

  private recent(key: string, t: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((x) => t - x < WINDOW_MS);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Call before checking the password. */
  check(email: string): Verdict {
    const t = this.now();
    const list = this.recent(this.key(email), t);
    if (list.length < MAX_FAILURES) return { locked: false };
    return { locked: true, retryAfterSec: Math.max(1, Math.ceil((list[0] + WINDOW_MS - t) / 1000)) };
  }

  /** Call after a wrong password (or an unknown email). */
  recordFailure(email: string): void {
    const t = this.now();
    const k = this.key(email);
    const list = this.recent(k, t);
    list.push(t);
    this.failures.set(k, list.slice(-MAX_FAILURES * 2));
    if (this.failures.size > MAX_KEYS) this.sweep(t);
  }

  /** Call after a successful sign-in. */
  recordSuccess(email: string): void {
    this.failures.delete(this.key(email));
  }

  private sweep(t: number): void {
    for (const [k, list] of this.failures) {
      if (!list.some((x) => t - x < WINDOW_MS)) this.failures.delete(k);
    }
    // Still too many live keys (an attack with fresh emails): drop the oldest 10% in one go, so the scan above is paid for
    // once per ~2,000 inserts instead of on every failed sign-in.
    if (this.failures.size > MAX_KEYS) {
      let drop = Math.ceil(MAX_KEYS / 10) + (this.failures.size - MAX_KEYS);
      for (const k of this.failures.keys()) {
        if (drop-- <= 0) break;
        this.failures.delete(k);
      }
    }
  }
}
