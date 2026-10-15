'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Play, Plus, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { REPORT_DATASETS, type CustomReport, type ReportFilterOp, type ReportResult } from '@/lib/borga/custom-report';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };
const OPS: Array<{ id: ReportFilterOp; label: string }> = [
  { id: 'equals', label: 'is' },
  { id: 'not_equals', label: 'is not' },
  { id: 'contains', label: 'contains' },
  { id: 'greater_than', label: 'more than' },
  { id: 'less_than', label: 'less than' },
];

interface ShareRow {
  id: string;
  reportId: string;
  reportName: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/**
 * My reports: build your own table — dataset, columns, filters, one grouping —
 * run it against this company's data, save it, share it read-only. The same
 * pure engine renders the saved report and the shared link.
 */
export function CustomReportsCard() {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const currency = useBorga((s) => s.activeWorkspace()?.currency ?? 'USD');
  const [reports, setReports] = useState<CustomReport[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [result, setResult] = useState<{ name: string; result: ReportResult } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [building, setBuilding] = useState(false);

  const [name, setName] = useState('');
  const [dataset, setDataset] = useState<CustomReport['dataset']>('invoices');
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<Array<{ field: string; op: ReportFilterOp; value: string }>>([]);
  const [groupBy, setGroupBy] = useState('');
  const ds = REPORT_DATASETS.find((d) => d.id === dataset)!;
  const fields = ds.fields;

  const url = `/api/borga/custom-reports?ws=${encodeURIComponent(ws)}`;
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = (await r.json()) as { ok: boolean; reports?: CustomReport[]; shares?: ShareRow[] };
      if (j.ok) {
        setReports(j.reports ?? []);
        setShares(j.shares ?? []);
      }
    } catch {
      /* card keeps its state */
    }
  }, [url]);

  useEffect(() => {
    setColumns([]);
    setFilters([]);
    setGroupBy('');
    setResult(null);
    void load();
  }, [load]);

  const post = async (b: Record<string, unknown>) =>
    (await (await fetch('/api/borga/custom-reports', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ...b, ws }) })).json()) as Record<string, unknown> & { ok: boolean; errors?: string[]; error?: string };

  const build = (): CustomReport => ({
    id: '', name: name.trim() || `${ds.label} report`, dataset, columns, filters, groupBy: groupBy || undefined,
    createdAt: '', updatedAt: '',
  });

  const run = async (r: CustomReport) => {
    setBusy(`run-${r.id}`);
    setErrors([]);
    try {
      const res = await post({ action: 'run', id: r.id });
      setResult({ name: r.name, result: (res as { result?: ReportResult }).result ?? { columns: [], rows: [], rowCount: 0 } });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setErrors([]);
    try {
      const res = await post({ action: 'save', report: build() });
      if (res.ok) {
        toast({ title: 'Report saved', variant: 'success' });
        setBuilding(false);
        setName('');
        void load();
        void run(res.report as CustomReport);
      } else setErrors(res.errors ?? [res.error ?? 'Could not save.']);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: CustomReport) => {
    if (!window.confirm(`Delete "${r.name}"? Its share links stop working.`)) return;
    await post({ action: 'delete', id: r.id });
    void load();
  };

  const share = async (r: CustomReport) => {
    setBusy(`share-${r.id}`);
    try {
      const res = (await post({ action: 'share', id: r.id })) as { ok: boolean; url?: string; error?: string };
      if (res.ok && res.url) {
        void navigator.clipboard?.writeText(res.url).then(
          () => toast({ title: 'Link copied', description: 'Anyone with it sees this report read-only (expires in 90 days; revoke here any time).', variant: 'success' }),
          () => toast({ title: 'Link created', description: res.url, variant: 'success' }),
        );
        void load();
      } else toast({ title: 'Could not create the link', description: res.error, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const unshare = async (s: ShareRow) => {
    await post({ action: 'unshare', shareId: s.id });
    void load();
  };

  const liveShare = (r: CustomReport) => shares.find((s) => s.reportId === r.id && !s.revokedAt);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">My reports</p>
          <p className="text-[11px] text-muted-foreground">Build your own table — pick a dataset, columns, filters and a grouping. Save it, run it any time, share it read-only.</p>
        </div>
        <Button size="sm" className="gap-1" onClick={() => { setBuilding(true); setResult(null); }}><Plus className="h-3.5 w-3.5" /> New report</Button>
      </div>

      {building && (
        <div className="mt-3 space-y-3 rounded-lg border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${ds.label} report`} className="mt-0.5 h-8" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Dataset</label>
              <Select value={dataset} onValueChange={(v) => setDataset(v as CustomReport['dataset'])}>
                <SelectTrigger className="mt-0.5 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{REPORT_DATASETS.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Columns (all when none picked)</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {fields.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setColumns((c) => (c.includes(f.key) ? c.filter((x) => x !== f.key) : [...c, f.key]))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${columns.includes(f.key) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-muted-foreground">Filters (all must hold)</label>
              <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" onClick={() => setFilters((f) => [...f, { field: fields[0].key, op: 'equals', value: '' }])}>Add filter</Button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={f.field} onValueChange={(v) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, field: v } : x)))}>
                  <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>{fields.map((x) => <SelectItem key={x.key} value={x.key}>{x.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={f.op} onValueChange={(v) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, op: v as ReportFilterOp } : x)))}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>{OPS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={f.value} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="value" className="h-8 min-w-28 flex-1" />
                <button onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))} aria-label="Remove filter" className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Group by (optional — count + money sum per value)</label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="mt-0.5 h-8"><SelectValue placeholder="No grouping" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No grouping</SelectItem>
                  {fields.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {errors.length > 0 && <ul className="text-[11px] text-rose-600">{errors.map((e) => <li key={e}>· {e}</li>)}</ul>}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save report</Button>
            <Button size="sm" variant="ghost" onClick={() => { setBuilding(false); setErrors([]); }}>Cancel</Button>
          </div>
        </div>
      )}

      {reports.length > 0 && !building && (
        <ul className="mt-3 divide-y rounded-lg border text-xs">
          {reports.map((r) => {
            const s = liveShare(r);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted-foreground"> · {REPORT_DATASETS.find((d) => d.id === r.dataset)?.label}{r.groupBy && r.groupBy !== 'none' ? ` · by ${fields.length ? (REPORT_DATASETS.find((d) => d.id === r.dataset)?.fields.find((f) => f.key === r.groupBy)?.label ?? r.groupBy) : ''}` : ''}{r.filters.length ? ` · ${r.filters.length} filter${r.filters.length === 1 ? '' : 's'}` : ''}</span>
                  {s && <Badge variant="outline" className="ml-1.5 text-[9px]">shared</Badge>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" disabled={busy !== null} onClick={() => void run(r)}>
                    {busy === `run-${r.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" disabled={busy !== null} onClick={() => void share(r)} title={s ? 'Create another link (the old one keeps working)' : 'Copy a read-only link'}>
                    {busy === `share-${r.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} {s ? 'New link' : 'Share'}
                  </Button>
                  {s && (
                    <button onClick={() => void unshare(s)} className="text-muted-foreground hover:text-destructive" title="Revoke the live link"><X className="h-3 w-3" /></button>
                  )}
                  <button onClick={() => void remove(r)} className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.name}`}><Trash2 className="h-3 w-3" /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {result && (
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <p className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold">{result.name} <span className="font-normal text-muted-foreground">· {result.result.rowCount} {result.result.groups ? 'groups' : 'rows'}{result.result.totals ? ` · ${result.result.totals.count} records` : ''}</span></p>
          {result.result.groups ? (
            <table className="w-full text-left text-xs">
              <thead className="border-b text-[10px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-1.5 font-medium">Group</th><th className="px-3 py-1.5 font-medium">Count</th><th className="px-3 py-1.5 text-right font-medium">Sum</th></tr></thead>
              <tbody>
                {result.result.groups.map((g) => (
                  <tr key={g.value} className="border-b last:border-0"><td className="px-3 py-1.5 font-medium">{g.value}</td><td className="px-3 py-1.5">{g.count}</td><td className="px-3 py-1.5 text-right font-semibold">{g.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>{result.result.columns.map((c) => <th key={c.key} className="px-3 py-1.5 font-medium">{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {result.result.rows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className={`px-3 py-1.5 ${result.result!.columns[j]?.type === 'money' ? 'text-right font-semibold' : ''}`}>
                        {result.result!.columns[j]?.type === 'money' ? `${cell.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}` : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
                {result.result.rows.length === 0 && <tr><td colSpan={Math.max(1, result.result.columns.length)} className="px-3 py-6 text-center text-muted-foreground">No rows matched.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}
