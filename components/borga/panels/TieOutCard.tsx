'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { subledgerTieOut } from '@/lib/borga/accruals';
import { revalueDocs, postFxRevaluation, resolveFxAccounts, type FxDoc } from '@/lib/borga/fx';
import { cn } from '@/lib/utils';

/**
 * AR/AP subledger tie-out: open documents must equal their ledger accounts.
 * Invoices accrue on send and bills on record, so a gap means a missing
 * accrual (old books), a deleted posting, or hand-edited history — with a
 * one-click repair that posts exactly the missing accruals.
 *
 * Plus month-end FX revaluation: open foreign-currency balances re-measured
 * at the Exchange-rates table, one balanced journal per currency, unrealized
 * gains and losses only (face values never change).
 */
export function TieOutCard() {
  const { invoices, bills, journals, coa, postMissingAccruals, addJournalEntry, fxRates, activeWorkspace } = useBorga();
  const wsCurrency = activeWorkspace()?.currency ?? 'USD';
  const [msg, setMsg] = useState<string | null>(null);
  const monthKey = new Date().toISOString().slice(0, 7);

  const tie = useMemo(() => {
    const ar = coa.find((a) => a.type === 'asset' && /receiv/i.test(a.name))?.id ?? '';
    const ap = coa.find((a) => a.type === 'liability' && /accounts payable/i.test(a.name))?.id
      ?? coa.find((a) => a.type === 'liability' && /payable/i.test(a.name) && !/tax/i.test(a.name))?.id
      ?? '';
    if (!ar || !ap) return null;
    return subledgerTieOut({ invoices, bills, journals, arAccountId: ar, apAccountId: ap });
  }, [invoices, bills, journals, coa]);

  const fxDocs: FxDoc[] = useMemo(() => [
    ...invoices
      .filter((i) => !i.voidedAt && (i.status === 'sent' || i.status === 'overdue') && (i.currency ?? wsCurrency).toUpperCase() !== wsCurrency.toUpperCase())
      .map((i) => ({
        id: i.id, number: i.number, kind: 'invoice' as const,
        foreignAmount: i.foreignAmount ?? i.amount, currency: (i.currency ?? wsCurrency).toUpperCase(),
        fxRate: i.fxRate ?? 1, openWs: i.amount,
      })),
    ...bills
      .filter((b) => !b.voidedAt && (b.status === 'unpaid' || b.status === 'scheduled') && (b.currency ?? wsCurrency).toUpperCase() !== wsCurrency.toUpperCase())
      .map((b) => ({
        id: b.id, number: b.number, kind: 'bill' as const,
        foreignAmount: b.foreignAmount ?? b.amount, currency: (b.currency ?? wsCurrency).toUpperCase(),
        fxRate: b.fxRate ?? 1, openWs: b.amount,
      })),
  ], [invoices, bills, wsCurrency]);

  const fxLines = useMemo(() => revalueDocs(fxDocs, wsCurrency, fxRates), [fxDocs, wsCurrency, fxRates]);

  if (!tie) return null;
  const clean = Math.abs(tie.ar.diff) < 0.01 && Math.abs(tie.ap.diff) < 0.01;

  const repair = () => {
    const r = postMissingAccruals();
    setMsg(r.invoices + r.bills === 0
      ? 'Nothing to repair — every open document already has its accrual. Check hand-posted journals for the gap.'
      : `Posted ${r.invoices} invoice and ${r.bills} bill accruals — the tie-out below should now agree.`);
  };

  const revalue = () => {
    const acc = resolveFxAccounts(coa);
    if (!acc) { setMsg('No gain/loss accounts found — add e.g. an “Exchange differences” revenue and expense account first.'); return; }
    const fresh = postFxRevaluation(fxLines, acc, monthKey)
      .filter((j) => !journals.some((x) => x.externalRef === j.externalRef));
    if (fresh.length === 0) { setMsg(`Already revalued for ${monthKey} — nothing new to post.`); return; }
    for (const j of fresh) addJournalEntry(j);
    setMsg(`Posted ${fresh.length} revaluation journal${fresh.length === 1 ? '' : 's'} for ${monthKey} — unrealized only, face values untouched.`);
  };

  const row = (label: string, v: { expected: number; actual: number; diff: number; openDocs: number }) => (
    <div className="flex items-center justify-between border-b py-1.5 text-sm last:border-0">
      <span className="font-medium">{label} <span className="font-normal text-muted-foreground">({v.openDocs} open)</span></span>
      <span className="font-mono text-xs">
        docs {v.expected.toFixed(2)} · ledger {v.actual.toFixed(2)} ·{' '}
        <strong className={Math.abs(v.diff) < 0.01 ? 'text-emerald-600' : 'text-rose-500'}>
          {Math.abs(v.diff) < 0.01 ? 'agrees ✓' : `off by ${v.diff.toFixed(2)}`}
        </strong>
      </span>
    </div>
  );

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Subledger tie-out — do the books match the paperwork?</p>
          <p className="text-[11px] text-muted-foreground">Open invoices must equal Accounts Receivable; open bills must equal Accounts Payable.</p>
        </div>
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', clean ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
          {clean ? 'Tied out ✓' : 'Needs attention'}
        </span>
      </div>
      <div className="mt-2">
        {row('Receivables (AR)', tie.ar)}
        {row('Payables (AP)', tie.ap)}
      </div>
      {!clean && (
        <div className="mt-2">
          <Button size="sm" onClick={repair}>Post missing accruals</Button>
          <p className="mt-1 text-[11px] text-muted-foreground">Posts exactly the missing issuance accruals (idempotent — never duplicates). If a gap remains, a journal was hand-edited or deleted.</p>
        </div>
      )}
      {fxDocs.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <p className="text-sm font-semibold">Foreign balances — revalue at today&apos;s rates?</p>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {fxLines.map((l) => (
              <p key={`${l.kind}:${l.docId}`}>{l.number} ({l.currency}): booked {l.bookedWs.toFixed(2)} → now {l.currentWs.toFixed(2)} · <strong className={l.diff > 0 ? 'text-emerald-600' : 'text-rose-500'}>{l.diff > 0 ? 'gain' : 'loss'} {Math.abs(l.diff).toFixed(2)}</strong></p>
            ))}
            {fxLines.length === 0 && <p>No exchange movement since booking — nothing to post.</p>}
          </div>
          {fxLines.length > 0 && (
            <div className="mt-1">
              <Button size="sm" variant="outline" onClick={revalue}>Post {monthKey} revaluation</Button>
              <p className="mt-1 text-[11px] text-muted-foreground">One balanced journal per currency, unrealized only. Run monthly — re-running the same month posts nothing new.</p>
            </div>
          )}
        </div>
      )}
      {msg && <p className="mt-1 text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
