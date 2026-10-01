'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Download, Info, Plus, Undo2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoneyFull } from '@/lib/borga/currencies';
import { addMonths, fiscalYearEnd } from '@/lib/borga/filing-catalog';
import {
  ASSET_ACCOUNTS, ASSET_CATEGORIES, METHOD_LABEL, assetPolicyFor, categoryOf, type AssetPolicy, type DepreciationMethod,
} from '@/lib/borga/fixed-asset-standards';
import {
  CONVENTION_LABEL, EVENT_LABEL, forecast, isPeriod, monthOf, positionAt, rollForward, simulateAsset, validateAsset,
  type AssetEvent, type AssetEventKind, type Convention, type FixedAsset, type Simulation,
} from '@/lib/borga/fixed-assets';
import { ledgerBalance, missingCounterAccount, periodLabel, type PostingPlan } from '@/lib/borga/fixed-asset-journals';
import { SectionTitle } from '../bits';
import { AccountSelect, DateInput, Field, ProjectSelect } from '../form-widgets';

const todayIso = () => new Date().toISOString().slice(0, 10);
const noopSubscribe = () => () => {};
/** Today's date, empty while rendered on the server so the two renders never disagree. */
const useToday = () => useSyncExternalStore(noopSubscribe, todayIso, () => '');
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const prevMonth = (period: string) => monthOf(addMonths(`${period}-01`, -1, 1));

const STATUS_TEXT: Record<string, string> = { 'under-construction': 'Under construction', 'in-use': 'In use', 'held-for-sale': 'Held for sale', disposed: 'Disposed' };
const STATUS_STYLE: Record<string, string> = {
  'under-construction': 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  'in-use': 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  'held-for-sale': 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  disposed: 'bg-muted text-muted-foreground ring-border',
};

