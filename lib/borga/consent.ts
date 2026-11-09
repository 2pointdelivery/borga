/**
 * Cookie-consent policy engine, kept pure (no I/O) so it can be unit tested.
 *
 * Three regulatory regions with different defaults:
 * - europe (GDPR + ePrivacy): prior opt-IN — everything non-essential off until chosen.
 * - africa (NDPR Nigeria, POPIA South Africa, Kenya DPA): prior opt-IN like the EU.
 * - north-america (US state laws CCPA/CPRA + PIPEDA Canada): opt-OUT — analytics
 *   may run until the visitor rejects, and a Global Privacy Control (GPC)
 *   signal is always treated as an opt-out of sale/sharing.
 *
 * Categories mirror the public cookie banner (landing-site) so the two can
 * never disagree: necessary is always on and not toggleable.
 */

export type ConsentRegion = 'europe' | 'africa' | 'north-america';

export type CookieCategory = 'necessary' | 'analytics' | 'advertising' | 'personalization' | 'security';

export const COOKIE_CATEGORIES: { id: CookieCategory; label: string; blurb: string; locked?: boolean }[] = [
  { id: 'necessary', label: 'Strictly necessary', blurb: 'Sign-in, security, load balancing and remembering this very choice. The site cannot work without them.', locked: true },
  { id: 'analytics', label: 'Website analysis', blurb: 'Aggregated, anonymized usage statistics (which pages are popular) to improve the service.' },
  { id: 'advertising', label: 'Advertising', blurb: 'Relevant ads on other sites and measuring campaign effectiveness.' },
  { id: 'personalization', label: 'Personalization', blurb: 'Remembering preferences and past interactions for a tailored experience.' },
  { id: 'security', label: 'Security', blurb: 'Fraud prevention and abuse detection beyond the strictly-necessary baseline.' },
];

export const CONSENT_VERSION = 1;

export type CategoryChoices = Record<CookieCategory, boolean>;

export interface ConsentChoice {
  region: ConsentRegion;
  choices: CategoryChoices;
  version: number;
  at: string;
  source: 'banner' | 'gpc' | 'defaults';
}

/** Defaults before the visitor chooses: opt-in regions start all-off; North America starts analytics-on (opt-out). */
export function defaultChoices(region: ConsentRegion): CategoryChoices {
  return {
    necessary: true,
    analytics: region === 'north-america',
    advertising: false,
    personalization: false,
    security: true,
  };
}

export function isRegion(r: unknown): r is ConsentRegion {
  return r === 'europe' || r === 'africa' || r === 'north-america';
}

/** Normalize a stored/parsed choice: unknown regions fall back to europe (strictest), locked categories forced on. */
export function normalizeChoice(raw: { region?: unknown; choices?: Partial<Record<string, unknown>>; version?: unknown; at?: unknown; source?: unknown }): ConsentChoice | null {
  const region = isRegion(raw.region) ? raw.region : 'europe';
  const defaults = defaultChoices(region);
  const choices = { ...defaults };
  if (raw.choices && typeof raw.choices === 'object') {
    for (const c of ['analytics', 'advertising', 'personalization', 'security'] as const) {
      if (typeof raw.choices[c] === 'boolean') choices[c] = raw.choices[c] as boolean;
    }
  }
  choices.necessary = true;
  const version = typeof raw.version === 'number' ? raw.version : CONSENT_VERSION;
  return {
    region,
    choices,
    version,
    at: typeof raw.at === 'string' ? raw.at : new Date(0).toISOString(),
    source: raw.source === 'gpc' || raw.source === 'defaults' || raw.source === 'banner' ? raw.source : 'banner',
  };
}

/** A stored choice is stale when the policy version moved on — re-ask. */
export function choiceNeedsRefresh(choice: ConsentChoice | null): boolean {
  if (!choice) return true;
  return choice.version !== CONSENT_VERSION;
}

/** GPC (Sec-GPC: 1) always opts out of sale/sharing: analytics + advertising off, recorded as source 'gpc'. */
export function applyGpc(choice: ConsentChoice | null, region: ConsentRegion): ConsentChoice {
  const base = choice ?? { region, choices: defaultChoices(region), version: CONSENT_VERSION, at: new Date().toISOString(), source: 'defaults' as const };
  return { ...base, region, choices: { ...base.choices, necessary: true, analytics: false, advertising: false }, source: 'gpc', at: new Date().toISOString() };
}
