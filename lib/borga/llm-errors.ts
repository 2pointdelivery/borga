/**
 * Transient LLM-upstream failures, kept pure (no I/O) so it can be unit tested.
 *
 * Background: the keyless community providers (Pollinations, LLM7) occasionally
 * answer 5xx — Pollinations' legacy endpoint has returned `500 ENOSPC: no space
 * left on device` from *their* servers, plus a deprecation notice. That is not
 * our disk, and a single blip must not kill a whole agent run: callers retry
 * these statuses, and when retries are exhausted the user gets a plain-language
 * message instead of a raw JSON dump.
 */

/** Upstream statuses worth one more try: rate limits and transient server failures. */
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

export function isRetryableLlmStatus(status: number): boolean {
  return RETRYABLE.has(status);
}

/** How many POST attempts callers make before giving up. */
export const LLM_MAX_ATTEMPTS = 3;

/** Back-off between attempts (linear: 0.5s, 1s). Small enough to stay inside the 45s fetch timeout budget. */
export function llmRetryDelayMs(attempt: number): number {
  return 500 * Math.max(1, attempt);
}

/**
 * Plain-language error for a failed LLM call. The raw upstream body is truncated
 * to a short detail — never dumped whole — and the well-known community-provider
 * outages (disk-full/overloaded 500s, anonymous rate limits) say what happened
 * and what to do next.
 */
export function friendlyLlmError(providerLabel: string, status: number, bodyText: string): string {
  const detail = bodyText.replace(/\s+/g, ' ').trim().slice(0, 200);
  const where = 'under Integrations → AI & Voice';
  if (/ENOSPC|no space left on device|overloaded|over-capacity|capacity|try again later/i.test(bodyText)) {
    return `${providerLabel} is temporarily down (upstream ${status}${detail ? `: ${detail}` : ''}). Wait a minute and try again, or pick another provider ${where}.`;
  }
  if (status === 429) {
    return `${providerLabel} is rate limiting requests right now${detail ? ` (${detail})` : ''}. Wait a minute and try again, or add a free API key ${where}.`;
  }
  if (status === 401 || status === 403) {
    return `${providerLabel} refused the request (${status}). Check the API key ${where}.${detail ? ` Upstream said: ${detail}` : ''}`;
  }
  return `${providerLabel} returned an error (${status})${detail ? `: ${detail}` : ''}${isRetryableLlmStatus(status) ? '. Try again shortly.' : ''}`;
}
