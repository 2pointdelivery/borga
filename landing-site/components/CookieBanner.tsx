'use client';

import { useEffect, useState } from 'react';
import { Cookie, X } from 'lucide-react';

export type SiteRegion = 'europe' | 'africa' | 'north-america';

export interface SiteChoice {
  region: SiteRegion;
  analytics: boolean;
  advertising: boolean;
  personalization: boolean;
  security: boolean;
}

const KEY = 'borga-site-consent';

const CATEGORIES = [
  { id: 'analytics', label: 'Website analysis', blurb: 'Aggregated, anonymized usage statistics that help us improve the site.' },
  { id: 'advertising', label: 'Advertising', blurb: 'Relevant ads on other sites and campaign measurement.' },
  { id: 'personalization', label: 'Personalization', blurb: 'Remembered preferences for a tailored visit.' },
  { id: 'security', label: 'Security', blurb: 'Fraud prevention and abuse detection.' },
] as const;

const REGIONS: { id: SiteRegion; label: string; hint: string }[] = [
  { id: 'europe', label: 'Europe', hint: 'GDPR + ePrivacy: nothing optional runs until you accept.' },
  { id: 'africa', label: 'Africa', hint: 'NDPR / POPIA: nothing optional runs until you accept.' },
  { id: 'north-america', label: 'North America', hint: 'US state laws: analytics runs until you reject. A GPC signal always opts you out.' },
];

/** Regional defaults — mirrors lib/borga/consent.ts in the main app. */
export function siteDefaults(region: SiteRegion): Omit<SiteChoice, 'region'> {
  return {
    analytics: region === 'north-america',
    advertising: false,
    personalization: false,
    security: true,
  };
}

export function readSiteChoice(): (SiteChoice & { at: string }) | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return null;
    const region: SiteRegion = j.region === 'africa' || j.region === 'north-america' ? j.region : 'europe';
    return {
      region,
      analytics: !!j.analytics,
      advertising: !!j.advertising,
      personalization: !!j.personalization,
      security: j.security !== false,
      at: typeof j.at === 'string' ? j.at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [region, setRegion] = useState<SiteRegion>('europe');
  const [choices, setChoices] = useState(siteDefaults('europe'));

  useEffect(() => {
    if (!readSiteChoice()) setVisible(true);
  }, []);

  const pickRegion = (r: SiteRegion) => {
    setRegion(r);
    setChoices(siteDefaults(r));
  };

  const save = (c: typeof choices) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ region, ...c, at: new Date().toISOString() }));
    } catch {
      // private mode — choice lasts this visit only
    }
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div role="dialog" aria-label="Cookie settings" className="fixed bottom-4 left-4 z-[80] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Cookie className="h-4 w-4" /> Cookie settings</p>
        <button type="button" onClick={() => setVisible(false)} title="Decide later" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        By clicking “Accept all cookies”, you agree to the storage of cookies on your device to improve navigation, analyze usage and support marketing, in accordance with our <a href="/cookies" className="underline hover:text-foreground">cookie policy</a>.
      </p>
      <div className="mt-3 flex gap-1.5">
        {REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            title={r.hint}
            onClick={() => pickRegion(r.id)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${region === r.id ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{REGIONS.find((r) => r.id === region)?.hint}</p>

      {customizing && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          <p className="text-[11px] text-muted-foreground">Strictly-necessary cookies are always on — the site cannot work without them.</p>
          {CATEGORIES.map((c) => (
            <label key={c.id} className="flex items-start justify-between gap-2 text-xs" title={c.blurb}>
              <span>{c.label}</span>
              <input
                type="checkbox"
                checked={choices[c.id]}
                onChange={(e) => setChoices((s) => ({ ...s, [c.id]: e.target.checked }))}
                className="mt-0.5 accent-current"
              />
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => save({ analytics: true, advertising: true, personalization: true, security: true })} className="rounded-full bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90">
          Accept all cookies
        </button>
        <button type="button" onClick={() => save({ analytics: false, advertising: false, personalization: false, security: true })} className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold hover:bg-muted">
          Reject all cookies
        </button>
        <button type="button" onClick={() => (customizing ? save(choices) : setCustomizing(true))} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground underline hover:text-foreground">
          {customizing ? 'Save settings' : 'Cookie settings'}
        </button>
      </div>
    </div>
  );
}
