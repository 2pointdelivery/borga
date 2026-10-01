'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Landmark,
  Upload,
  Link2,
  Unplug,
  Check,
  Zap,
  EyeOff,
  Trash2,
  Plus,
  RefreshCw,
  Pencil,
  Hand,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  fmtNum, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, normalizeReconciliationPattern,
  type BankAccount, type BankTxn, type BankSource, type PaymentMethod, type ReconciliationRule,
} from '@/lib/borga/data';
import { CURRENCY_SYMBOL, BANK_ACCOUNT_KINDS, BANK_ACCOUNT_KIND_LABEL } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { DateInput, Field } from '../form-widgets';
import { cn } from '@/lib/utils';

/**
 * Reconciliation engine — deterministic two-pass matcher:
 *  1. exact amount match (± date proximity bonus)
 *  2. same-amount candidates within the ledger regardless of description
 * Candidates come from the transaction ledger (revenue = inflow, expense =
 * outflow) plus posted journal entries (cash account lines).
 */
function buildCandidates(
  finance: { label: string; amount: number; kind: string }[],
  journals: { id: string; memo: string; status: string; lines: { accountId: string; debit: number; credit: number }[] }[],
  cashAccountIds: Set<string>,
): { ref: string; amount: number; matchedTo?: string[] }[] {
  const out: { ref: string; amount: number; matchedTo?: string[] }[] = [];
  for (const f of finance) {
    const signed = f.kind === 'expense' ? -f.amount : f.amount;
    out.push({ ref: `Ledger — ${f.label}`, amount: signed });
  }
  for (const j of journals.filter((j) => j.status === 'posted')) {
    for (const line of j.lines) {
      if (!cashAccountIds.has(line.accountId)) continue;
      const signed = line.debit > 0 ? line.debit : -line.credit;
      out.push({ ref: `Journal — ${j.memo}`, amount: signed });
      break; // only the cash-side line per entry
    }
  }
  return out;
}

interface MatchSuggestion {
  ref: string;
  accountId?: string;
  fromRule?: boolean;
}

/**
 * Rule memory takes priority over amount coincidence: a description pattern
 * the user has confirmed before is a stronger signal than two transactions
 * happening to share an amount. Falls back to the existing amount matcher.
 */
function suggestMatch(txn: BankTxn, candidates: ReturnType<typeof buildCandidates>, rules: ReconciliationRule[]): MatchSuggestion | null {
  const pattern = normalizeReconciliationPattern(txn.description);
  if (pattern) {
    const rule = rules.find((r) => r.pattern && (pattern.includes(r.pattern) || r.pattern.includes(pattern)));
    if (rule) return { ref: `Rule match — "${rule.pattern}"`, accountId: rule.accountId, fromRule: true };
  }
  // Pass 1: exact amount
  const exact = candidates.find((c) => Math.abs(c.amount - txn.amount) < 0.005 && !txn.matchedRef);
  if (exact) return { ref: exact.ref };
  // Pass 2: closest amount within 5% for larger txns
  const near = candidates
    .filter((c) => c.amount !== 0 && Math.abs(c.amount - txn.amount) / Math.abs(txn.amount) < 0.05)
    .sort((a, b) => Math.abs(a.amount - txn.amount) - Math.abs(b.amount - txn.amount))[0];
  if (near) return { ref: `${near.ref} (≈ ${fmtNum(Math.abs(near.amount))})` };
  return null;
}

