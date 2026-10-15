'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBorga } from '@/lib/borga/store';
import type { FxRates } from '@/lib/borga/fx';

/**
 * Exchange rates: refreshed daily from the ECB (free, no key) with a manual
 * fallback. Invoices and bills convert at these rates; month-end revaluation
 * in Accounting measures open foreign balances against them.
 */
const COMMON = ['USD', 'EUR', 'GBP', 'GHS', 'CAD', 'DKK', 'NGN', 'ZAR', 'KES', 'XOF', 'XAF', 'JPY', 'CNY', 'INR'];

export function FxCard() {
  const { fxRates, setFxRates, activeWorkspaceId, activeWorkspace } = useBorga();
  const wsCurrency = activeWorkspace()?.currency ?? 'USD';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const refresh = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/borga/fx?ws=${encodeURIComponent(activeWorkspaceId ?? '')}`);
      const d = await r.json() as { ok?: boolean; error?: string; rates?: FxRates };
      if (d.ok && d.rates) {
        setFxRates(d.rates);
        setEdits({});
        setMsg(`Rates refreshed — ${d.rates.base} base, published ${d.rates.date || 'today'}.`);
      } else {
        setMsg(d.error ?? 'ECB unreachable — kept the saved table. Enter rates by hand below.');
      }
    } finally { setBusy(false); }
  };

  const saveManual = async () => {
    const rates: Record<string, number> = { ...fxRates.rates };
    for (const [k, v] of Object.entries(edits)) {
      const n = Number(v);
      if (v.trim() && Number.isFinite(n) && n > 0) rates[k] = n;
    }
    const body = { ws: activeWorkspaceId, base: fxRates.base || 'EUR', rates };
    const r = await fetch('/api/borga/fx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify(body),
    });
    const d = await r.json() as { ok?: boolean; error?: string; rates?: FxRates };
    if (d.ok && d.rates) {
      setFxRates(d.rates);
      setEdits({});
      setMsg('Hand-kept rates saved — documents use these until the next refresh.');
    } else setMsg(d.error ?? 'Could not save rates.');
  };

  const codes = [...new Set([wsCurrency, fxRates.base, ...COMMON.filter((c) => fxRates.rates[c] !== undefined)])].slice(0, 12);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Exchange rates</p>
          <p className="text-[11px] text-muted-foreground">
            {fxRates.date ? `Published ${fxRates.date}` : 'No rates yet'} · base {fxRates.base} · {fxRates.source === 'ecb' ? 'ECB reference rates' : 'hand-kept table'} · company currency {wsCurrency}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>Refresh from ECB</Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {codes.map((code) => (
          <label key={code} className="flex items-center gap-1.5 text-xs">
            <span className="w-10 font-mono font-semibold">{code}</span>
            <Input
              className="h-7 text-xs"
              placeholder={fxRates.rates[code] !== undefined ? String(fxRates.rates[code]) : '—'}
              value={edits[code] ?? ''}
              onChange={(e) => setEdits((m) => ({ ...m, [code]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={saveManual}>Save hand-kept rates</Button>
        <p className="text-[11px] text-muted-foreground">Units per 1 {fxRates.base}. Type over any rate to correct it — e.g. your bank&apos;s actual rate.</p>
      </div>
      {msg && <p className="mt-1 text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
