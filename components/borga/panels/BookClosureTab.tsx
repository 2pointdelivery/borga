'use client';

import { useMemo, useState } from 'react';
import {
  Lock,
  LockOpen,
  CalendarRange,
  ClipboardCheck,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  BadgeCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MONTH_NAMES,
  QUARTER_NAMES,
  closurePeriod,
  fmtNum,
  type BookClosure as BookClosureType,
  type ClosurePeriodType,
  type SignoffReport,
} from '@/lib/borga/data';
import { CURRENCY_SYMBOL } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

export function BookClosureTab() {
  const {
    closures, addClosure, updateClosure, deleteClosure,
    journals, addJournalEntry, voidJournalEntry,
    coa, bankTxns, invoices, userName, log, activeWorkspace,
  } = useBorga();

  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => `${CURRENCY_SYMBOL[currency]}${fmtNum(Math.abs(n))}`;

  const now = new Date();
  const [periodType, setPeriodType] = useState<ClosurePeriodType>('monthly');
  const [year, setYear] = useState(now.getUTCFullYear());
  const [index, setIndex] = useState(now.getUTCMonth() + 1); // month 1-12 / quarter 1-4
  const [confirmClose, setConfirmClose] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<BookClosureType | null>(null);
  const [signoffTarget, setSignoffTarget] = useState<BookClosureType | null>(null);

  const approveSignoff = (closureId: string, reportId: SignoffReport) => {
    const c = closures.find((x) => x.id === closureId);
    if (!c) return;
    const signoffs = (c.signoffs ?? (['pl', 'bs', 'cf', 'equity'] as SignoffReport[]).map((r) => ({ reportId: r, status: 'pending' as const, issues: [] }))).map((s) =>
      s.reportId === reportId ? { ...s, status: 'approved' as const, approvedAt: new Date().toISOString(), approvedBy: userName } : s,
    );
    updateClosure(closureId, { signoffs });
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Report "${reportId}" for ${c.label} approved by ${userName}.` });
  };

  const fyEndMonth = activeWorkspace()?.fiscalYearEndMonth ?? 12;
  const period = useMemo(
    () => closurePeriod(periodType, year, periodType === 'annual' ? 0 : index, fyEndMonth),
    [periodType, year, index, fyEndMonth],
  );

  const inPeriod = (dateIso: string) => dateIso >= period.start && dateIso <= period.end;

  // ── Live pre-close checklist ────────────────────────────────────────────────
  const checklist = useMemo(() => {
    const periodJournals = journals.filter((j) => inPeriod(j.dateIso));
    const unpostedDrafts = periodJournals.filter((j) => j.status === 'draft').length;
    const unbalancedEntries = periodJournals.filter(
      (j) => Math.abs(j.lines.reduce((s, l) => s + l.debit - l.credit, 0)) > 0.005,
    ).length;
    const unreconciledBankTxns = bankTxns.filter((t) => t.status === 'unmatched').length;
    const openInvoicesOverdue = invoices.filter((i) => i.status === 'overdue').length;
    return { unpostedDrafts, unbalancedEntries, unreconciledBankTxns, openInvoicesOverdue };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journals, bankTxns, invoices, period.start, period.end]);

  const blockers = checklist.unbalancedEntries > 0;

  // ── Period P&L (what will roll into retained earnings) ─────────────────────
  const periodResult = useMemo(() => {
    let revenue = 0;
    let costs = 0;
    let expenses = 0;
    journals
      .filter((j) => j.status === 'posted' && inPeriod(j.dateIso) && !j.closesPeriod)
      .forEach((j) =>
        j.lines.forEach((l) => {
          const acct = coa.find((a) => a.id === l.accountId);
          if (!acct) return;
          if (acct.type === 'revenue') revenue += -l.debit + l.credit;
          if (acct.type === 'cost') costs += l.debit - l.credit;
          if (acct.type === 'expense') expenses += l.debit - l.credit;
        }),
      );
    return { revenue, costs, expenses, netIncome: revenue - costs - expenses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journals, coa, period.start, period.end]);

  const isClosed = closures.some((c) => c.startDate <= period.end && c.endDate >= period.start);
  const reAccount = coa.find((a) => a.type === 'equity' && /retained/i.test(a.name));

  const runClose = () => {
    if (blockers || !reAccount) return;
    const closingId = `je-close-${Date.now().toString(36)}`;
    const lines = [] as { accountId: string; debit: number; credit: number }[];
    // Zero out every revenue / expense account balance for the period.
    const deltas = new Map<string, number>();
    journals
      .filter((j) => j.status === 'posted' && inPeriod(j.dateIso) && !j.closesPeriod)
      .forEach((j) => j.lines.forEach((l) => deltas.set(l.accountId, (deltas.get(l.accountId) ?? 0) + l.debit - l.credit)));
    for (const [accountId, delta] of deltas) {
      const acct = coa.find((a) => a.id === accountId);
      if (!acct || (acct.type !== 'revenue' && acct.type !== 'expense')) continue;
      const debitNormal = acct.type === 'expense';
      const balance = debitNormal ? delta : -delta;
      if (Math.abs(balance) < 0.005) continue;
      if (balance > 0) {
        // Debit-normal balance: credit the account, debit RE.
        lines.push({ accountId, debit: 0, credit: balance });
        lines.push({ accountId: reAccount.id, debit: balance, credit: 0 });
      } else {
        lines.push({ accountId, debit: -balance, credit: 0 });
        lines.push({ accountId: reAccount.id, debit: 0, credit: -balance });
      }
    }
    if (lines.length === 0) {
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'system', message: `No revenue or expense activity in ${period.label} — period marked closed without a closing entry.` });
    } else {
      const closingEntry = {
        id: closingId,
        date: period.end.slice(5).replace('-', '/'),
        dateIso: period.end,
        memo: `Year/period-end closing entry — ${period.label}`,
        reference: `CLOSE-${period.label.replace(/\s/g, '-')}`,
        status: 'posted' as const,
        auto: 'closing' as const,
        closesPeriod: undefined,
        lines,
      };
      addJournalEntry(closingEntry);
    }
    const closure: BookClosureType = {
      id: `cl-${Date.now().toString(36)}`,
      periodType,
      label: period.label,
      startDate: period.start,
      endDate: period.end,
      closedAt: new Date().toISOString(),
      closedBy: userName,
      closingEntryId: lines.length > 0 ? closingId : undefined,
      checklist,
      netIncome: periodResult.netIncome,
      signoffs: (['pl', 'bs', 'cf', 'equity'] as SignoffReport[]).map((reportId) => ({ reportId, status: 'pending', issues: [] })),
    };
    addClosure(closure);
    log({
      agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task',
      message: `Books closed for ${period.label} (${period.start} → ${period.end}). Net income ${money(periodResult.netIncome)} rolled into retained earnings by ${userName}.`,
    });
    setConfirmClose(false);
  };

  const reopen = () => {
    if (!reopenTarget) return;
    // Void the closing entry (kept on the audit trail) — voidJournalEntry
    // posts the exact linked reversal and lifts the period lock.
    if (reopenTarget.closingEntryId) {
      const original = journals.find((j) => j.id === reopenTarget.closingEntryId);
      if (original && original.status !== 'voided') {
        voidJournalEntry(original.id, `Period ${reopenTarget.label} reopened`);
      }
    }
    deleteClosure(reopenTarget.id);
    log({
      agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system',
      message: `Books reopened for ${reopenTarget.label}. Closing entry reversed; the period is editable again.`,
    });
    setReopenTarget(null);
  };

  const years = [now.getUTCFullYear() + 1, now.getUTCFullYear(), now.getUTCFullYear() - 1, now.getUTCFullYear() - 2];

  const checklistItems: { label: string; count: number; fatal: boolean; href?: { page: string; tab: string } }[] = [
    { label: 'Unbalanced journal entries', count: checklist.unbalancedEntries, fatal: true, href: { page: 'finance', tab: 'accounting' } },
    { label: 'Unposted draft entries in period', count: checklist.unpostedDrafts, fatal: false, href: { page: 'finance', tab: 'accounting' } },
    { label: 'Unreconciled bank lines (all time)', count: checklist.unreconciledBankTxns, fatal: false, href: { page: 'finance', tab: 'banking' } },
    { label: 'Overdue customer invoices', count: checklist.openInvoicesOverdue, fatal: false, href: { page: 'sales', tab: 'invoices' } },
  ];
  const goto = (href?: { page: string; tab: string }) => {
    if (href) window.dispatchEvent(new CustomEvent('borga:nav', { detail: href }));
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Book closures" sub="Lock periods after review — closing entries roll P&L into retained earnings" />
        <Badge className={cn(isClosed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground')}>
          {isClosed ? <Lock className="mr-1 h-3 w-3" /> : <LockOpen className="mr-1 h-3 w-3" />}
          {isClosed ? 'period locked' : 'period open'}
        </Badge>
      </div>

      {/* Period selector + result */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Period type</p>
              <Select value={periodType} onValueChange={(v) => { setPeriodType(v as ClosurePeriodType); setIndex(v === 'quarterly' ? Math.ceil((now.getUTCMonth() + 1) / 3) : now.getUTCMonth() + 1); }}>
                <SelectTrigger className="mt-1 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual (FY)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Year</p>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="mt-1 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {periodType !== 'annual' && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">{periodType === 'monthly' ? 'Month' : 'Quarter'}</p>
                <Select value={String(index)} onValueChange={(v) => setIndex(Number(v))}>
                  <SelectTrigger className="mt-1 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(periodType === 'monthly' ? MONTH_NAMES.map((m, i) => ({ v: i + 1, label: m })) : [1, 2, 3, 4].map((q) => ({ v: q, label: QUARTER_NAMES[q] }))).map((o) => (
                      <SelectItem key={o.v} value={String(o.v)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {fyEndMonth !== 12 && (
              <Badge variant="outline" className="mb-1 text-[10px]">
                FY ends {MONTH_NAMES[fyEndMonth - 1]}
              </Badge>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border bg-muted/20 p-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarRange className="h-4 w-4" /> {period.start} → {period.end}</span>
            <span className="ml-auto flex gap-4">
              <span>Revenue <span className="font-mono text-emerald-600">{money(periodResult.revenue)}</span></span>
              <span>Expenses <span className="font-mono text-rose-500">{money(periodResult.expenses)}</span></span>
              <span>Net <span className="font-mono font-semibold">{money(periodResult.netIncome)}</span></span>
            </span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => setConfirmClose(true)} disabled={isClosed || blockers}>
              <Lock className="h-4 w-4" /> Close {period.label}
            </Button>
            {blockers && <span className="text-xs text-destructive">Resolve unbalanced entries before closing.</span>}
            {isClosed && <span className="text-xs text-muted-foreground">This period (or an overlapping one) is already locked.</span>}
          </div>
        </Card>

        {/* Checklist */}
        <Card className="p-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-primary" /> Pre-close checklist</p>
          <div className="mt-3 space-y-2">
            {checklistItems.map((c) => (
              <button
                key={c.label}
                onClick={() => c.count > 0 && goto(c.href)}
                disabled={c.count === 0 || !c.href}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left',
                  c.count > 0 && c.href && 'cursor-pointer hover:border-primary/40 hover:bg-primary/5',
                  c.count === 0 && 'opacity-80',
                )}
                title={c.count > 0 && c.href ? `Resolve in ${c.href.tab}` : undefined}
              >
                <span className="text-xs">{c.label}</span>
                {c.count === 0 ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600"><ShieldCheck className="h-3 w-3" /> clear</span>
                ) : (
                  <span className={cn('flex items-center gap-1 text-[11px] font-semibold', c.fatal ? 'text-destructive' : 'text-amber-600')}>
                    <AlertTriangle className="h-3 w-3" /> {c.count} →
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Closure history */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">Closure history</p>
          <p className="text-[11px] text-muted-foreground">Locked periods are read-only in the journal</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Period</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Range</th>
              <th className="px-4 py-2 text-right font-medium">Net income</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">Closed</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">By</th>
              <th className="px-4 py-2 font-medium">Sign-offs</th>
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {closures.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{c.label}</p>
                  <Badge variant="secondary" className="mt-0.5 text-[9px] capitalize">{c.periodType}</Badge>
                </td>
                <td className="hidden px-4 py-2.5 text-xs text-muted-foreground md:table-cell">{c.startDate} → {c.endDate}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{money(c.netIncome)}</td>
                <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">{new Date(c.closedAt).toLocaleDateString()}</td>
                <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">{c.closedBy}</td>
                <td className="px-4 py-2.5">
                  {(() => {
                    const so = c.signoffs ?? [];
                    const approved = so.filter((s) => s.status === 'approved').length;
                    const total = so.length || 4;
                    return (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSignoffTarget(c)}
                          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1"
                          title="Review report sign-offs"
                          style={{
                            color: approved === total ? '#15803d' : '#b45309',
                            background: approved === total ? '#dcfce7' : '#fef3c7',
                            borderColor: 'transparent',
                          }}
                        >
                          {approved}/{total} approved
                        </button>
                        {c.finalizedAt && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-600 ring-1 ring-emerald-500/30" title={`Finalized by ${c.finalizedBy ?? '—'}`}>
                            <BadgeCheck className="h-2.5 w-2.5" /> final
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    {(() => {
                      const so = c.signoffs ?? [];
                      const allApproved = (so.length ? so : []).length > 0 && so.every((s) => s.status === 'approved');
                      return (
                        <button
                          onClick={() => {
                            if (c.finalizedAt || !allApproved) return;
                            updateClosure(c.id, { finalizedAt: new Date().toISOString(), finalizedBy: userName });
                            log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `NOTIFICATION — ${c.label} books finalized by ${userName}: all report sign-offs approved, net income ${money(c.netIncome)} locked into retained earnings.` });
                          }}
                          disabled={!allApproved || !!c.finalizedAt}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-emerald-500/10 enabled:hover:text-emerald-600 disabled:opacity-30"
                          title={c.finalizedAt ? 'Period finalized' : allApproved ? 'Finalize closure (all sign-offs approved)' : 'All report sign-offs must be approved first'}
                        >
                          <BadgeCheck className="h-3 w-3" />
                        </button>
                      );
                    })()}
                    <button
                      onClick={() => setReopenTarget(c)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      title={c.finalizedAt ? 'Reopen finalized period (clears finalization)' : 'Reopen period (reverses closing entry)'}
                    >
                      <LockOpen className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {closures.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">No closures yet — the books have never been locked.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Confirm close */}
      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Close the books — {period.label}?</DialogTitle>
            <DialogDescription>
              A closing entry dated {period.end} will zero all revenue and expense balances into retained earnings, and the period becomes read-only.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-muted/20 p-3 text-sm">
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Net income to roll</span><span className="font-mono">{money(periodResult.netIncome)}</span></div>
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Retained earnings account</span><span>{reAccount ? `${reAccount.code} — ${reAccount.name}` : 'missing!'}</span></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>Cancel</Button>
            <Button onClick={runClose} disabled={blockers || !reAccount}>
              <Lock className="mr-1 h-3.5 w-3.5" /> Close books
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm reopen */}
      <Dialog open={!!reopenTarget} onOpenChange={(o) => { if (!o) setReopenTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reopen {reopenTarget?.label}?</DialogTitle>
            <DialogDescription>
              The closing entry will be reversed exactly and the period becomes editable again. The action is recorded in the activity log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={reopen}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Reopen period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign-off dialog */}
      <Dialog open={!!signoffTarget} onOpenChange={(o) => { if (!o) setSignoffTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report sign-offs — {signoffTarget?.label}</DialogTitle>
            <DialogDescription>
              Each financial statement must be approved by a responsible officer before the period is considered final.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(signoffTarget?.signoffs ?? (['pl', 'bs', 'cf', 'equity'] as SignoffReport[]).map((r) => ({ reportId: r, status: 'pending', issues: [] }))).map((s) => (
              <div key={s.reportId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-sm font-medium capitalize">{s.reportId === 'pl' ? 'Profit & Loss' : s.reportId === 'bs' ? 'Balance Sheet' : s.reportId === 'cf' ? 'Cash Flow' : 'Equity Statement'}</p>
                  {s.status === 'approved' ? (
                    <p className="text-[11px] text-emerald-600">Approved by {s.approvedBy} — {s.approvedAt ? new Date(s.approvedAt).toLocaleString() : ''}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Awaiting approval</p>
                  )}
                </div>
                {s.status === 'approved' ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Approved</span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => signoffTarget && approveSignoff(signoffTarget.id, s.reportId)}>Approve</Button>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignoffTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
