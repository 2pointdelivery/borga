/**
 * Per-route throttles for anything that sends mail (vibe-check #10). The proxy
 * limits per IP and the public API per credential; these buckets stop one
 * signed-in session from using the app as a mail relay (spam, inbox bombing, or
 * burning a shared sender's reputation and quota).
 *
 * In-memory per process, like the proxy limiter: exact for the single-instance
 * deployment, approximate behind several instances.
 */

import { KeyThrottle } from './api-throttle';

export type LimitBucket = 'mail' | 'emailTest' | 'emailDigest' | 'emailNotify' | 'passwordReset' | 'signup' | 'invite' | 'workflowRun';

const HOUR = 60 * 60_000;

const BUCKETS: Record<LimitBucket, { max: number; windowMs: number }> = {
  /** One message or business document from the dashboard / inbox. */
  mail: { max: 30, windowMs: HOUR },
  /** "Send me a test email". */
  emailTest: { max: 10, windowMs: HOUR },
  /** "Send the digest now". */
  emailDigest: { max: 6, windowMs: HOUR },
  /** Browser-raised event notifications (approval created, recurring ran). */
  emailNotify: { max: 120, windowMs: HOUR },
  /** "Your password changed" confirmations, per account. */
  passwordReset: { max: 6, windowMs: HOUR },
  /** Signup welcome mail, per email address. */
  signup: { max: 5, windowMs: HOUR },
  /** Operator-created invite links (each one can send mail on signup). */
  invite: { max: 30, windowMs: HOUR },
  /** Workflow runs — each one spends real LLM calls (remote engine or AI workers). */
  workflowRun: { max: 10, windowMs: HOUR },
};

const g = globalThis as typeof globalThis & { __borgaRouteLimits?: Map<LimitBucket, KeyThrottle> };
const throttles = (g.__borgaRouteLimits ??= new Map<LimitBucket, KeyThrottle>());

function throttleFor(bucket: LimitBucket): KeyThrottle {
  const existing = throttles.get(bucket);
  if (existing) return existing;
  const cfg = BUCKETS[bucket];
  const t = new KeyThrottle(cfg.max, cfg.windowMs);
  throttles.set(bucket, t);
  return t;
}

export interface LimitVerdict {
  limited: boolean;
  retryAfterSec: number;
}

/** Count one attempt for `key` (normally userId + workspace, or an email address). */
export function takeRouteLimit(bucket: LimitBucket, key: string): LimitVerdict {
  return throttleFor(bucket).take(key.slice(0, 200));
}

/** Test hook: clear the counters (no effect in normal use). */
export function resetRouteLimits(): void {
  throttles.clear();
}