export function FixedAssetsTab() {
  const {
    activeWorkspace, fixedAssets, journals, closures, coa, addFixedAsset, updateFixedAsset, deleteFixedAsset, addAssetEvent, removeAssetEvent, setAssetTransferSurplus,
    planAssetPostings, postAssetEntries, reverseLastAssetRun, ensureAssetAccounts,
  } = useBorga();
  const today = useToday();
  const ws = activeWorkspace();
  const currency = ws?.currency ?? 'USD';
  const policy = useMemo(() => assetPolicyFor(ws?.country), [ws?.country]);
  const money = (n: number) => fmtMoneyFull(n, currency);

  const [editing, setEditing] = useState<FixedAsset | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [fyEnd, setFyEnd] = useState('');

  const period = today ? monthOf(today) : '';
  const assets = fixedAssets.assets;

  const sims = useMemo(() => {
    const m = new Map<string, Simulation>();
    if (!period) return m;
    for (const a of assets) m.set(a.id, simulateAsset(a, policy, period, { transferSurplus: fixedAssets.transferSurplus }));
    return m;
  }, [assets, policy, period, fixedAssets.transferSurplus]);

  const positions = useMemo(() => new Map(assets.map((a) => [a.id, positionAt(sims.get(a.id) ?? { months: [], postings: [], issues: [], info: [] }, period)])), [assets, sims, period]);
  const totals = useMemo(() => {
    let gross = 0; let accumulated = 0; let thisMonth = 0;
    for (const a of assets) {
      const p = positions.get(a.id);
      if (p && p.status !== 'disposed') { gross += p.gross; accumulated += p.accumulated; }
      thisMonth += sims.get(a.id)?.months.find((m) => m.period === period)?.depreciation ?? 0;
    }
    return { gross, accumulated, nbv: gross - accumulated, thisMonth };
  }, [assets, positions, sims, period]);

  // what posting through the end of the latest month would do
  const through = period;
  // planAssetPostings reads the store, so the plan must be recomputed whenever what it reads changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan: PostingPlan = useMemo(() => (through && assets.length ? planAssetPostings(through) : { periods: [], problems: [] }), [through, assets, fixedAssets.runs, journals, closures, planAssetPostings]);
  const missingCounter = useMemo(
    () => (through ? missingCounterAccount(fixedAssets, policy, through, { cashAccountId: coa.find((a) => a.isCash)?.id, closures: [] }) : []),
    [through, fixedAssets, policy, coa],
  );

  const fyOptions = useMemo(() => {
    if (!period) return [];
    const fye = fiscalYearEnd(ws);
    const out: string[] = [];
    const y = Number(period.slice(0, 4));
    for (let k = 1; k >= -4; k--) out.push(`${y + k}-${String(fye.month).padStart(2, '0')}`);
    return out;
  }, [period, ws]);
  // the financial year the current month falls in: the first year end that is not behind us
  const fy = fyEnd || [...fyOptions].sort().find((o) => o >= period) || '';

  if (!ws) return <Card className="p-6 text-sm text-muted-foreground">Create or select a company to keep its fixed asset register.</Card>;

  const open = assets.find((a) => a.id === openId) ?? null;
  const live = assets.filter((a) => positions.get(a.id)?.status !== 'disposed');
  const unposted = plan.periods.length;

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Fixed assets" sub={`Register, depreciation and revaluation under ${policy.label}`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPosting(true)} disabled={!assets.length}>Post depreciation{unposted ? ` (${unposted})` : ''}</Button>
          <Button onClick={() => { ensureAssetAccounts(); setEditing('new'); }}><Plus className="h-4 w-4" /> New asset</Button>
        </div>
      </div>

      <Card className="space-y-2 border-sky-500/30 bg-sky-500/5 p-3 text-xs">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span><strong>Framework:</strong> {policy.label}</span>
          <span><strong>Revaluation:</strong> {policy.allowsRevaluation ? 'allowed' : 'not allowed'}</span>
          <span><strong>Impairment reversal:</strong> {policy.allowsImpairmentReversal ? 'allowed' : 'not allowed'}</span>
          <button className="text-primary underline-offset-2 hover:underline" onClick={() => setShowRules((v) => !v)}>{showRules ? 'Hide the rules' : 'Show the rules'}</button>
        </p>
        {showRules && (
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {policy.notes.map((n) => <li key={n}>{n}</li>)}
            <li>This register covers property, plant and equipment. Tax depreciation (capital cost allowance, MACRS, capital allowances), leased assets and intangible assets are separate and are not calculated here. The company&apos;s accountant decides policies such as useful lives and the revaluation model.</li>
          </ul>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Cost / revalued amount" value={money(totals.gross)} />
        <Tile label="Accumulated depreciation" value={money(totals.accumulated)} />
        <Tile label="Net book value" value={money(totals.nbv)} strong />
        <Tile label={`Depreciation, ${period ? periodLabel(period) : ''}`} value={money(totals.thisMonth)} />
      </div>

      {(unposted > 0 || plan.blocked || plan.problems.length > 0 || missingCounter.length > 0) && (
        <Card className="space-y-1.5 border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          {unposted > 0 && (
            <p className="flex items-center gap-2"><Info className="h-3.5 w-3.5 shrink-0" /> {unposted} month{unposted === 1 ? '' : 's'} of entries are not posted to the ledger yet (through {periodLabel(plan.periods[unposted - 1].period)}).
              <button className="underline underline-offset-2" onClick={() => setPosting(true)}>Review and post</button></p>
          )}
          {plan.blocked && <p className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Posting stops before {plan.blocked.label}: that period is closed. Reopen it in Book Closure to post into it.</p>}
          {missingCounter.length > 0 && <p className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /> No cash or payable account is set for the purchase of {missingCounter.join(', ')}. Set one on the asset, or mark it as already in the ledger.</p>}
          {plan.problems.map((p) => (
            <p key={p.assetId} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span><strong>{p.name}</strong> is not posted until this is fixed: {p.issues.join(' ')}</span></p>
          ))}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">Register</p>
          <p className="text-[11px] text-muted-foreground">{live.length} in service or held, {assets.length - live.length} disposed. Position at the end of {period ? periodLabel(period) : '…'}.</p>
        </div>
        {assets.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No assets yet. Add the first one: its cost, when it is ready for use, how long it lasts and how it is depreciated.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Asset</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Method</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Accumulated</th>
                  <th className="px-4 py-2 text-right font-medium">Net book value</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="w-16 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const p = positions.get(a.id)!;
                  const issues = sims.get(a.id)?.issues ?? [];
                  return (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{a.name}{a.tag && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{a.tag}</span>}</p>
                        <p className="text-[11px] text-muted-foreground">{categoryOf(a.category).label} · acquired {a.acquiredOn}{a.model === 'revaluation' ? ' · revalued' : ''}</p>
                        {issues.length > 0 && <p className="text-[11px] text-rose-600">{issues[0]}</p>}
                      </td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{METHOD_LABEL[a.method]}{a.method !== 'none' ? `, ${Math.round(a.usefulLifeMonths / 12 * 10) / 10} yr` : ''}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{p.status === 'disposed' ? '—' : money(p.gross)}</td>
                      <td className="hidden px-4 py-2.5 text-right font-mono text-xs sm:table-cell">{p.status === 'disposed' ? '—' : money(p.accumulated)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">{p.status === 'disposed' ? '—' : money(p.carrying)}</td>
                      <td className="px-4 py-2.5"><span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_STYLE[p.status]}`}>{STATUS_TEXT[p.status]}</span></td>
                      <td className="px-2 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => setOpenId(a.id)}>Open</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {assets.length > 0 && fy && (
        <RollForwardCard assets={assets} sims={sims} fy={fy} fyOptions={fyOptions} onFy={setFyEnd} currency={currency} policyLabel={policy.label} company={ws.legalName || ws.name} />
      )}

      {assets.length > 0 && (
        <TieOut
          gross={totals.gross} accumulated={totals.accumulated} money={money}
          glCost={ledgerBalance(journals, ASSET_ACCOUNTS.cost.id)} glAccum={-ledgerBalance(journals, ASSET_ACCOUNTS.accumulated.id)}
          hasExternal={assets.some((a) => a.glMode === 'already-in-gl')}
        />
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={fixedAssets.transferSurplus} onChange={(e) => setAssetTransferSurplus(e.target.checked)} />
          <span>Move revaluation surplus to retained earnings as revalued assets are used (IAS 16.41). Applies only to revalued assets.</span>
        </label>
        {fixedAssets.runs.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => { if (window.confirm('Reverse the most recent posted month? Each of its entries gets a linked reversing entry, and you can post the month again.')) reverseLastAssetRun(); }}>
            <Undo2 className="h-3.5 w-3.5" /> Reverse last run ({periodLabel(fixedAssets.runs.reduce((m, r) => (r.period > m ? r.period : m), ''))})
          </Button>
        )}
      </Card>

      {editing && (
        <AssetDialog
          key={editing === 'new' ? 'new' : editing.id} asset={editing === 'new' ? null : editing} policy={policy} today={today}
          onClose={() => setEditing(null)}
          onSave={(a) => { if (editing === 'new') addFixedAsset(a); else updateFixedAsset(a.id, a); setEditing(null); if (editing === 'new') setOpenId(a.id); }}
        />
      )}
      {open && (
        <DetailDialog
          asset={open} policy={policy} period={period} currency={currency} sim={sims.get(open.id)} fixedAssetsTransfer={fixedAssets.transferSurplus}
          onClose={() => setOpenId(null)} onEdit={() => { setEditing(open); setOpenId(null); }}
          onAddEvent={(e) => addAssetEvent(open.id, e)} onRemoveEvent={(id) => removeAssetEvent(open.id, id)}
          onDelete={() => { if (deleteFixedAsset(open.id)) setOpenId(null); else window.alert('This asset has entries posted to the ledger, so it cannot be deleted. Record a disposal instead.'); }}
        />
      )}
      {posting && (
        <PostDialog
          plan={plan} money={money} today={today} onClose={() => setPosting(false)} planFor={planAssetPostings}
          onPost={(thr) => postAssetEntries(thr)}
        />
      )}
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-lg leading-none ${strong ? 'font-semibold' : ''}`}>{value}</p>
    </Card>
  );
}

// ── roll-forward (IAS 16.73(e)) ───────────────────────────────────────────────────────────────────────────────────────

function RollForwardCard({ assets, sims, fy, fyOptions, onFy, currency, policyLabel, company }: {
  assets: FixedAsset[]; sims: Map<string, Simulation>; fy: string; fyOptions: string[]; onFy: (s: string) => void; currency: string; policyLabel: string; company: string;
}) {
  const from = monthOf(addMonths(`${fy}-01`, -11, 1));
  const money = (n: number) => fmtMoneyFull(n, currency);
  // the simulations run to the current month: extend them to the end of the chosen year when it is later
  const rows = useMemo(() => {
    const groups = new Map<string, FixedAsset[]>();
    for (const a of assets) (groups.get(a.category) ?? groups.set(a.category, []).get(a.category)!).push(a);
    return [...groups.entries()].map(([cat, list]) => ({ cat, rf: rollForward(list.map((a) => sims.get(a.id) ?? { months: [], postings: [], issues: [], info: [] }), from, fy) }));
  }, [assets, sims, from, fy]);
  const total = rollForward(assets.map((a) => sims.get(a.id) ?? { months: [], postings: [], issues: [], info: [] }), from, fy);
  const cols: Array<[string, (r: typeof total) => number]> = [
    ['Cost, opening', (r) => r.costOpening], ['Additions', (r) => r.additions], ['Disposals', (r) => -r.disposals], ['Cost, closing', (r) => r.costClosing],
    ['Accumulated, opening', (r) => r.accumOpening], ['Depreciation', (r) => r.depreciation], ['Impairment', (r) => r.impairment - r.impairmentReversal], ['Disposals', (r) => -r.accumDisposals],
    ['Accumulated, closing', (r) => r.accumClosing], ['Revaluation (net effect)', (r) => r.revaluations], ['Net book value, closing', (r) => r.carryingClosing],
  ];
  const csv = () => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = [[q(`${company}: property, plant and equipment reconciliation (${policyLabel})`)], [q(`Year ${from} to ${fy}, amounts in ${currency}`)], [], ['Category', ...cols.map(([h]) => q(h))]];
    for (const r of rows) lines.push([q(categoryOf(r.cat).label), ...cols.map(([, f]) => f(r.rf).toFixed(2))]);
    lines.push([q('Total'), ...cols.map(([, f]) => f(total).toFixed(2))]);
    const blob = new Blob(['﻿' + lines.map((l) => l.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ppe-roll-forward-${fy}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
        <div>
          <p className="text-sm font-semibold">Reconciliation of carrying amount</p>
          <p className="text-[11px] text-muted-foreground">Movements by category for the financial year, the table IAS 16 asks for, and the equivalent under other frameworks.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={fy} onValueChange={onFy}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{fyOptions.map((o) => <SelectItem key={o} value={o}>Year ending {periodLabel(o)}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={csv}><Download className="h-3.5 w-3.5" /> CSV</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Category</th>{cols.map(([h], i) => <th key={i} className="whitespace-nowrap px-3 py-2 text-right font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat} className="border-b">
                <td className="whitespace-nowrap px-3 py-2">{categoryOf(r.cat).label}</td>
                {cols.map(([, f], i) => <td key={i} className="px-3 py-2 text-right font-mono">{money(f(r.rf))}</td>)}
              </tr>
            ))}
            <tr className="font-semibold"><td className="px-3 py-2">Total</td>{cols.map(([, f], i) => <td key={i} className="px-3 py-2 text-right font-mono">{money(f(total))}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TieOut({ gross, accumulated, glCost, glAccum, money, hasExternal }: { gross: number; accumulated: number; glCost: number; glAccum: number; money: (n: number) => string; hasExternal: boolean }) {
  const dCost = Math.round((gross - glCost) * 100) / 100;
  const dAccum = Math.round((accumulated - glAccum) * 100) / 100;
  const ok = Math.abs(dCost) < 0.01 && Math.abs(dAccum) < 0.01;
  return (
    <Card className={`p-3 text-xs ${ok ? '' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <p className="mb-1.5 font-semibold">Register against the ledger</p>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <p className="flex justify-between"><span>Cost: register / ledger {ASSET_ACCOUNTS.cost.code}</span><span className="font-mono">{money(gross)} / {money(glCost)}</span></p>
        <p className="flex justify-between"><span>Accumulated: register / ledger {ASSET_ACCOUNTS.accumulated.code}</span><span className="font-mono">{money(accumulated)} / {money(glAccum)}</span></p>
      </div>
      <p className="mt-1.5 text-muted-foreground">
        {ok ? 'The register and the ledger agree.' : `Difference: cost ${money(dCost)}, accumulated ${money(dAccum)}. That is normal while months are not posted yet${hasExternal ? ', or for assets marked as already in the ledger, whose cost sits in whatever account their bill or journal used' : ''}.`}
      </p>
    </Card>
  );
}

// ── add or edit an asset ──────────────────────────────────────────────────────────────────────────────────────────────

function AssetDialog({ asset, policy, today, onClose, onSave }: {
  asset: FixedAsset | null; policy: AssetPolicy; today: string; onClose: () => void; onSave: (a: FixedAsset) => void;
}) {
  const policyAllowsRevaluation = policy.allowsRevaluation;
  const policyLabel = policy.label;
  const locked = !!asset?.acquisitionJournalId;
  const first = ASSET_CATEGORIES.find((c) => c.id === 'machinery')!;
  const [f, setF] = useState(() => ({
    name: asset?.name ?? '', tag: asset?.tag ?? '', category: asset?.category ?? first.id, acquiredOn: asset?.acquiredOn ?? today, availableFrom: asset?.availableFrom ?? '',
    cost: asset ? String(asset.cost) : '', residual: asset ? String(asset.residual) : '0', years: asset ? String(Math.round((asset.usefulLifeMonths / 12) * 100) / 100) : String(first.lifeMonths / 12),
    method: (asset?.method ?? first.method) as DepreciationMethod, dbFactor: String(asset?.dbFactor ?? 2), units: asset?.unitsTotal ? String(asset.unitsTotal) : '',
    convention: (asset?.convention ?? 'daily') as Convention, model: asset?.model ?? 'cost', revalMethod: asset?.revaluationMethod ?? 'eliminate',
    glMode: asset?.glMode ?? 'register-posts', counter: asset?.counterAccountId ?? '', projectId: asset?.projectId, notes: asset?.notes ?? '',
  }));
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const pickCategory = (id: string) => {
    const c = categoryOf(id);
    set({ category: id, method: c.method, years: String(c.lifeMonths / 12), residual: f.cost ? String(Math.round(Number(f.cost) * c.residualPct) / 100) : f.residual });
  };

  const draft: FixedAsset = {
    id: asset?.id ?? newId('fa'), name: f.name.trim(), tag: f.tag.trim() || undefined, category: f.category, acquiredOn: f.acquiredOn, availableFrom: f.availableFrom || undefined,
    cost: Number(f.cost) || 0, residual: Number(f.residual) || 0, usefulLifeMonths: Math.round((Number(f.years) || 0) * 12), method: f.method,
    dbFactor: f.method === 'declining-balance' ? Number(f.dbFactor) || 2 : undefined, unitsTotal: f.method === 'units-of-production' ? Number(f.units) || undefined : undefined,
    convention: f.convention, model: f.model, revaluationMethod: f.model === 'revaluation' ? f.revalMethod : undefined, glMode: f.glMode,
    counterAccountId: f.glMode === 'register-posts' ? f.counter || undefined : undefined, accounts: asset?.accounts, projectId: f.projectId,
    acquisitionJournalId: asset?.acquisitionJournalId, events: asset?.events ?? [], notes: f.notes.trim() || undefined, createdAt: asset?.createdAt ?? new Date().toISOString(),
  };
  // problems with the events already on the asset are shown on the asset itself, not here
  const issues = validateAsset({ ...draft, events: [] }, policy);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{asset ? 'Edit asset' : 'New asset'}</DialogTitle>
          <DialogDescription>{locked ? 'The purchase has been posted to the ledger, so cost and dates are locked. Record changes as events on the asset.' : `Measured under ${policyLabel}.`}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name *"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Delivery van" /></Field>
          <Field label="Asset tag"><Input value={f.tag} onChange={(e) => set({ tag: e.target.value })} placeholder="Optional" /></Field>
          <Field label="Category">
            <Select value={f.category} onValueChange={pickCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ASSET_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Cost (including costs to bring it into use) *"><Input type="number" min={0} value={f.cost} disabled={locked} onChange={(e) => set({ cost: e.target.value })} /></Field>
          <Field label="Acquired on *"><DateInput value={f.acquiredOn} onChange={(v) => set({ acquiredOn: v })} /></Field>
          <Field label="Ready for use from" hint="Depreciation starts here. Leave empty while it is still being built."><DateInput value={f.availableFrom} onChange={(v) => set({ availableFrom: v })} /></Field>
          <Field label="Method">
            <Select value={f.method} onValueChange={(v) => set({ method: v as DepreciationMethod })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(METHOD_LABEL) as DepreciationMethod[]).map((m) => <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {f.method !== 'none' && <Field label="Useful life (years)"><Input type="number" min={0} step="0.25" value={f.years} onChange={(e) => set({ years: e.target.value })} /></Field>}
          {f.method !== 'none' && <Field label="Residual value"><Input type="number" min={0} value={f.residual} onChange={(e) => set({ residual: e.target.value })} /></Field>}
          {f.method === 'declining-balance' && <Field label="Declining balance factor" hint="2 is double declining, 1.5 is 150%."><Input type="number" min={0.5} max={4} step="0.25" value={f.dbFactor} onChange={(e) => set({ dbFactor: e.target.value })} /></Field>}
          {f.method === 'units-of-production' && <Field label="Total units over its life" hint="Hours, kilometres or items. Record the units used on the asset each period."><Input type="number" min={0} value={f.units} onChange={(e) => set({ units: e.target.value })} /></Field>}
          {f.method !== 'none' && (
            <Field label="Part months">
              <Select value={f.convention} onValueChange={(v) => set({ convention: v as Convention })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(CONVENTION_LABEL) as Convention[]).map((c) => <SelectItem key={c} value={c}>{CONVENTION_LABEL[c]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Measurement after acquisition" hint={policyAllowsRevaluation ? 'Revaluation is for a whole class of assets and must be kept up to date.' : 'Revaluation is not allowed under this framework.'}>
            <Select value={f.model} onValueChange={(v) => set({ model: v as 'cost' | 'revaluation' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cost">Cost model</SelectItem>
                <SelectItem value="revaluation" disabled={!policyAllowsRevaluation}>Revaluation model (fair value)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {f.model === 'revaluation' && (
            <Field label="When revalued, accumulated depreciation is" hint="Eliminated against cost is common for buildings; scaled up in proportion is common for equipment.">
              <Select value={f.revalMethod} onValueChange={(v) => set({ revalMethod: v as 'eliminate' | 'proportional' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="eliminate">Eliminated against the cost</SelectItem>
                  <SelectItem value="proportional">Restated in proportion</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="The purchase" className="sm:col-span-2" hint={f.glMode === 'register-posts' ? 'The register books it: debit fixed assets, credit the account below.' : 'Choose this when a bill or journal already put the cost on the ledger, so it is not counted twice.'}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={f.glMode} disabled={locked} onValueChange={(v) => set({ glMode: v as FixedAsset['glMode'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="register-posts">Post the purchase from this register</SelectItem>
                  <SelectItem value="already-in-gl">Already in the ledger</SelectItem>
                </SelectContent>
              </Select>
              {f.glMode === 'register-posts' && <AccountSelect value={f.counter || undefined} onChange={(v) => set({ counter: v ?? '' })} types={['asset', 'liability']} placeholder="Paid from (default: cash and bank)" />}
            </div>
          </Field>
          <Field label="Project"><ProjectSelect value={f.projectId} onChange={(v) => set({ projectId: v })} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Serial number, location…" /></Field>
        </div>
        {issues.length > 0 && f.name !== '' && <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-600">{issues.map((m) => <li key={m}>{m}</li>)}</ul>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={issues.length > 0 || !draft.name} onClick={() => onSave(draft)}>{asset ? 'Save' : 'Add asset'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── one asset: position, events, forecast ─────────────────────────────────────────────────────────────────────────────

const EVENT_KINDS: AssetEventKind[] = ['usage', 'improvement', 'estimate-change', 'revaluation', 'impairment', 'impairment-reversal', 'held-for-sale', 'reclassify-in-use', 'disposal'];

function DetailDialog({ asset, policy, period, currency, sim, fixedAssetsTransfer, onClose, onEdit, onAddEvent, onRemoveEvent, onDelete }: {
  asset: FixedAsset; policy: ReturnType<typeof assetPolicyFor>; period: string; currency: string; sim?: Simulation; fixedAssetsTransfer: boolean;
  onClose: () => void; onEdit: () => void; onAddEvent: (e: AssetEvent) => void; onRemoveEvent: (id: string) => void; onDelete: () => void;
}) {
  const money = (n: number) => fmtMoneyFull(n, currency);
  const pos = sim ? positionAt(sim, period) : null;
  const sched = useMemo(() => (period && isPeriod(period) ? forecast(asset, policy, period, 12, { transferSurplus: fixedAssetsTransfer }) : []), [asset, policy, period, fixedAssetsTransfer]);
  const [adding, setAdding] = useState(false);
  const kinds = EVENT_KINDS.filter((k) => (k !== 'revaluation' || (policy.allowsRevaluation && asset.model === 'revaluation')) && (k !== 'impairment-reversal' || (policy.allowsImpairmentReversal && asset.model === 'cost')));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{asset.name}{asset.tag ? ` (${asset.tag})` : ''}</DialogTitle>
          <DialogDescription>{categoryOf(asset.category).label} · {METHOD_LABEL[asset.method]}{asset.method !== 'none' ? ` over ${Math.round((asset.usefulLifeMonths / 12) * 10) / 10} years` : ''} · {asset.model === 'revaluation' ? 'revaluation model' : 'cost model'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {pos && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Cost / revalued" value={money(pos.gross)} />
              <Tile label="Accumulated" value={money(pos.accumulated)} />
              <Tile label="Net book value" value={money(pos.carrying)} strong />
              <Tile label="Revaluation surplus" value={money(pos.surplus)} />
            </div>
          )}
          {sim && sim.issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-600">{sim.issues.map((m) => <li key={m}>{m}</li>)}</ul>}
          {sim && sim.info.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{sim.info.map((m) => <li key={m}>{m}</li>)}</ul>}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Events</p>
              {!adding && pos?.status !== 'disposed' && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add event</Button>}
            </div>
            {adding && <EventForm kinds={kinds} policy={policy} asset={asset} onCancel={() => setAdding(false)} onAdd={(e) => { onAddEvent(e); setAdding(false); }} />}
            {asset.events.length === 0 && !adding ? <p className="text-xs text-muted-foreground">None yet. Add usage, a revaluation, an impairment, an improvement, a change of estimate, or the disposal.</p> : (
              <ul className="divide-y rounded-md border text-xs">
                {[...asset.events].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span><strong>{EVENT_LABEL[e.kind]}</strong> · {e.date} · {describe(e, money)}{e.note ? ` · ${e.note}` : ''}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {e.journalId ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600">posted</span> : (
                        <button className="text-muted-foreground hover:text-destructive" onClick={() => onRemoveEvent(e.id)}>Remove</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {sched.length > 0 && pos?.status !== 'disposed' && asset.method !== 'none' && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next 12 months</p>
              <div className="max-h-56 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-1.5 font-medium">Month</th><th className="px-3 py-1.5 text-right font-medium">Depreciation</th><th className="px-3 py-1.5 text-right font-medium">Accumulated</th><th className="px-3 py-1.5 text-right font-medium">Net book value</th></tr>
                  </thead>
                  <tbody>
                    {sched.map((m) => (
                      <tr key={m.period} className="border-t">
                        <td className="px-3 py-1.5">{periodLabel(m.period)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{money(m.depreciation)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{money(m.accumClose)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{money(m.grossClose - m.accumClose)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" className="text-destructive" onClick={() => { if (window.confirm('Delete this asset? Only possible while nothing is posted for it.')) onDelete(); }}>Delete</Button>
          <span className="flex gap-2"><Button variant="outline" onClick={onEdit}>Edit</Button><Button onClick={onClose}>Close</Button></span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describe(e: AssetEvent, money: (n: number) => string): string {
  switch (e.kind) {
    case 'usage': return `${e.units.toLocaleString()} units`;
    case 'revaluation': return `fair value ${money(e.fairValue)}`;
    case 'impairment': return `recoverable amount ${money(e.recoverable)}${e.undiscountedCashFlows !== undefined ? `, undiscounted cash flows ${money(e.undiscountedCashFlows)}` : ''}`;
    case 'impairment-reversal': return `recoverable amount ${money(e.recoverable)}`;
    case 'improvement': return `${money(e.amount)}${e.extendsLifeMonths ? `, life extended ${e.extendsLifeMonths} months` : ''}`;
    case 'estimate-change': return [e.remainingLifeMonths !== undefined && `remaining life ${e.remainingLifeMonths} months`, e.residual !== undefined && `residual ${money(e.residual)}`, e.method && METHOD_LABEL[e.method]].filter(Boolean).join(', ');
    case 'held-for-sale': return `fair value less costs to sell ${money(e.fairValueLessCosts)}`;
    case 'reclassify-in-use': return 'depreciation resumes';
    case 'disposal': return `proceeds ${money(e.proceeds)}${e.costs ? `, costs ${money(e.costs)}` : ''}`;
  }
}

function EventForm({ kinds, policy, asset, onCancel, onAdd }: {
  kinds: AssetEventKind[]; policy: ReturnType<typeof assetPolicyFor>; asset: FixedAsset; onCancel: () => void; onAdd: (e: AssetEvent) => void;
}) {
  const [kind, setKind] = useState<AssetEventKind>(kinds[0]);
  const [date, setDate] = useState('');
  const [v, setV] = useState({ a: '', b: '', c: '', note: '' });
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const base = { id: newId('ev'), date, note: v.note.trim() || undefined };
  let event: AssetEvent | null = null;
  const A = num(v.a); const B = num(v.b); const C = num(v.c);
  switch (kind) {
    case 'usage': if (A !== undefined) event = { ...base, kind, units: A }; break;
    case 'revaluation': if (A !== undefined) event = { ...base, kind, fairValue: A }; break;
    case 'impairment': if (A !== undefined) event = { ...base, kind, recoverable: A, undiscountedCashFlows: B }; break;
    case 'impairment-reversal': if (A !== undefined) event = { ...base, kind, recoverable: A }; break;
    case 'improvement': if (A !== undefined) event = { ...base, kind, amount: A, extendsLifeMonths: B }; break;
    case 'estimate-change': if (A !== undefined || B !== undefined) event = { ...base, kind, remainingLifeMonths: A, residual: B, unitsTotal: asset.method === 'units-of-production' ? C : undefined }; break;
    case 'held-for-sale': if (A !== undefined) event = { ...base, kind, fairValueLessCosts: A }; break;
    case 'reclassify-in-use': event = { ...base, kind }; break;
    case 'disposal': if (A !== undefined) event = { ...base, kind, proceeds: A, costs: B }; break;
  }
  const tests = policy.impairmentTest === 'recoverability-then-fair-value';
  const labels: Record<string, [string?, string?, string?]> = {
    usage: ['Units produced in the period'],
    revaluation: ['Fair value'],
    impairment: [tests ? 'Fair value' : 'Recoverable amount (higher of fair value less costs of disposal and value in use)', tests ? 'Undiscounted future cash flows (required)' : undefined],
    'impairment-reversal': ['New recoverable amount'],
    improvement: ['Amount capitalised', 'Months the life is extended (optional)'],
    'estimate-change': ['Remaining useful life in months', 'New residual value', asset.method === 'units-of-production' ? 'New total units' : undefined],
    'held-for-sale': ['Fair value less costs to sell'],
    'reclassify-in-use': [],
    disposal: ['Sale proceeds', 'Selling costs (optional)'],
  };
  const [la, lb, lc] = labels[kind];
  const valid = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !!event;
  return (
    <div className="mb-3 space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened">
          <Select value={kind} onValueChange={(k) => { setKind(k as AssetEventKind); setV({ a: '', b: '', c: '', note: v.note }); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{kinds.map((k) => <SelectItem key={k} value={k}>{EVENT_LABEL[k]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Date" hint="Takes effect at the end of that month."><DateInput value={date} onChange={setDate} /></Field>
        {la && <Field label={la}><Input type="number" value={v.a} onChange={(e) => setV({ ...v, a: e.target.value })} /></Field>}
        {lb && <Field label={lb}><Input type="number" value={v.b} onChange={(e) => setV({ ...v, b: e.target.value })} /></Field>}
        {lc && <Field label={lc}><Input type="number" value={v.c} onChange={(e) => setV({ ...v, c: e.target.value })} /></Field>}
        <Field label="Note" className="sm:col-span-2"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Optional: valuer, reason…" /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!valid} onClick={() => event && onAdd(event)}>Add</Button>
      </div>
    </div>
  );
}

// ── post to the ledger ────────────────────────────────────────────────────────────────────────────────────────────────

function PostDialog({ plan, money, today, planFor, onClose, onPost }: {
  plan: PostingPlan; money: (n: number) => string; today: string; planFor: (through: string) => PostingPlan; onClose: () => void; onPost: (through: string) => { periods: number; entries: number };
}) {
  const [through, setThrough] = useState(today ? monthOf(today) : '');
  const [done, setDone] = useState<string | null>(null);
  const current = through === (today ? monthOf(today) : '') ? plan : planFor(through);
  const options = useMemo(() => {
    const out: string[] = [];
    let p = today ? monthOf(today) : '';
    for (let i = 0; i < 13 && p; i++) { out.push(p); p = prevMonth(p); }
    return out;
  }, [today]);
  const entries = current.periods.reduce((s, p) => s + p.entries.length, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Post to the ledger</DialogTitle>
          <DialogDescription>Depreciation and the entries for acquisitions, revaluations, impairments and disposals, month by month. Each entry shows in the Accounting journal and can be reversed.</DialogDescription>
        </DialogHeader>
        <Field label="Post through the end of">
          <Select value={through} onValueChange={setThrough}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{periodLabel(o)}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {done ? <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700">{done}</p> : current.periods.length === 0 ? (
          <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">Nothing to post: the ledger is up to date through {through ? periodLabel(through) : 'this month'}.</p>
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto">
            {current.periods.map((p) => (
              <div key={p.period} className="rounded-md border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs">
                  <strong>{periodLabel(p.period)}</strong>
                  <span className="text-muted-foreground">{p.entries.length} entr{p.entries.length === 1 ? 'y' : 'ies'}{p.catchUp !== 0 ? `, includes ${money(p.catchUp)} catch-up` : ''}</span>
                </div>
                <ul className="divide-y text-xs">
                  {p.entries.map((e, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 px-3 py-1.5">
                      <span>{e.memo}<span className="block text-[10px] text-muted-foreground">{e.dateIso} · {e.reference}</span></span>
                      <span className="whitespace-nowrap font-mono">{money(e.lines.reduce((s, l) => s + l.debit, 0))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {current.blocked && <p className="flex items-center gap-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Posting stops before {current.blocked.label}: that period is closed.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && <Button disabled={entries === 0} onClick={() => { const r = onPost(through); setDone(`Posted ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'} for ${r.periods} month${r.periods === 1 ? '' : 's'}.`); }}>Post {entries} entr{entries === 1 ? 'y' : 'ies'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
