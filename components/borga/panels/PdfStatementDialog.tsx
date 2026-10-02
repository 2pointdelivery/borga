'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtMoneyFull } from '@/lib/borga/currencies';
import { lineKey, type DateOrder, type StatementParse } from '@/lib/borga/statement-parse';
import type { BankAccount, BankTxn } from '@/lib/borga/data';

interface Row {
  include: boolean;
  dateIso: string;
  description: string;
  amount: number;
  unsure: boolean;
}

/** Upload a bank statement PDF, check what was read, fix the direction of any line that is wrong, and import. Nothing is stored from the PDF itself. */
export function PdfStatementDialog({ ws, accounts, activeId, existing, currency, onClose, onImport }: {
  ws: string; accounts: BankAccount[]; activeId?: string; existing: BankTxn[]; currency: string; onClose: () => void; onImport: (txns: BankTxn[], accountName: string) => void;
}) {
  const [accountId, setAccountId] = useState(activeId ?? accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parse, setParse] = useState<StatementParse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [order, setOrder] = useState<DateOrder | 'auto'>('auto');
  const file = useRef<File | null>(null);
  const [fileName, setFileName] = useState('');

  const send = async (f: File, dateOrder: DateOrder | 'auto') => {
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('file', f);
      body.append('ws', ws);
      body.append('dateOrder', dateOrder);
      const r = await fetch('/api/borga/statement', { method: 'POST', headers: { 'X-Borga-Client': 'borga-dashboard' }, body });
      const j = (await r.json()) as { ok: boolean; error?: string; result?: StatementParse };
      if (!j.ok || !j.result) throw new Error(j.error ?? 'Could not read the statement.');
      setParse(j.result);
      setRows(j.result.lines.map((l) => ({ include: true, dateIso: l.dateIso, description: l.description, amount: l.amount, unsure: l.signSource === 'unknown' })));
    } catch (e) {
      setParse(null); setRows([]); setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    file.current = f; setFileName(f.name); setOrder('auto');
    void send(f, 'auto');
  };

  // lines already imported from this statement (same account, date, amount and text) are recognised and left out
  const known = useMemo(() => new Set(existing.map((t) => t.externalId).filter((x): x is string => !!x)), [existing]);
  const prepared = useMemo(() => {
    const seen = new Map<string, number>();
    return rows.map((r) => {
      const base = lineKey(accountId, r, 0);
      const occ = seen.get(base) ?? 0;
      seen.set(base, occ + 1);
      const key = lineKey(accountId, r, occ);
      return { ...r, key, already: known.has(key) };
    });
  }, [rows, accountId, known]);

  const chosen = prepared.filter((r) => r.include && !r.already);
  const money = (n: number) => fmtMoneyFull(n, currency);
  const account = accounts.find((a) => a.id === accountId);
  const flip = (i: number) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, amount: -r.amount, unsure: false } : r)));
  const unsureLeft = prepared.filter((r) => r.include && r.unsure).length;

  const doImport = () => {
    if (!account) return;
    onImport(
      chosen.map((r, i) => ({ id: `bt-pdf-${Date.now().toString(36)}-${i}`, bankAccountId: accountId, date: r.dateIso, dateIso: r.dateIso, description: r.description, amount: r.amount, status: 'unmatched' as const, externalId: r.key })),
      account.name,
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import a PDF statement</DialogTitle>
          <DialogDescription>The PDF is read on this server and thrown away: it is not stored or sent anywhere else. Check what was read before importing.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Into which account</p>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Choose an account" /></SelectTrigger>
              <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {a.institution}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Statement file</p>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-muted/40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              <span className="truncate">{fileName || 'Choose a .pdf file'}</span>
              <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
        </div>

        {error && <p className="rounded-md bg-rose-500/10 p-2.5 text-xs text-rose-600">{error}</p>}

        {parse && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span><strong>{rows.length}</strong> line{rows.length === 1 ? '' : 's'} read</span>
              {parse.reconciles === true && <span className="text-emerald-600">Opening balance plus these lines equals the closing balance.</span>}
              {parse.reconciles === false && <span className="text-amber-600">Does not add up to the closing balance.</span>}
              {parse.reconciles === undefined && <span className="text-muted-foreground">No opening and closing balance found to check against.</span>}
              {(parse.dateOrderAssumed || order !== 'auto') && (
                <span className="flex items-center gap-1.5">Dates are
                  <Select value={order === 'auto' ? parse.dateOrder : order} onValueChange={(v) => { setOrder(v as DateOrder); if (file.current) void send(file.current, v as DateOrder); }}>
                    <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="dmy">day / month</SelectItem><SelectItem value="mdy">month / day</SelectItem></SelectContent>
                  </Select>
                </span>
              )}
            </div>
            {parse.warnings.map((w) => <p key={w} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}</p>)}
            {parse.unreadable.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{parse.unreadable.length} line{parse.unreadable.length === 1 ? '' : 's'} with a date could not be used</summary>
                <ul className="mt-1 list-disc pl-5">{parse.unreadable.map((u) => <li key={u}>{u}</li>)}</ul>
              </details>
            )}

            <div className="max-h-72 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/70 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr><th className="w-8 px-2 py-1.5" /><th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Description</th><th className="px-2 py-1.5 text-right font-medium">Amount</th><th className="w-24 px-2 py-1.5" /></tr>
                </thead>
                <tbody>
                  {prepared.map((r, i) => (
                    <tr key={i} className={`border-t ${r.already ? 'opacity-50' : ''} ${r.unsure && r.include ? 'bg-amber-500/10' : ''}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={r.include && !r.already} disabled={r.already} aria-label="Include this line" onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.dateIso}</td>
                      <td className="px-2 py-1.5">{r.description}{r.already && <span className="ml-1.5 text-[10px] text-muted-foreground">already imported</span>}{r.unsure && !r.already && <span className="ml-1.5 text-[10px] text-amber-600">check direction</span>}</td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono ${r.amount < 0 ? '' : 'text-emerald-600'}`}>{money(r.amount)}</td>
                      <td className="px-2 py-1.5 text-right"><button className="text-[11px] text-primary hover:underline" onClick={() => flip(i)}>{r.amount < 0 ? 'It was money in' : 'It was money out'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={chosen.length === 0 || !account || busy} onClick={doImport}>
            Import {chosen.length} line{chosen.length === 1 ? '' : 's'}{unsureLeft > 0 ? ` (${unsureLeft} to check)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
