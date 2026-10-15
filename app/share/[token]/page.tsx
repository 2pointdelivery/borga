'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Boxes, Table2 } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * Read-only shared report: someone sent you a link to a report built in
 * Borga. No session, no navigation — just the numbers, frozen at open time.
 */

interface ShareState {
  ok: boolean;
  reportName?: string;
  result?: {
    columns: Array<{ key: string; label: string; type: string }>;
    rows: Array<Array<string | number>>;
    groups?: Array<{ value: string; count: number; sum: number }>;
    totals?: { count: number; sum: number };
    rowCount: number;
  };
  error?: string;
}

export default function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [s, setS] = useState<ShareState | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/borga/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
        setS((await r.json()) as ShareState);
      } catch {
        setS({ ok: false, error: 'Could not load this report. Check your connection.' });
      }
    })();
  }, [token]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-5 pb-20">
        <header className="flex items-center gap-2 py-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Borga <span className="font-normal text-muted-foreground">/ Shared report</span>
          </span>
        </header>

        {!s && <p className="text-sm text-muted-foreground">Loading…</p>}
        {s && !s.ok && (
          <Card className="p-8 text-center">
            <p className="text-sm font-medium">This link did not work</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.error} Ask for a fresh link.</p>
          </Card>
        )}
        {s && s.ok && s.result && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h1 className="flex items-center gap-2 text-2xl font-bold"><Table2 className="h-6 w-6 text-primary" /> {s.reportName}</h1>
              <span className="text-xs text-muted-foreground">
                {s.result.groups ? `${s.result.rowCount} groups` : `${s.result.rowCount} rows`}
                {s.result.totals ? ` · ${s.result.totals.count} records` : ''}
              </span>
            </div>

            {s.result.groups ? (
              <Card className="overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-4 py-2 font-medium">Group</th><th className="px-4 py-2 font-medium">Count</th><th className="px-4 py-2 text-right font-medium">Sum</th></tr>
                  </thead>
                  <tbody>
                    {s.result.groups.map((g) => (
                      <tr key={g.value} className="border-b last:border-0">
                        <td className="px-4 py-2 font-medium">{g.value}</td>
                        <td className="px-4 py-2 text-muted-foreground">{g.count}</td>
                        <td className="px-4 py-2 text-right font-semibold">{g.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                  {s.result.totals && (
                    <tfoot className="border-t bg-muted/20 text-sm font-semibold">
                      <tr><td className="px-4 py-2">Total</td><td className="px-4 py-2">{s.result.totals.count}</td><td className="px-4 py-2 text-right">{s.result.totals.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td></tr>
                    </tfoot>
                  )}
                </table>
              </Card>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>{s.result.columns.map((c) => <th key={c.key} className="px-4 py-2 font-medium">{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {s.result.rows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {row.map((cell, j) => (
                          <td key={j} className="px-4 py-2">{typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 2 }) : cell}</td>
                        ))}
                      </tr>
                    ))}
                    {s.result.rows.length === 0 && (
                      <tr><td colSpan={s.result.columns.length || 1} className="px-4 py-8 text-center text-xs text-muted-foreground">No rows matched.</td></tr>
                    )}
                  </tbody>
                  {s.result.totals && (
                    <tfoot className="border-t bg-muted/20 text-xs font-semibold">
                      <tr>
                        <td className="px-4 py-2" colSpan={Math.max(0, (s.result.columns.length || 1) - 1)}>{s.result.totals.count} records</td>
                        <td className="px-4 py-2 text-right">{s.result.totals.sum ? s.result.totals.sum.toLocaleString(undefined, { maximumFractionDigits: 2 }) : ''}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </Card>
            )}
            <p className="text-center text-[11px] text-muted-foreground">Snapshot at open time — it does not update live. Powered by <Link href="/" className="underline">Borga</Link>.</p>
          </div>
        )}
      </div>
    </main>
  );
}
