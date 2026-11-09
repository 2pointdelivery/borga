'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ExternalLink, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { convert, rateFor, type FxRates } from '@/lib/borga/fx';

/**
 * Exchange rates & real-time currency converter powered by the Bank of Canada
 * Valet API (`https://www.bankofcanada.ca/rates/exchange/`) with a manual override fallback.
 * Invoices and bills convert at these rates; month-end revaluation in Accounting
 * measures open foreign balances against them.
 */
const COMMON = [
  'CAD', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CNY',
  'HKD', 'INR', 'MXN', 'NZD', 'SGD', 'ZAR', 'BRL', 'SEK', 'NOK', 'PLN', 'TRY', 'KRW',
];

export function FxCard() {
  const { fxRates, setFxRates, activeWorkspaceId, activeWorkspace } = useBorga();
  const wsCurrency = activeWorkspace()?.currency ?? 'USD';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  // Real-time converter state
  const [convAmount, setConvAmount] = useState('1000');
  const [convFrom, setConvFrom] = useState('USD');
  const [convTo, setConvTo] = useState('CAD');

  const refresh = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/borga/fx?ws=${encodeURIComponent(activeWorkspaceId)}`);
      const d = (await r.json()) as { ok?: boolean; error?: string; rates?: FxRates };
      if (d.ok && d.rates) {
        setFxRates(d.rates);
        setEdits({});
        const srcLabel =
          d.rates.source === 'boc'
            ? 'Bank of Canada'
            : d.rates.source === 'ecb'
              ? 'ECB fallback'
              : 'manual';
        setMsg(`Rates refreshed from ${srcLabel} — ${d.rates.base} base, published ${d.rates.date || 'today'}.`);
      } else {
        setMsg(d.error ?? 'Bank of Canada unreachable — kept the saved table. Enter rates by hand below.');
      }
    } finally {
      setBusy(false);
    }
  }, [activeWorkspaceId, setFxRates]);

  // Auto-fetch live Bank of Canada rates when opening Finance -> Banking if not yet loaded from BoC
  useEffect(() => {
    if (activeWorkspaceId && (!fxRates.date || fxRates.source !== 'boc') && Object.keys(fxRates.rates).length === 0) {
      void refresh();
    }
  }, [activeWorkspaceId, fxRates.date, fxRates.source, fxRates.rates, refresh]);

  const saveManual = async () => {
    const rates: Record<string, number> = { ...fxRates.rates };
    for (const [k, v] of Object.entries(edits)) {
      const n = Number(v);
      if (v.trim() && Number.isFinite(n) && n > 0) rates[k] = n;
    }
    const body = { ws: activeWorkspaceId, base: fxRates.base || 'CAD', rates };
    const r = await fetch('/api/borga/fx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { ok?: boolean; error?: string; rates?: FxRates };
    if (d.ok && d.rates) {
      setFxRates(d.rates);
      setEdits({});
      setMsg('Hand-kept rates saved — documents use these until the next refresh.');
    } else setMsg(d.error ?? 'Could not save rates.');
  };

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>([wsCurrency, fxRates.base || 'CAD', ...COMMON, ...Object.keys(fxRates.rates)]);
    return [...set].filter(Boolean);
  }, [wsCurrency, fxRates.base, fxRates.rates]);

  const codes = useMemo(
    () =>
      [
        ...new Set([
          wsCurrency,
          fxRates.base || 'CAD',
          ...COMMON.filter((c) => fxRates.rates[c] !== undefined || ['USD', 'CAD', 'EUR', 'GBP'].includes(c)),
        ]),
      ].slice(0, 12),
    [wsCurrency, fxRates.base, fxRates.rates],
  );

  const liveRate = useMemo(() => rateFor(fxRates, convFrom, convTo), [fxRates, convFrom, convTo]);
  const convertedValue = useMemo(
    () => convert(Number(convAmount) || 0, convFrom, convTo, fxRates),
    [convAmount, convFrom, convTo, fxRates],
  );

  const sourceBadge =
    fxRates.source === 'boc'
      ? 'Bank of Canada Valet API'
      : fxRates.source === 'ecb'
        ? 'ECB Reference Rates'
        : 'Manual Table';

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Exchange rates &amp; currency converter</p>
            <Badge variant="secondary" className="text-[10px]">
              {sourceBadge}
            </Badge>
            <a
              href="https://www.bankofcanada.ca/rates/exchange/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              bankofcanada.ca <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {fxRates.date ? `Published ${fxRates.date}` : 'Click Refresh to pull live Bank of Canada rates'} · base{' '}
            <span className="font-mono font-medium text-foreground">{fxRates.base || 'CAD'}</span> · workspace currency{' '}
            <span className="font-mono font-medium text-foreground">{wsCurrency}</span>
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Refreshing…' : 'Refresh from Bank of Canada'}
        </Button>
      </div>

      {/* Real-Time Currency Converter Bar */}
      <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            Real-time currency conversion
          </span>
          {liveRate !== null ? (
            <span className="font-mono text-muted-foreground">
              1 {convFrom} = <strong className="text-foreground">{liveRate.toFixed(4)}</strong> {convTo}
              {' · '}1 {convTo} = <strong className="text-foreground">{(1 / liveRate).toFixed(4)}</strong> {convFrom}
            </span>
          ) : (
            <span className="text-muted-foreground">Refresh rates or enter a rate below to convert</span>
          )}
        </div>
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_110px_auto_110px_1fr]">
          <Input
            type="number"
            step="any"
            value={convAmount}
            onChange={(e) => setConvAmount(e.target.value)}
            placeholder="1000"
            className="h-8 font-mono text-xs tabular-nums"
          />
          <select
            value={convFrom}
            onChange={(e) => setConvFrom(e.target.value)}
            className="h-8 rounded-md border border-border/85 bg-background px-2 font-mono text-xs"
          >
            {availableCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setConvFrom(convTo);
              setConvTo(convFrom);
            }}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-md border border-border/80 bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Swap currencies"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>
          <select
            value={convTo}
            onChange={(e) => setConvTo(e.target.value)}
            className="h-8 rounded-md border border-border/85 bg-background px-2 font-mono text-xs"
          >
            {availableCurrencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="flex h-8 items-center justify-between rounded-md border border-border/80 bg-background px-3 font-mono text-xs font-semibold tabular-nums text-foreground">
            <span>{convertedValue !== null ? convertedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</span>
            <span className="text-[10px] font-normal text-muted-foreground">{convTo}</span>
          </div>
        </div>
      </div>

      {/* Rate Grid */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {codes.map((code) => (
          <label key={code} className="flex items-center gap-1.5 text-xs">
            <span className="w-10 font-mono font-semibold">{code}</span>
            <Input
              className="h-7 font-mono text-xs tabular-nums"
              placeholder={fxRates.rates[code] !== undefined ? String(fxRates.rates[code]) : '—'}
              value={edits[code] ?? ''}
              onChange={(e) => setEdits((m) => ({ ...m, [code]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void saveManual()}>
          Save hand-kept rates
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Units per 1 {fxRates.base || 'CAD'}. Type over any rate to override with your bank&apos;s exact settlement rate.
        </p>
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
