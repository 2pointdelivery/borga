'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useMemo, useState } from 'react';
import { Plus, BookOpen, Trash2, SendHorizontal, FileCheck, X, Lock, ChevronRight, Ban, Pencil } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
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
  ACCOUNT_TYPE_STYLE,
  ACCOUNT_TYPE_LABEL,
  fmtNum,
  type AccountType,
  type GlAccount,
} from '@/lib/borga/data';
import {
  ACCOUNT_SIDE_HINT,
  DR_CR_LEGEND,
  NORMAL_SIDE_SHORT,
  journalLineHint,
  splitDrCr,
} from '@/lib/borga/accounting-labels';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { ProjectSelect, AccountSelect } from '../form-widgets';
import { ConfirmDialog } from '../ConfirmDialog';
import { toast } from '@/lib/toast-bus';
import { cn } from '@/lib/utils';

type LineDraft = { accountId: string; debit: string; credit: string };

/** Today as YYYY-MM-DD. A helper outside the component, so the clock is read only when a handler runs, never while rendering. */
const todayIso = () => new Date().toISOString().slice(0, 10);
/** A fresh id suffix, read from the clock only when a handler runs. */
const stamp = () => Date.now();

export function AccountingTab() {
  const {
    coa, addAccount, updateAccount, deleteAccount,
    journals, addJournalEntry, postJournalEntry, deleteJournalEntry, voidJournalEntry,
    closures, approvals, log, activeWorkspace,
  } = useBorga();

  // Period locks — entries inside a closed book period are read-only.
  const isLocked = (dateIso: string) =>
    closures.some((c) => dateIso >= c.startDate && dateIso <= c.endDate);
  const pendingPostingApproval = (journalId: string) =>
    approvals.some((a) => a.journalId === journalId && a.status === 'pending');

  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [accountOpen, setAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<{ code: string; name: string; type: AccountType; description: string }>({ code: '', name: '', type: 'expense', description: '' });
  const [confirmTarget, setConfirmTarget] = useState<{ kind: 'account' | 'journal'; id: string; name: string } | null>(null);

  const [journalOpen, setJournalOpen] = useState(false);
  const [journalForm, setJournalForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    memo: '',
    description: '',
    reference: '',
    externalRef: '',
    projectId: undefined as string | undefined,
    lines: [
      { accountId: '', debit: '', credit: '' },
      { accountId: '', debit: '', credit: '' },
    ] as LineDraft[],
  });

  // ── Toggled chart of accounts: collapsible groups per account type ───────
  const COA_TYPES = Object.keys(ACCOUNT_TYPE_STYLE) as AccountType[];
  const [openTypes, setOpenTypes] = useState<Record<AccountType, boolean>>(
    () => Object.fromEntries(COA_TYPES.map((t) => [t, true])) as Record<AccountType, boolean>,
  );
  const toggleType = (t: AccountType) => setOpenTypes((s) => ({ ...s, [t]: !s[t] }));
  const coaGroups = COA_TYPES.map((t) => ({ type: t, accounts: coa.filter((a) => a.type === t) }))
    .filter((g) => g.accounts.length > 0);

  // ── Trial balance from posted entries ─────────────────────────────────────
  // Double-entry (IFRS): each account lands in Dr or Cr by the *sign* of its
  // net balance, so total Dr always equals total Cr on balanced books.
  const trialBalance = useMemo(() => {
    const deltas = new Map<string, number>();
    journals
      .filter((j) => j.status === 'posted')
      .forEach((j) =>
        j.lines.forEach((l) => deltas.set(l.accountId, (deltas.get(l.accountId) ?? 0) + l.debit - l.credit)),
      );
    const rows = coa.map((a) => {
      const { dr, cr } = splitDrCr(deltas.get(a.id) ?? 0);
      return { account: a, debits: dr, credits: cr };
    });
    const totalDebits = rows.reduce((s, r) => s + r.debits, 0);
    const totalCredits = rows.reduce((s, r) => s + r.credits, 0);
    return { rows: rows.filter((r) => r.debits || r.credits), totalDebits, totalCredits, balanced: Math.abs(totalDebits - totalCredits) < 0.005 };
  }, [coa, journals]);

  // Draft totals for the journal dialog
  const draftTotals = useMemo(() => {
    const debits = journalForm.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credits = journalForm.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    const accountsChosen = journalForm.lines.every((l) => l.accountId);
    const hasValue = debits > 0 || credits > 0;
    return { debits, credits, balanced: Math.abs(debits - credits) < 0.005 && hasValue && accountsChosen };
  }, [journalForm.lines]);

  const submitAccount = () => {
    if (!accountForm.code.trim() || !accountForm.name.trim()) return;
    const duplicate = coa.some((a) => a.code === accountForm.code.trim() && a.id !== editingAccount);
    if (duplicate) {
      toast({ title: 'Code already in use', description: `An account with code ${accountForm.code.trim()} already exists.`, variant: 'error' });
      return;
    }
    if (editingAccount) {
      updateAccount(editingAccount, {
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        type: accountForm.type,
        description: accountForm.description.trim() || undefined,
      });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `GL account updated: ${accountForm.code.trim()} — ${accountForm.name.trim()}.` });
    } else {
      addAccount({
        id: `gl-${stamp()}`,
        code: accountForm.code.trim(),
        name: accountForm.name.trim(),
        type: accountForm.type,
        description: accountForm.description.trim() || undefined,
      });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `GL account created: ${accountForm.code.trim()} — ${accountForm.name.trim()}.` });
    }
    setAccountForm({ code: '', name: '', type: 'expense', description: '' });
    setEditingAccount(null);
    setAccountOpen(false);
  };

  const openEditAccount = (a: GlAccount) => {
    setEditingAccount(a.id);
    setAccountForm({ code: a.code, name: a.name, type: a.type, description: a.description ?? '' });
    setAccountOpen(true);
  };

  const submitJournal = (post: boolean) => {
    if (!draftTotals.balanced) return;
    // Machine-readable date for period reporting; falls back to today.
    const parsedIso = new Date(journalForm.date);
    const dateIso = Number.isNaN(parsedIso.getTime())
      ? todayIso()
      : parsedIso.toISOString().slice(0, 10);
    const entry = {
      id: `je-${stamp()}`,
      date: journalForm.date,
      dateIso,
      memo: journalForm.memo.trim() || 'Journal entry',
      description: journalForm.description.trim() || undefined,
      reference: journalForm.reference.trim() || undefined,
      externalRef: journalForm.externalRef.trim() || undefined,
      projectId: journalForm.projectId,
      status: (post ? 'posted' : 'draft') as 'posted' | 'draft',
      lines: journalForm.lines
        .filter((l) => l.accountId)
        .map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
    };
    addJournalEntry(entry);
    log({
      agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task',
      message: `Journal ${post ? 'posted' : 'drafted'}: ${entry.memo} (${money(draftTotals.debits)} across ${entry.lines.length} lines).`,
    });
    setJournalForm({ date: new Date().toISOString().slice(0, 10), memo: '', description: '', reference: '', externalRef: '', projectId: undefined, lines: [{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }] });
    setJournalOpen(false);
  };

  const chartData = trialBalance.rows.slice(0, 8).map((r) => ({
    name: `${r.account.code}`,
    debits: r.debits,
    credits: r.credits,
  }));

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="General ledger accounting" sub={`${coa.length} accounts — ${journals.length} journal entries — double-entry with posting controls`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEditingAccount(null); setAccountForm({ code: '', name: '', type: 'expense', description: '' }); setAccountOpen(true); }}>
            <Plus className="h-4 w-4" /> GL account
          </Button>
          <Button onClick={() => setJournalOpen(true)}>
            <BookOpen className="h-4 w-4" /> Journal entry
          </Button>
        </div>
      </div>

      {/* Trial balance */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><FileCheck className="h-3.5 w-3.5" /> Trial balance</p>
            <p className="text-[11px] text-muted-foreground">Posted entries only · double-entry (IFRS): total Dr must equal total Cr</p>
          </div>
          <Badge className={cn(trialBalance.balanced ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600')}>
            {trialBalance.balanced ? 'Balanced' : `Out by ${money(Math.abs(trialBalance.totalDebits - trialBalance.totalCredits))}`}
          </Badge>
        </div>
        <p className="border-b bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground" title={DR_CR_LEGEND}>
          {DR_CR_LEGEND}
        </p>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">Type</th>
              <th className="px-4 py-2 text-right font-medium" title="Debit: increases assets, costs and expenses; decreases liabilities, equity and revenue">Dr — debit</th>
              <th className="px-4 py-2 text-right font-medium" title="Credit: increases liabilities, equity and revenue; decreases assets, costs and expenses">Cr — credit</th>
            </tr>
          </thead>
          <tbody>
            {trialBalance.rows.map((r) => (
              <tr key={r.account.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2 font-mono text-xs">{r.account.code}</td>
                <td className="px-4 py-2" title={ACCOUNT_SIDE_HINT[r.account.type]}>{r.account.name}</td>
                <td className="hidden px-4 py-2 sm:table-cell">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize ring-1', ACCOUNT_TYPE_STYLE[r.account.type])}>
                    {r.account.type}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.debits ? money(r.debits) : '…'}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.credits ? money(r.credits) : '…'}</td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td className="px-4 py-2" colSpan={3}>Totals</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{money(trialBalance.totalDebits)}</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{money(trialBalance.totalCredits)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Balances chart */}
        <Card className="p-5">
          <SectionTitle title="Balance distribution" sub="Debit / credit balances per account" />
          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -8, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} unit="K" tickFormatter={(v: number) => String(Math.round(v / 1000))} />
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} formatter={(v) => money(Number(v))} />
                <Bar dataKey="debits" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={`d${i}`} fill="var(--chart-2)" />
                  ))}
                </Bar>
                <Bar dataKey="credits" radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={`c${i}`} fill="var(--chart-1)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Chart of accounts — toggled by account type */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
            <p className="text-sm font-semibold">Chart of accounts</p>
            <button
              onClick={() => setOpenTypes(() => Object.fromEntries(COA_TYPES.map((t) => [t, !COA_TYPES.every((t) => openTypes[t])])) as Record<AccountType, boolean>)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
              title="Toggle all groups"
            >
              {COA_TYPES.every((t) => openTypes[t]) ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {coaGroups.map((g) => (
              <div key={g.type} className="border-b last:border-0">
                <button
                  onClick={() => toggleType(g.type)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/20"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', openTypes[g.type] && 'rotate-90')} />
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize ring-1', ACCOUNT_TYPE_STYLE[g.type])}>
                    {g.type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ACCOUNT_TYPE_LABEL[g.type]} — {g.accounts.length} account{g.accounts.length === 1 ? '' : 's'}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground" title={ACCOUNT_SIDE_HINT[g.type]}>
                    {NORMAL_SIDE_SHORT[g.type]}
                  </span>
                </button>
                {openTypes[g.type] && (
                  <table className="w-full text-sm">
                    <tbody>
                      {g.accounts.map((a) => (
                        <tr key={a.id} className="border-t border-border/60 hover:bg-muted/20">
                          <td className="w-16 px-4 py-2 pl-9 font-mono text-xs">{a.code}</td>
                          <td className="px-4 py-2">
                            {a.name}
                            {a.description && <span className="block text-[10px] text-muted-foreground">{a.description}</span>}
                          </td>
                          <td className="w-16 px-2 py-2">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                onClick={() => openEditAccount(a)}
                                title="Edit account"
                                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setConfirmTarget({ kind: 'account', id: a.id, name: a.name })}
                                disabled={journals.some((j) => j.lines.some((l) => l.accountId === a.id))}
                                title={journals.some((j) => j.lines.some((l) => l.accountId === a.id)) ? 'Account is used by journal entries' : 'Delete account'}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-destructive/10 enabled:hover:text-destructive disabled:opacity-30"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            {coaGroups.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">No accounts yet.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Journal */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">Journal entries</p>
          <p className="text-[11px] text-muted-foreground">Drafts must be balanced before posting</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Memo</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Lines</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {journals.map((j) => {
              const amount = j.lines.reduce((s, l) => s + l.debit, 0);
              const balanced = Math.abs(j.lines.reduce((s, l) => s + l.debit - l.credit, 0)) < 0.005;
              return (
                <tr key={j.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">{j.date}</td>
                  <td className="px-4 py-2.5">
                    <p className={cn('font-medium', j.status === 'voided' && 'line-through opacity-50')}>{j.memo}</p>
                    {j.reference && <p className="text-[11px] text-muted-foreground">ref {j.reference}</p>}
                    {j.externalRef && <p className="text-[11px] text-muted-foreground">ext {j.externalRef}</p>}
                    {j.auto === 'reversal' && <p className="text-[11px] text-violet-600">reversal entry</p>}
                    {j.voidReason && <p className="text-[11px] text-rose-500">void reason: {j.voidReason}</p>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">
                    {j.lines.map((l, i) => {
                      const acct = coa.find((a) => a.id === l.accountId);
                      return (
                        <span
                          key={i}
                          className="mr-2 whitespace-nowrap text-[11px]"
                          title={acct ? journalLineHint(acct.name, acct.type) : undefined}
                        >
                          {acct?.code} {l.debit > 0 ? `Dr ${fmtNum(l.debit)}` : ''}{l.credit > 0 ? `Cr ${fmtNum(l.credit)}` : ''}
                        </span>
                      );
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{money(amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1',
                      j.status === 'posted'
                        ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30'
                        : j.status === 'voided'
                          ? 'bg-rose-500/10 text-rose-600 ring-rose-500/30'
                          : 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
                    )}>
                      {j.status}
                    </span>
                    {!balanced && !j.voidedAt && <span className="ml-1 text-[10px] text-destructive">unbalanced</span>}
                    {j.status === 'draft' && pendingPostingApproval(j.id) && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 ring-1 ring-violet-500/30">
                        <Lock className="h-2.5 w-2.5" /> awaiting approval
                      </span>
                    )}
                    {isLocked(j.dateIso) && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                        <Lock className="h-2.5 w-2.5" /> locked
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      {j.status === 'draft' && (
                        <button
                          onClick={() => { postJournalEntry(j.id); log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Journal posted: ${j.memo}.` }); }}
                          disabled={!balanced || isLocked(j.dateIso)}
                          title={isLocked(j.dateIso) ? 'Period is closed — reopen in Book Closure to edit' : balanced ? 'Post to GL' : 'Cannot post an unbalanced entry'}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-primary/10 enabled:hover:text-primary disabled:opacity-30"
                        >
                          <SendHorizontal className="h-3 w-3" />
                        </button>
                      )}
                      {/* Lock rule: drafts delete; posted entries are voided in place with a linked reversal (audit trace). */}
                      {j.status === 'draft' && (
                        <button
                          onClick={() => setConfirmTarget({ kind: 'journal', id: j.id, name: j.memo })}
                          disabled={isLocked(j.dateIso)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-destructive/10 enabled:hover:text-destructive disabled:opacity-30"
                          title={isLocked(j.dateIso) ? 'Period is closed — reopen in Book Closure to delete' : 'Delete draft entry'}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {j.status === 'posted' && !j.auto && (
                        <button
                          onClick={() => { const r = window.prompt(`Void journal entry "${j.memo}"? A linked reversal entry will be posted and both stay on the audit trail.`, 'Entered in error'); if (r !== null) voidJournalEntry(j.id, r ?? undefined); }}
                          title="Void entry — posts a linked reversal, record kept for audit"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                        >
                          <Ban className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {journals.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">No journal entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* New / edit account dialog */}
      <Dialog open={accountOpen} onOpenChange={(o) => { setAccountOpen(o); if (!o) setEditingAccount(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAccount ? 'Edit GL account' : 'New GL account'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Code *</label>
                <Input value={accountForm.code} onChange={(e) => setAccountForm({ ...accountForm, code: e.target.value })} placeholder="1400" className="mt-1" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Name *</label>
                <Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} placeholder="Inventory" className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={accountForm.type} onValueChange={(v) => setAccountForm({ ...accountForm, type: v as AccountType })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACCOUNT_TYPE_STYLE) as AccountType[]).map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground" title={ACCOUNT_SIDE_HINT[accountForm.type]}>
                {NORMAL_SIDE_SHORT[accountForm.type]}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input value={accountForm.description} onChange={(e) => setAccountForm({ ...accountForm, description: e.target.value })} placeholder="Optional note" className="mt-1" />
            </div>
            {coa.some((a) => a.code === accountForm.code.trim() && a.id !== editingAccount) && (
              <p className="text-xs text-destructive">An account with this code already exists.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAccountOpen(false); setEditingAccount(null); }}>Cancel</Button>
            <Button onClick={submitAccount} disabled={!accountForm.code.trim() || !accountForm.name.trim() || coa.some((a) => a.code === accountForm.code.trim() && a.id !== editingAccount)}>
              {editingAccount ? 'Save changes' : 'Create account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Journal entry dialog */}
      <Dialog open={journalOpen} onOpenChange={setJournalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New journal entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input type="date" value={journalForm.date} onChange={(e) => setJournalForm({ ...journalForm, date: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reference</label>
                <Input value={journalForm.reference} onChange={(e) => setJournalForm({ ...journalForm, reference: e.target.value })} placeholder="#2221" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">External reference</label>
                <Input value={journalForm.externalRef} onChange={(e) => setJournalForm({ ...journalForm, externalRef: e.target.value })} placeholder="Cheque / bank txn" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Memo</label>
                <Textarea rows={2} value={journalForm.memo} onChange={(e) => setJournalForm({ ...journalForm, memo: e.target.value })} placeholder="August payroll run" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Project</label>
                <div className="mt-1">
                  <ProjectSelect value={journalForm.projectId} onChange={(v) => setJournalForm({ ...journalForm, projectId: v })} />
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Transaction description</label>
              <Textarea
                rows={2}
                value={journalForm.description}
                onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })}
                placeholder="Full description of the transaction for the audit trail"
                className="mt-1"
              />
            </div>

            <div className="rounded-xl border p-3">
              <div className="grid grid-cols-[1fr_84px_84px_28px] items-center gap-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Account</span>
                <span title="Debit: increases assets, costs and expenses; decreases liabilities, equity and revenue">Dr — debit ({currency})</span>
                <span title="Credit: increases liabilities, equity and revenue; decreases assets, costs and expenses">Cr — credit</span>
                <span />
              </div>
              <div className="space-y-2">
                {journalForm.lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_84px_84px_28px] items-center gap-2">
                    <AccountSelect
                      value={line.accountId}
                      onChange={(v) =>
                        setJournalForm({
                          ...journalForm,
                          lines: journalForm.lines.map((l, i) => (i === idx ? { ...l, accountId: v ?? '' } : l)),
                        })
                      }
                      placeholder="Select account…"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={line.debit}
                      onChange={(e) =>
                        setJournalForm({
                          ...journalForm,
                          lines: journalForm.lines.map((l, i) =>
                            i === idx
                              ? e.target.value
                                ? { accountId: l.accountId, debit: e.target.value, credit: '' }
                                : { accountId: l.accountId, debit: '', credit: l.credit }
                              : l,
                          ),
                        })
                      }
                      placeholder="0"
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={line.credit}
                      onChange={(e) =>
                        setJournalForm({
                          ...journalForm,
                          lines: journalForm.lines.map((l, i) =>
                            i === idx
                              ? e.target.value
                                ? { accountId: l.accountId, debit: '', credit: e.target.value }
                                : { accountId: l.accountId, debit: l.debit, credit: '' }
                              : l,
                          ),
                        })
                      }
                      placeholder="0"
                      className="h-8 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setJournalForm({ ...journalForm, lines: journalForm.lines.filter((_, i) => i !== idx) })}
                      disabled={journalForm.lines.length <= 2}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:text-destructive disabled:opacity-30"
                      title="Remove line"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setJournalForm({ ...journalForm, lines: [...journalForm.lines, { accountId: '', debit: '', credit: '' }] })}>
                  <Plus className="h-3 w-3" /> Add line
                </Button>
                <p className={cn('font-mono', draftTotals.balanced ? 'text-emerald-600' : 'text-muted-foreground')} title="Double-entry: total debits must equal total credits before posting">
                  Dr {money(draftTotals.debits)} / Cr {money(draftTotals.credits)}
                  {draftTotals.balanced ? ' ✓' : ''}
                </p>
              </div>
            </div>

            {/* Which side increases each chosen account — read from the account type. */}
            {journalForm.lines.some((l) => l.accountId) && (
              <div className="space-y-0.5 rounded-xl bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                {[...new Map(
                  journalForm.lines
                    .filter((l) => l.accountId)
                    .map((l) => coa.find((a) => a.id === l.accountId))
                    .filter((a): a is GlAccount => !!a)
                    .map((a) => [a.id, a] as const),
                ).values()].map((a) => (
                  <p key={a.id}><span className="font-medium text-foreground">{a.code} — {a.name}:</span> {ACCOUNT_SIDE_HINT[a.type]}</p>
                ))}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Note: entering a debit clears the credit on the same line (single-sided per line). Total Dr must equal total Cr before posting.
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => submitJournal(false)} disabled={!draftTotals.balanced}>Save draft</Button>
            <Button variant="ghost" onClick={() => setJournalOpen(false)}>Cancel</Button>
            <Button onClick={() => submitJournal(true)} disabled={!draftTotals.balanced}>
              <SendHorizontal className="mr-1 h-3.5 w-3.5" /> Post to GL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        title={confirmTarget?.kind === 'account' ? `Delete account "${confirmTarget?.name ?? ''}"?` : `Delete journal "${confirmTarget?.name ?? ''}"?`}
        description={confirmTarget?.kind === 'account'
          ? 'The unused account is removed. Journal entries are untouched — accounts in use cannot be deleted.'
          : 'The draft journal entry is removed. Posted entries are never deleted — void them instead.'}
        confirmLabel={confirmTarget?.kind === 'account' ? 'Delete account' : 'Delete draft'}
        onConfirm={() => {
          if (!confirmTarget) return;
          if (confirmTarget.kind === 'account') {
            deleteAccount(confirmTarget.id);
            log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Chart of accounts: removed "${confirmTarget.name}".` });
          } else {
            if (deleteJournalEntry(confirmTarget.id)) {
              log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Draft journal deleted: ${confirmTarget.name}.` });
            }
          }
          setConfirmTarget(null);
        }}
      />
    </div>
  );
}

