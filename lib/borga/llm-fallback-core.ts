/**
 * Graceful fallback between a company's activated AI models. Pure (no I/O) so every rule is unit-tested; llm-fallback.ts applies it.
 *
 * When the model a request was going to use fails (rate limit, outage, refused key, no answer), the next activated model answers
 * instead. A model that just failed is skipped for a while ("cooling down") so every request does not wait on a model known to be
 * down, and is tried again once the pause is over.
 */

export interface Candidate {
  providerId: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export type FailureKind = 'rate-limit' | 'auth' | 'payment' | 'outage' | 'network' | 'refused' | 'empty' | 'garbled' | 'model';

export interface Failure {
  providerId: string;
  model: string;
  kind: FailureKind;
  status: number | null;
  /** Short plain-language reason, safe to show. */
  reason: string;
}

/** The HTTP status buried in a provider error message ("... (429) ...", "upstream 500"), if any. */
export function statusOf(message: string): number | null {
  const m = /\((\d{3})\)|\bupstream (\d{3})\b|\bHTTP (\d{3})\b|\bstatus (\d{3})\b/i.exec(message);
  const n = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : NaN;
  return Number.isFinite(n) ? n : null;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** What kind of failure this was, and how long that model should sit out. Auth and payment problems do not fix themselves, so they wait longest. */
/** Text that is not an answer: one character repeated over and over (a free model that has lost the thread). */
export function looksGarbled(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  if (t.length < 60) return false;
  const counts = new Map<string, number>();
  for (const ch of t) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return Math.max(...counts.values()) / [...t].length > 0.8;
}

export function classifyFailure(message: string, empty = false): { kind: FailureKind; status: number | null; cooldownMs: number; reason: string } {
  const status = statusOf(message);
  if (empty) return { kind: /garbled/i.test(message) ? 'garbled' : 'empty', status, cooldownMs: 30 * SECOND, reason: /garbled/i.test(message) ? 'it returned garbled output' : 'it returned no answer' };
  // The key works but this model is gone or not allowed: the provider is fine, another of its models may answer.
  if (/model[_ ]not[_ ]found|model .{0,60}(does not exist|not found|decommission|no longer|not supported)|unknown model|invalid model/i.test(message)) {
    return { kind: 'model', status, cooldownMs: 10 * MINUTE, reason: 'that model is no longer available' };
  }
  if (status === 429 || /rate limit/i.test(message)) return { kind: 'rate-limit', status: status ?? 429, cooldownMs: MINUTE, reason: 'it is rate limiting requests' };
  if (status === 402 || /payment|credits|quota/i.test(message)) return { kind: 'payment', status: status ?? 402, cooldownMs: 10 * MINUTE, reason: 'it needs a key or payment' };
  if (status === 401 || status === 403 || /refused the request|api key/i.test(message)) return { kind: 'auth', status, cooldownMs: 10 * MINUTE, reason: 'it refused the API key' };
  if (/address was refused|not set up|no address/i.test(message)) return { kind: 'refused', status, cooldownMs: 10 * MINUTE, reason: 'its address or key is not set up correctly' };
  if (status !== null && status >= 500) return { kind: 'outage', status, cooldownMs: 30 * SECOND, reason: 'it is having an outage' };
  return { kind: 'network', status, cooldownMs: 30 * SECOND, reason: 'it could not be reached' };
}

interface HealthEntry { until: number; failures: number; lastKind: FailureKind }

/** Remembers which models are cooling down. Consecutive failures double the pause, up to 15 minutes. */
export class ProviderHealth {
  private entries = new Map<string, HealthEntry>();
  constructor(private now: () => number = Date.now) {}

  /** Records a failure. `newlyDown` is true when the model was healthy until now (so the user is told once, not on every retry). */
  fail(key: string, cooldownMs: number, kind: FailureKind): { newlyDown: boolean; until: number } {
    const prev = this.entries.get(key);
    const wasDown = !!prev && prev.until > this.now();
    const failures = (prev?.failures ?? 0) + 1;
    const until = this.now() + Math.min(cooldownMs * 2 ** Math.min(failures - 1, 4), 15 * MINUTE);
    this.entries.set(key, { until, failures, lastKind: kind });
    return { newlyDown: !wasDown, until };
  }

  ok(key: string): void {
    this.entries.delete(key);
  }

  /** When the model may be tried again (ms), or 0 when it is healthy. */
  coolingUntil(key: string): number {
    const e = this.entries.get(key);
    return e && e.until > this.now() ? e.until : 0;
  }

  snapshot(): Array<{ key: string; until: number; failures: number; kind: FailureKind }> {
    const t = this.now();
    return [...this.entries].filter(([, e]) => e.until > t).map(([key, e]) => ({ key, until: e.until, failures: e.failures, kind: e.lastKind }));
  }
}

/**
 * The order to try: the requested model first, then the other activated ones, healthy models before cooling ones. If everything
 * is cooling the request still goes out, soonest-recovering first, rather than failing without trying.
 */
export function planOrder(primary: Candidate | null, others: Candidate[], health: ProviderHealth, keyOf: (c: Candidate) => string, maxAttempts = 4): Candidate[] {
  const all: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of [...(primary ? [primary] : []), ...others]) {
    if (seen.has(c.providerId)) continue; // one try per provider: a second model of a failing provider shares its fate
    seen.add(c.providerId);
    all.push(c);
  }
  const healthy = all.filter((c) => !health.coolingUntil(keyOf(c)));
  const cooling = all.filter((c) => health.coolingUntil(keyOf(c))).sort((a, b) => health.coolingUntil(keyOf(a)) - health.coolingUntil(keyOf(b)));
  return [...healthy, ...cooling].slice(0, maxAttempts);
}

export interface FallbackResult {
  text: string;
  used: Candidate;
  /** True when the answer did not come from the first model requested. */
  switched: boolean;
  failures: Failure[];
  /** Failures of models that were healthy until this request (worth telling the user about). */
  newlyDown: Failure[];
}

export class AllModelsFailed extends Error {
  constructor(public failures: Failure[], public label: (providerId: string) => string) {
    super(
      failures.length
        ? `None of your activated AI models answered: ${failures.map((f) => `${label(f.providerId)} (${f.reason})`).join('; ')}.`
        : 'No AI model is available.',
    );
    this.name = 'AllModelsFailed';
  }
}

/** Tries each candidate in order until one answers. An empty answer counts as a failure. */
export async function runWithFallback(
  chain: Candidate[],
  attempt: (c: Candidate) => Promise<string>,
  health: ProviderHealth,
  keyOf: (c: Candidate) => string,
  label: (providerId: string) => string = (id) => id.replace(/^llm-/, ''),
  /** Other models of the same provider to try when a model is gone (its live list). */
  alternates?: (c: Candidate) => Promise<string[]>,
): Promise<FallbackResult> {
  const failures: Failure[] = [];
  const newlyDown: Failure[] = [];
  const once = async (c: Candidate): Promise<{ text: string } | { message: string; empty: boolean }> => {
    try {
      const text = (await attempt(c)).trim();
      if (!text) return { message: 'empty answer', empty: true };
      if (looksGarbled(text)) return { message: 'garbled answer', empty: true };
      return { text };
    } catch (e) {
      return { message: (e as Error).message || 'failed', empty: false };
    }
  };
  for (const original of chain) {
    let c = original;
    let r = await once(c);
    if ('message' in r && classifyFailure(r.message, r.empty).kind === 'model' && alternates) {
      for (const model of (await alternates(c).catch(() => [])).filter((m) => m !== original.model).slice(0, 2)) {
        const next = { ...original, model };
        const again = await once(next);
        if ('text' in again) { c = next; r = again; break; }
      }
    }
    const failure = 'message' in r ? r : null;
    if (!failure) {
      health.ok(keyOf(c));
      return { text: (r as { text: string }).text, used: c, switched: failures.length > 0, failures, newlyDown };
    }
    const k = classifyFailure(failure.message, failure.empty);
    const f: Failure = { providerId: c.providerId, model: c.model, kind: k.kind, status: k.status, reason: k.reason };
    failures.push(f);
    if (health.fail(keyOf(c), k.cooldownMs, k.kind).newlyDown) newlyDown.push(f);
  }
  throw new AllModelsFailed(failures, label);
}
