import 'server-only';

import { cookies, headers } from 'next/headers';
import { verifyPayloadSignature } from './secrets';
import { applyGpc, choiceNeedsRefresh, normalizeChoice, type ConsentChoice, type ConsentRegion } from './consent';

export const CONSENT_COOKIE = 'borga-consent';

/** Parse + verify the consent cookie. Tampered or malformed cookies read as no choice. */
export function readConsentCookie(raw: string | undefined): ConsentChoice | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let json: string;
  try {
    json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (!verifyPayloadSignature(payload, sig)) return null;
    return normalizeChoice(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Effective choice for this request: stored choice overridden by a GPC opt-out signal. */
export async function effectiveConsent(): Promise<{ choice: ConsentChoice | null; gpc: boolean; needsRefresh: boolean }> {
  const store = await cookies();
  const head = await headers();
  const gpc = head.get('sec-gpc') === '1';
  let choice = readConsentCookie(store.get(CONSENT_COOKIE)?.value);
  if (gpc) {
    const region: ConsentRegion = choice?.region ?? 'north-america';
    choice = applyGpc(choice, region);
  }
  return { choice, gpc, needsRefresh: choiceNeedsRefresh(choice) };
}
