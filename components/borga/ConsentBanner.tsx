'use client';

import { useEffect, useState } from 'react';
import { Cookie, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { COOKIE_CATEGORIES, defaultChoices, type CategoryChoices, type ConsentRegion } from '@/lib/borga/consent';
import { toast } from '@/lib/toast-bus';
import { cn } from '@/lib/utils';

const REGIONS: { id: ConsentRegion; label: string; hint: string }[] = [
  { id: 'europe', label: 'Europe', hint: 'GDPR: nothing optional runs until you accept.' },
  { id: 'africa', label: 'Africa', hint: 'NDPR / POPIA: nothing optional runs until you accept.' },
  { id: 'north-america', label: 'North America', hint: 'US state laws: analytics runs until you reject; GPC always opts out.' },
];

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

/**
 * First-run cookie banner (behind login). Saves a signed HttpOnly choice via
 * /api/borga/consent; regional defaults follow lib/borga/consent.ts.
 * Settings → Cookie settings re-opens it at any time (`borga:consent-reopen`),
 * so withdrawing or changing consent later is one click, as the policy states.
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [region, setRegion] = useState<ConsentRegion>('europe');
  const [choices, setChoices] = useState<CategoryChoices>(defaultChoices('europe'));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/borga/consent')
      .then((r) => r.json())
      .then((j: { choice?: { region: ConsentRegion; choices: CategoryChoices } | null; needsRefresh?: boolean }) => {
        if (!alive) return;
        if (j.choice && !j.needsRefresh) return;
        if (j.choice) {
          setRegion(j.choice.region);
          setChoices(j.choice.choices);
        }
        setVisible(true);
      })
      .catch(() => {});
    // Reopen path: Settings dispatches this so the visitor can review or
    // withdraw their choice at any time — not just on first run.
    const reopen = () => setVisible(true);
    window.addEventListener('borga:consent-reopen', reopen);
    return () => { alive = false; window.removeEventListener('borga:consent-reopen', reopen); };
  }, []);

  const pickRegion = (r: ConsentRegion) => {
    setRegion(r);
    setChoices(defaultChoices(r));
  };

  const save = async (c: CategoryChoices) => {
    setBusy(true);
    try {
      const r = await fetch('/api/borga/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ region, choices: c }),
      });
      if (!r.ok) throw new Error('save failed');
    } catch {
      // Nothing was saved: keep the banner up so the visitor knows the
      // choice did not persist (it will be asked again next visit).
      toast({ title: 'Could not save your cookie choice', description: 'Please try again — nothing was saved.', variant: 'error' });
      return;
    } finally {
      setBusy(false);
    }
    setVisible(false);
    setCustomizing(false);
  };

  if (!visible) return null;
  return (
    <div role="dialog" aria-label="Cookie consent" className="fixed bottom-4 left-1/2 z-[70] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border bg-background p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Cookie className="h-4 w-4 text-primary" /> How we use cookies</p>
        <button type="button" onClick={() => setVisible(false)} title="Decide later" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex gap-1.5">
        {REGIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            title={r.hint}
            onClick={() => pickRegion(r.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              region === r.id ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{REGIONS.find((r) => r.id === region)?.hint}</p>

      {customizing && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          {COOKIE_CATEGORIES.map((c) => (
            <label key={c.id} className="flex items-start justify-between gap-2 text-xs" title={c.blurb}>
              <span>{c.label}{c.locked ? ' (always on)' : ''}</span>
              <input
                type="checkbox"
                disabled={c.locked}
                checked={c.locked ? true : choices[c.id]}
                onChange={(e) => setChoices((s) => ({ ...s, [c.id]: e.target.checked }))}
                className="mt-0.5 accent-current"
              />
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void save({ ...choices, analytics: true, advertising: region === 'north-america', personalization: true, security: true })}>
          Accept all
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => void save({ ...defaultChoices(region), analytics: false, advertising: false, personalization: false })}>
          Reject all
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => (customizing ? void save(choices) : setCustomizing(true))} disabled={busy}>
          {customizing ? 'Save choices' : 'Customize'}
        </Button>
        {SITE_URL && (
          <a href={`${SITE_URL.replace(/\/$/, '')}/cookies`} target="_blank" rel="noreferrer" className="ml-auto self-center text-[11px] text-muted-foreground underline hover:text-foreground">
            Cookie policy
          </a>
        )}
      </div>
    </div>
  );
}