export function BankingTab() {
  const {
    bankAccounts, addBankAccount, updateBankAccount, deleteBankAccount,
    bankTxns, addBankTxns, matchBankTxn, setBankTxnAccount, unmatchBankTxn, excludeBankTxn, deleteBankTxn, updateBankTxn, setSettings,
    reconciliationRules, recordReconciliationMatch, deleteReconciliationRule,
    finance, journals, coa, composio, log, activeWorkspace, settings,
  } = useBorga();

  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => `${CURRENCY_SYMBOL[currency]}${fmtNum(n)}`;

  const [selectedAccountId, setSelectedAccountId] = useState<string>(bankAccounts[0]?.id ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', institution: '', last4: '', kind: 'checking' as BankAccount['kind'], balance: '' });
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [editTarget, setEditTarget] = useState<BankTxn | null>(null);
  const [editForm, setEditForm] = useState({ date: '', description: '', amount: '0', method: 'cash' as PaymentMethod });
  const [matchTarget, setMatchTarget] = useState<BankTxn | null>(null);
  const [manualAccountId, setManualAccountId] = useState('');

  const activeAccount = bankAccounts.find((b) => b.id === selectedAccountId) ?? bankAccounts[0] ?? null;
  const accountTxns = useMemo(
    () => bankTxns.filter((t) => t.bankAccountId === (activeAccount?.id ?? '')),
    [bankTxns, activeAccount],
  );
  const visibleTxns = useMemo(
    () => (methodFilter === 'all' ? accountTxns : accountTxns.filter((t) => (t.method ?? 'cash') === methodFilter)),
    [accountTxns, methodFilter],
  );

  const cashAccountIds = useMemo(
    () => new Set(coa.filter((a) => a.type === 'asset').map((a) => a.id)),
    [coa],
  );
  const candidates = useMemo(
    () => buildCandidates(finance, journals, cashAccountIds),
    [finance, journals, cashAccountIds],
  );

  const recon = useMemo(() => {
    const matched = accountTxns.filter((t) => t.status === 'matched');
    const excluded = accountTxns.filter((t) => t.status === 'excluded');
    const unmatched = accountTxns.filter((t) => t.status === 'unmatched');
    const bookTotal =
      finance.reduce((s, f) => s + (f.kind === 'expense' ? -f.amount : f.amount), 0);
    const bankTotal = accountTxns
      .filter((t) => t.status !== 'excluded')
      .reduce((s, t) => s + t.amount, 0);
    const matchedTotal = matched.reduce((s, t) => s + t.amount, 0);
    return {
      matchedCount: matched.length,
      excludedCount: excluded.length,
      unmatchedCount: unmatched.length,
      reconciledPct: accountTxns.length ? Math.round(((matched.length + excluded.length) / accountTxns.length) * 100) : 0,
      difference: bankTotal - matchedTotal,
      bankTotal,
      bookTotal,
    };
  }, [accountTxns, finance]);

  // End-of-day auto-reconciliation: runs automatically when the last run is
  // older than 12 hours (timestamp kept per workspace in settings).
  const eodRef = useRef(false);
  useEffect(() => {
    if (eodRef.current) return;
    eodRef.current = true;
    const last = settings.lastAutoMatchAt ? new Date(settings.lastAutoMatchAt).getTime() : 0;
    if (Date.now() - last < 12 * 3600_000) return;
    let count = 0;
    for (const t of bankTxns.filter((x) => x.status === 'unmatched')) {
      const suggestion = suggestMatch(t, candidates, reconciliationRules);
      if (suggestion) {
        matchBankTxn(t.id, suggestion.ref.replace(' (≈', ' — ≈').replace('))', ')'), suggestion.accountId);
        if (suggestion.accountId) recordReconciliationMatch(t.description, suggestion.accountId);
        count++;
      }
    }
    setSettings({ lastAutoMatchAt: new Date().toISOString() });
    if (count > 0) {
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'agent', kind: 'sync', message: `End-of-day auto-reconciliation matched ${count} bank transaction(s).` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankTxns, candidates]);

  /** Auto-match every unmatched txn that has a deterministic suggestion. */
  const autoMatchAll = () => {
    let count = 0;
    for (const t of accountTxns.filter((x) => x.status === 'unmatched')) {
      const suggestion = suggestMatch(t, candidates, reconciliationRules);
      if (suggestion) {
        matchBankTxn(t.id, suggestion.ref.replace(' (≈', ' — ≈').replace('))', ')'), suggestion.accountId);
        if (suggestion.accountId) recordReconciliationMatch(t.description, suggestion.accountId);
        count++;
      }
    }
    log({
      agentId: 'a-finance', agentName: 'Ledger', actor: 'agent', kind: 'task',
      message: `Auto-reconciliation matched ${count} of ${accountTxns.filter((x) => x.status === 'unmatched').length + count} bank transactions.`,
    });
  };

  /** Parse pasted/uploaded CSV: date,description,amount (one per line). */
  const parseAndImport = () => {
    if (!activeAccount) return;
    const errors: string[] = [];
    const parsed: BankTxn[] = [];
    csvText.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 3) {
        errors.push(`Line ${i + 1}: expected "date,description,amount"`);
        return;
      }
      const [date, description, amountRaw] = parts;
      const amount = Number(amountRaw.replace(/[^0-9.\-]/g, ''));
      if (!date || !description || !Number.isFinite(amount) || amount === 0) {
        errors.push(`Line ${i + 1}: invalid values`);
        return;
      }
      parsed.push({
        id: `bt-${Date.now()}-${i}`,
        bankAccountId: activeAccount.id,
        date,
        description,
        amount,
        status: 'unmatched',
      });
    });
    setCsvErrors(errors.slice(0, 5));
    if (parsed.length > 0) {
      addBankTxns(parsed);
      log({
        agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync',
        message: `Imported ${parsed.length} statement lines into ${activeAccount.name}.`,
      });
      setCsvText('');
      setImportOpen(false);
    }
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
  };

  /**
   * Real bank connectivity via composio.dev: Plaid toolkit OAuth handshake.
   * Uses the same production proxy as every other integration.
   */
  const connectViaComposio = async (account: BankAccount) => {
    updateBankAccount(account.id, { status: 'disconnected' });
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'connect',
          appName: 'plaid',
          entityId: `banking-${activeWorkspace()?.id ?? 'default'}`,
          apiKey: composio.apiKey,
        }),
      });
      const d = (await res.json()) as { ok?: boolean; connection?: { redirectUrl?: string }; error?: string };
      const redirectUrl = d.connection?.redirectUrl;
      if (!d.ok || !redirectUrl) throw new Error(d.error ?? 'no redirect');
      window.open(redirectUrl, '_blank', 'noopener,noreferrer,width=640,height=720');

      let polls = 0;
      const timer = setInterval(async () => {
        polls++;
        if (polls > 30) {
          clearInterval(timer);
          return;
        }
        try {
            const pr = await fetch('/api/borga/composio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
              body: JSON.stringify({ action: 'accounts', apiKey: composio.apiKey }),
            });
            const pd = await pr.json() as { ok?: boolean; error?: string; accounts?: { appName?: string; status?: string }[] };
            if (!pd.ok) {
              clearInterval(timer);
              updateBankAccount(account.id, { status: 'disconnected' });
              return;
            }
            const found = pd.accounts?.find((a) => a.appName?.toLowerCase() === 'plaid' && a.status === 'ACTIVE');
          if (found) {
            clearInterval(timer);
            updateBankAccount(account.id, { status: 'connected', source: 'composio-plaid' });
            log({
              agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync',
              message: `${account.institution} connected through composio.dev (Plaid). Statement sync is live.`,
            });
          }
        } catch { /* keep polling */ }
      }, 2000);
    } catch (err) {
      log({
        agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'system',
        message: `Plaid link failed${err instanceof Error ? `: ${err.message}` : ''}. Add the Plaid toolkit auth config in your composio.dev dashboard, or import statements via CSV below.`,
      });
    }
  };

  const submitNewAccount = () => {
    if (!newForm.name.trim()) return;
    addBankAccount({
      id: `bank-${Date.now()}`,
      name: newForm.name.trim(),
      institution: newForm.institution.trim() || 'Manual',
      currency,
      last4: newForm.last4.trim() || '0000',
      kind: newForm.kind,
      balance: Number(newForm.balance) || 0,
      source: 'manual' as BankSource,
      status: 'disconnected',
    });
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Bank account registered: ${newForm.name.trim()}.` });
    setNewForm({ name: '', institution: '', last4: '', kind: 'checking', balance: '' });
    setAddOpen(false);
  };

  const openEdit = (t: BankTxn) => {
    setEditTarget(t);
    setEditForm({
      date: t.date,
      description: t.description,
      amount: String(Math.abs(t.amount)),
      method: t.method ?? 'cash',
    });
  };

  const submitEdit = () => {
    if (!editTarget) return;
    const amt = Number(editForm.amount) || 0;
    updateBankTxn(editTarget.id, {
      date: editForm.date,
      description: editForm.description.trim() || editTarget.description,
      amount: editTarget.amount < 0 ? -amt : amt,
      method: editForm.method,
    });
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Bank line #${editTarget.id.slice(-4)} edited — ${editForm.description.trim() || editTarget.description}, ${PAYMENT_METHOD_LABEL[editForm.method]}, ${money(amt)}.` });
    setEditTarget(null);
  };

  const submitManualMatch = (ref: string) => {
    if (!matchTarget) return;
    matchBankTxn(matchTarget.id, ref, manualAccountId || undefined);
    if (manualAccountId) recordReconciliationMatch(matchTarget.description, manualAccountId);
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Bank line #${matchTarget.id.slice(-4)} matched to ${ref}${manualAccountId ? `, posted to ${coa.find((a) => a.id === manualAccountId)?.name ?? manualAccountId}` : ''}.` });
    setMatchTarget(null);
    setManualAccountId('');
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Banking & reconciliation" sub="Connect accounts, import statements and reconcile against the books" />
        <Button variant="outline" onClick={() => setImportOpen(true)} disabled={!activeAccount}>
          <Upload className="h-4 w-4" /> Import statement
        </Button>
      </div>

      {/* Bank cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {bankAccounts.map((b) => (
          <Card
            key={b.id}
            className={cn('cursor-pointer p-4 transition-shadow hover:shadow-md', activeAccount?.id === b.id && 'ring-1 ring-primary/40')}
            onClick={() => setSelectedAccountId(b.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Landmark className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{b.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{b.institution} — ——{b.last4} — {BANK_ACCOUNT_KIND_LABEL[b.kind] ?? b.kind}</p>
                </div>
              </div>
              <Badge className={cn('shrink-0 text-[9px]', b.status === 'connected' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                {b.status}
              </Badge>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-lg font-semibold">{money(b.balance)}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{b.currency}</p>
              </div>
              <div className="flex gap-1">
                {b.source !== 'composio-plaid' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    disabled={!composio.apiKey}
                    title={composio.apiKey ? 'Link via composio.dev (Plaid)' : 'Requires composio.dev API key'}
                    onClick={(e) => { e.stopPropagation(); void connectViaComposio(b); }}
                  >
                    <Link2 className="h-3 w-3" /> Link
                  </Button>
                ) : (
                  <Badge className="gap-1 bg-emerald-500/10 text-emerald-600 text-[9px]"><Zap className="h-2.5 w-2.5" /> live</Badge>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteBankAccount(b.id); }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remove account"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </Card>
        ))}

        <button
          onClick={() => setAddOpen(true)}
          className="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          Add bank account
        </button>
      </div>
      {!composio.apiKey && (
        <p className="rounded-lg border border-dashed bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
          Live feed linking uses composio.dev (Plaid toolkit) — add your API key under Integrations → AI &amp; Voice to enable it. Meanwhile, statements import via CSV and reconcile fully offline.
        </p>
      )}

      {/* Reconciliation summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Reconciled</p>
          <p className="mt-1 text-xl font-semibold">{recon.reconciledPct}%</p>
          <p className="text-[10px] text-muted-foreground">{recon.matchedCount} matched — {recon.excludedCount} excluded</p>
        </Card>
        <Card className={cn('p-3', recon.unmatchedCount === 0 ? '' : 'text-amber-600')}>
          <p className="text-[11px] text-muted-foreground">Unmatched lines</p>
          <p className="mt-1 text-xl font-semibold">{recon.unmatchedCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Bank movement ({activeAccount?.currency})</p>
          <p className="mt-1 text-xl font-semibold">{money(recon.bankTotal)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Unreconciled difference</p>
          <p className={cn('mt-1 text-xl font-semibold', Math.abs(recon.difference) < 0.005 ? 'text-emerald-600' : '')}>{money(recon.difference)}</p>
          <p className="text-[10px] text-muted-foreground">bank vs matched book entries</p>
        </Card>
      </div>

      {/* Transactions */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold">Statement lines — {activeAccount?.name}</p>
            <p className="text-[11px] text-muted-foreground">Match each line to a ledger entry or journal memo</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={methodFilter} onValueChange={(v) => setMethodFilter(v as typeof methodFilter)}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={autoMatchAll} disabled={recon.unmatchedCount === 0}>
              <RefreshCw className="mr-1 h-3 w-3" /> Auto-match
            </Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
             <tr>
               <th className="px-4 py-2 font-medium">Date</th>
               <th className="px-4 py-2 font-medium">Description</th>
               <th className="px-4 py-2 text-right font-medium">Amount</th>
               <th className="hidden px-4 py-2 font-medium md:table-cell">Method</th>
               <th className="hidden px-4 py-2 font-medium lg:table-cell">Matched to</th>
               <th className="px-4 py-2 font-medium">GL account</th>
               <th className="px-4 py-2 font-medium">Status</th>
               <th className="w-24 px-2 py-2" />
             </tr>
          </thead>
          <tbody>
             {visibleTxns.map((t) => {
               const suggestion = t.status === 'unmatched' ? suggestMatch(t, candidates, reconciliationRules) : null;
               const linkedAccount = coa.find((a) => a.id === t.accountId);
               return (
                <tr key={t.id} className={cn('border-b last:border-0 hover:bg-muted/20', t.status === 'excluded' && 'opacity-50')}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">{t.date}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{t.description}</p>
                    {suggestion && (
                      <p className={cn('text-[10px]', suggestion.fromRule ? 'text-emerald-600' : 'text-sky-600')}>
                        {suggestion.fromRule ? '🧠 learned: ' : 'suggested: '}{suggestion.ref}
                      </p>
                    )}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-mono text-xs', t.amount >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
                    {t.amount >= 0 ? '+' : '−'}{money(Math.abs(t.amount))}
                  </td>
                  <td className="hidden px-4 py-2.5 text-[11px] text-muted-foreground md:table-cell">
                    {PAYMENT_METHOD_LABEL[t.method ?? 'cash']}
                  </td>
                  <td className="hidden max-w-[220px] truncate px-4 py-2.5 text-[11px] text-muted-foreground lg:table-cell">
                    {t.matchedRef ?? '…'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Select
                      value={t.accountId ?? ''}
                      onValueChange={(v) => setBankTxnAccount(t.id, v)}
                    >
                      <SelectTrigger className={cn('h-7 w-40 text-xs', !linkedAccount && 'text-amber-600 border-amber-500/40')}>
                        <SelectValue placeholder="Unlinked" />
                      </SelectTrigger>
                      <SelectContent>
                        {coa.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 capitalize',
                      t.status === 'matched'
                        ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30'
                        : t.status === 'excluded'
                          ? 'bg-muted text-muted-foreground ring-border'
                          : 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
                    )}>
                      {t.status}
                    </span>
                  </td>
                   <td className="px-2 py-2.5">
                     <div className="flex justify-end gap-0.5">
                       {t.status === 'unmatched' && (
                         <button
                           onClick={() => {
                             const ref = suggestion?.ref ?? `Manual — ${t.description}`;
                             matchBankTxn(t.id, ref, suggestion?.accountId);
                             if (suggestion?.accountId) recordReconciliationMatch(t.description, suggestion.accountId);
                           }}
                           className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-primary/10 enabled:hover:text-primary"
                           title={suggestion ? `Accept suggestion: ${suggestion.ref}` : 'Mark as matched'}
                         >
                           <Check className="h-3 w-3" />
                         </button>
                       )}
                       {t.status === 'unmatched' && (
                         <button
                           onClick={() => { setManualAccountId(''); setMatchTarget(t); }}
                           className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sky-500/10 hover:text-sky-600"
                           title="Manually pick a ledger match"
                         >
                           <Hand className="h-3 w-3" />
                         </button>
                       )}
                       {t.status === 'matched' && (
                         <button
                           onClick={() => unmatchBankTxn(t.id)}
                           className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                           title="Undo match"
                         >
                           <Unplug className="h-3 w-3" />
                         </button>
                       )}
                       <button
                         onClick={() => openEdit(t)}
                         className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                         title="Edit line"
                       >
                         <Pencil className="h-3 w-3" />
                       </button>
                       <button
                         onClick={() => excludeBankTxn(t.id)}
                         className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                         title={t.status === 'excluded' ? 'Include again' : 'Exclude from reconciliation'}
                       >
                         <EyeOff className="h-3 w-3" />
                       </button>
                       <button
                         onClick={() => deleteBankTxn(t.id)}
                         className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                         title="Delete line"
                       >
                         <Trash2 className="h-3 w-3" />
                       </button>
                     </div>
                   </td>
                </tr>
              );
            })}
            {visibleTxns.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">No statement lines — import one to start reconciling.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Reconciliation rule memory */}
      {reconciliationRules.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b bg-muted/40 px-4 py-2.5">
            <p className="text-sm font-semibold">🧠 Auto-reconcile rule memory</p>
            <p className="text-[11px] text-muted-foreground">Learned from every manual match — new statement lines with a similar description auto-suggest these accounts.</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Description pattern</th>
                <th className="px-4 py-2 font-medium">GL account</th>
                <th className="px-4 py-2 text-right font-medium">Times used</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Last matched</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {[...reconciliationRules].sort((a, b) => b.matchCount - a.matchCount).map((r) => {
                const account = coa.find((a) => a.id === r.accountId);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs">&ldquo;{r.pattern}&rdquo;</td>
                    <td className="px-4 py-2 text-xs">{account ? `${account.code} — ${account.name}` : 'Unknown account'}</td>
                    <td className="px-4 py-2 text-right text-xs">{r.matchCount}</td>
                    <td className="hidden px-4 py-2 text-[11px] text-muted-foreground sm:table-cell">{new Date(r.lastMatchedAt).toLocaleDateString()}</td>
                    <td className="px-2 py-2">
                      <button
                        onClick={() => deleteReconciliationRule(r.id)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Forget this rule"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add bank account */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add bank account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Account name *</label>
                <Input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} placeholder="Operating Chequing" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Institution</label>
                <Input value={newForm.institution} onChange={(e) => setNewForm({ ...newForm, institution: e.target.value })} placeholder="Prairie Bank" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Last 4</label>
                <Input value={newForm.last4} onChange={(e) => setNewForm({ ...newForm, last4: e.target.value })} maxLength={4} placeholder="4417" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Kind</label>
                <Select value={newForm.kind} onValueChange={(v) => setNewForm({ ...newForm, kind: v as BankAccount['kind'] })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BANK_ACCOUNT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>{BANK_ACCOUNT_KIND_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Balance ({currency})</label>
                <Input type="number" value={newForm.balance} onChange={(e) => setNewForm({ ...newForm, balance: e.target.value })} placeholder="0" className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitNewAccount} disabled={!newForm.name.trim()}>Add account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CSV import */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import bank statement — {activeAccount?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              One line per transaction: <code className="rounded bg-muted px-1">date,description,amount</code> — negative amounts are outflows.
            </p>
            <TextareaImport value={csvText} onChange={setCsvText} onFile={handleFile} fileRef={fileRef} />
            {csvErrors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
                {csvErrors.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCsvText(''); setCsvErrors([]); setImportOpen(false); }}>Cancel</Button>
            <Button onClick={parseAndImport} disabled={!csvText.trim()}>Import lines</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit bank line */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit statement line</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Date">
              <DateInput value={editForm.date} onChange={(v) => setEditForm({ ...editForm, date: v })} />
            </Field>
            <Field label="Description">
              <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Amount (${currency})`}>
                <Input type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} />
              </Field>
              <Field label="Method">
                <Select value={editForm.method} onValueChange={(v) => setEditForm({ ...editForm, method: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-[11px] text-muted-foreground">Sign is preserved ({(editTarget?.amount ?? 0) < 0 ? 'outflow' : 'inflow'}).</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={submitEdit}>Save line</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual match */}
      <Dialog open={!!matchTarget} onOpenChange={(o) => { if (!o) setMatchTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Match line #{matchTarget?.id.slice(-4)} manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="GL account" hint="Choosing an account here teaches the auto-reconciler this description next time.">
              <Select value={manualAccountId} onValueChange={setManualAccountId}>
                <SelectTrigger><SelectValue placeholder="Select an account…" /></SelectTrigger>
                <SelectContent>
                  {coa.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
              {candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">No ledger or journal entries to match against yet.</p>
              )}
              {candidates.map((c) => (
                <button
                  key={c.ref}
                  onClick={() => submitManualMatch(c.ref)}
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs hover:border-primary/50 hover:bg-muted/40"
                >
                  <span className="truncate pr-2">{c.ref}</span>
                  <span className={cn('shrink-0 font-mono', c.amount >= 0 ? 'text-emerald-600' : 'text-rose-500')}>
                    {c.amount >= 0 ? '+' : '−'}{money(Math.abs(c.amount))}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchTarget(null)}>Cancel</Button>
            <Button
              disabled={!manualAccountId}
              onClick={() => submitManualMatch(`Manual — ${matchTarget?.description ?? ''}`)}
            >
              Match without a ledger candidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TextareaImport({
  value, onChange, onFile, fileRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onFile: (f: File) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="space-y-2">
      <textarea
        rows={7}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'Aug 24,WIRE IN — NORTHWIND STUDIO,31500\nAug 25,METRO FLEET FUELS,-12750'}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
      />
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <Button size="sm" variant="outline" className="gap-1" onClick={() => fileRef.current?.click()}>
        <Upload className="h-3 w-3" /> Choose .csv file—
      </Button>
    </div>
  );
}
