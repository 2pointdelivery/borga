'use client';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '../bits';
import { FormDialog, Field, FieldGrid, TextField, MoneyField, SelectField } from '../form-kit';
import { SearchSelect } from '../SearchSelect';
import { FilterPills, TableSearch, TableToolbar, CrudTable, IdCell, TextCell, AmountCell, EmptyRow, IconBtn, RowActions } from '../data-table';
import { useBorga } from '@/lib/borga/store';
import { CURRENCY_SYMBOL } from '@/lib/borga/data';
import {
  fullyDiluted, ownershipPct, allocatedPct, applyOwnershipPct, AUTHORIZED_DEFAULT,
  roundMath, waterfall, classUsage, updateShareClass, deleteShareClass,
  type CapTableState, type SafeNote, type Stakeholder,
} from '@/lib/borga/cap-table';

type Kind = Stakeholder['kind'];

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-muted-foreground">💡 {children}</p>;
}

export function CapTableTab() {
  const { capTable: s, setCapTable, valuation, activeWorkspace } = useBorga();
  const ws = activeWorkspace();
  const sym = CURRENCY_SYMBOL[ws?.currency ?? 'USD'] ?? '$';
  const fmtM = (n: number) => `${sym}${(n / 1_000_000).toFixed(2)}M`;
  const fmt$ = (n: number) => `${sym}${Math.round(n).toLocaleString()}`;

  // Pre-money comes from the Valuation tab (blended FMV, in $M) unless overridden here.
  const autoPreM = valuation?.baseline?.fmv ?? 0;
  const [preOverride, setPreOverride] = useState('');
  const preMoney = preOverride.trim() ? Number(preOverride) * 1_000_000 : autoPreM * 1_000_000;

  const [name, setName] = useState('');
  const [pct, setPct] = useState('');
  const [kind, setKind] = useState<Kind>('founder');
  const [authorized, setAuthorized] = useState(String(AUTHORIZED_DEFAULT));
  const [showClass, setShowClass] = useState(false);
  const [className, setClassName] = useState('');
  const [mult, setMult] = useState('');
  const [editClass, setEditClass] = useState<{ id: string; name: string; seniority: string; mult: string } | null>(null);
  const [showSafe, setShowSafe] = useState(false);
  const [safeForm, setSafeForm] = useState({ stakeholderId: '', amount: '', cap: '', discount: '', kind: 'safe' as 'safe' | 'note', mfn: false });
  const [showGrant, setShowGrant] = useState(false);
  const [grantForm, setGrantForm] = useState({ stakeholderId: '', granted: '', vested: '', strike: '' });
  const [pool, setPool] = useState('');
  const [preShares, setPreShares] = useState('10000000');
  const [price, setPrice] = useState('');
  const [newMoney, setNewMoney] = useState('500000');
  const [proceeds, setProceeds] = useState('1000000');
  const [msg, setMsg] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<'all' | Kind>('all');
  const [ownerQuery, setOwnerQuery] = useState('');
  const [safeFilter, setSafeFilter] = useState<'all' | 'safe' | 'note'>('all');
  const [editSt, setEditSt] = useState<{ id: string; name: string; kind: Kind; email: string; phone: string } | null>(null);

  const totalAuthorized = Number(authorized) > 0 ? Math.floor(Number(authorized)) : AUTHORIZED_DEFAULT;
  const fd = fullyDiluted(s);
  const allocated = allocatedPct(s, totalAuthorized);
  const update = (next: CapTableState) => setCapTable(next);
  const visibleOwners = s.stakeholders
    .filter((t) => (ownerFilter === 'all' ? true : t.kind === ownerFilter))
    .filter((t) => (ownerQuery ? `${t.name} ${t.email ?? ''}`.toLowerCase().includes(ownerQuery.toLowerCase()) : true));
  const visibleSafes = s.safes.filter((x) => (safeFilter === 'all' ? true : x.kind === safeFilter));

  // Suggested price per share from the pre-money value, so the round ties back to Valuation.
  const preSharesN = Number(preShares) || 0;
  const impliedPrice = preMoney > 0 && preSharesN > 0 ? preMoney / preSharesN : 0;
  const priceN = price.trim() ? Number(price) || 0 : impliedPrice;
  const math = roundMath(s, { preMoney, pricePerShare: priceN, newMoney: Number(newMoney) || 0, preMoneyShares: preSharesN });
  const exit = waterfall(s, Number(proceeds) || 0);

  const addOwner = () => {
    if (!name.trim()) { setMsg('Give the owner a name first.'); return; }
    const dup = s.stakeholders.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (dup) { setMsg(`${name.trim()} is already on the cap table — edit their % in the table instead of adding a duplicate.`); return; }
    const id = `st-${Date.now().toString(36)}`;
    update(applyOwnershipPct({ ...s, stakeholders: [...s.stakeholders, { id, name: name.trim(), kind }] }, id, Number(pct) || 0, totalAuthorized));
    setName(''); setPct(''); setMsg(null);
  };
  const setPctFor = (id: string, value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    update(applyOwnershipPct(s, id, n, totalAuthorized));
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Cap table & equity" sub="Who owns what % of your company — in plain language. Fill in steps 1–4 and the answers calculate themselves." />
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      <Card className="p-4">
        <p className="text-sm font-semibold">How this works (4 steps)</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Value:</strong> confirm what your company is worth before new money (taken from Valuation).</li>
          <li><strong className="text-foreground">Owners:</strong> list who owns the company today and their %.</li>
          <li><strong className="text-foreground">Early money & team:</strong> add SAFEs, loans that convert, and the staff option pool.</li>
          <li><strong className="text-foreground">New round:</strong> say how much you are raising — pre/post values and everyone&apos;s new % appear.</li>
        </ol>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Step 1 — What is your company worth before new money? (pre-money)</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>From Valuation tab: <strong>{fmtM(autoPreM * 1_000_000)}</strong></span>
          <Input className="w-40" placeholder="Override ($M, optional)" value={preOverride} onChange={(e) => setPreOverride(e.target.value)} />
          <span>Using: <strong>{fmtM(preMoney)}</strong></span>
        </div>
        <Tip>Pre-money means the value <em>before</em> the new investment lands. Change it on the Valuation tab and this page follows automatically — or type an override here just for playing with scenarios.</Tip>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Step 2 — Who owns the company today?</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Fully-diluted shares: <strong className="text-foreground">{fd.toLocaleString()}</strong></span>
          <span>·</span>
          <span>Allocated: <strong className={allocated > 100 ? 'text-rose-500' : 'text-foreground'}>{allocated.toFixed(2)}%</strong></span>
          {allocated > 100 && <span className="text-rose-500">over 100% — someone owns too much, lower a %</span>}
          {allocated < 100 && s.stakeholders.length > 0 && <span>({(100 - allocated).toFixed(2)}% still unassigned)</span>}
          <label className="flex items-center gap-1">Total shares ever: <Input className="w-32" value={authorized} onChange={(e) => setAuthorized(e.target.value)} /></label>
        </div>
        <TableToolbar>
          <FilterPills options={['all', 'founder', 'investor', 'employee', 'advisor'] as const} value={ownerFilter} onChange={setOwnerFilter} />
          <TableSearch value={ownerQuery} onChange={setOwnerQuery} placeholder="Search owners…" />
        </TableToolbar>
        <CrudTable headers={['Owner', 'Role', <span key="s" className="block text-right">Shares</span>, <span key="p" className="block text-right">% of company</span>]}>
          {visibleOwners.map((t) => (
            <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
              <IdCell sub={t.email}>{t.name}</IdCell>
              <TextCell>{t.kind}</TextCell>
              <AmountCell value={s.holdings.filter((h) => h.stakeholderId === t.id).reduce((a, h) => a + h.shares, 0).toLocaleString()} />
              <td className="px-4 py-2.5 text-right">
                <Input className="ml-auto w-20 text-right font-mono text-xs" title="Ownership % — type a new % and shares recalculate" value={ownershipPct(s, t.id).toFixed(2)} onChange={(e) => setPctFor(t.id, e.target.value)} />
              </td>
              <td className="px-2 py-2.5">
                <RowActions>
                  <IconBtn title={`Edit ${t.name} (name, role, contact)`} onClick={() => setEditSt({ id: t.id, name: t.name, kind: t.kind, email: t.email ?? '', phone: t.phone ?? '' })}>
                    <Pencil className="h-3 w-3" />
                  </IconBtn>
                  <IconBtn title={`Remove ${t.name}`} tone="red" onClick={() => update({ ...s, stakeholders: s.stakeholders.filter((x) => x.id !== t.id), holdings: s.holdings.filter((h) => h.stakeholderId !== t.id), options: s.options.filter((o) => o.stakeholderId !== t.id), safes: s.safes.filter((x) => x.stakeholderId !== t.id) })}>
                    <Trash2 className="h-3 w-3" />
                  </IconBtn>
                </RowActions>
              </td>
            </tr>
          ))}
          {visibleOwners.length === 0 && <EmptyRow colSpan={5}>{s.stakeholders.length === 0 ? 'Nobody listed yet — e.g. you (founder) 80%, your co-founder 20%.' : 'No owners match this filter.'}</EmptyRow>}
        </CrudTable>
        <div className="mt-2 flex gap-2">
          <Input placeholder="Name — e.g. Ama (you)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input className="w-28" placeholder="% — e.g. 80" value={pct} onChange={(e) => setPct(e.target.value)} />
          <select className="rounded border px-2 py-1.5 text-sm" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="founder">Founder</option>
            <option value="investor">Investor</option>
            <option value="employee">Employee</option>
            <option value="advisor">Advisor</option>
          </select>
          <Button onClick={addOwner}>Add owner</Button>
        </div>
        <Tip>Type each person&apos;s % and their share count fills in by itself. The % boxes stay editable — change one any time.</Tip>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Step 3a — Early money (SAFEs & convertible loans) ({s.safes.length})</p>
        </div>
        <TableToolbar>
          <FilterPills options={['all', 'safe', 'note'] as const} value={safeFilter} onChange={setSafeFilter} />
          <Button size="sm" variant="outline" onClick={() => setShowSafe(true)}>＋ Add early money</Button>
        </TableToolbar>
        <CrudTable headers={['Investment', <span key="a" className="block text-right">Amount</span>, 'Terms']}>
          {visibleSafes.map((x) => {
            const st = s.stakeholders.find((t) => t.id === x.stakeholderId)?.name ?? x.stakeholderId;
            const terms = [x.cap ? `cap ${fmt$(x.cap)}` : null, x.discount ? `${(x.discount * 100).toFixed(0)}% off` : 'round price', x.mfn ? 'MFN' : null].filter(Boolean).join(' · ');
            return (
              <tr key={x.id} className="border-b last:border-0 hover:bg-muted/20">
                <IdCell sub={st}>{x.kind === 'safe' ? 'SAFE' : 'Loan'}</IdCell>
                <AmountCell value={fmt$(x.amount)} />
                <TextCell>{terms}</TextCell>
                <td className="px-2 py-2.5">
                  <RowActions>
                    <IconBtn title="Remove (early money can be re-added)" tone="red" onClick={() => update({ ...s, safes: s.safes.filter((y) => y.id !== x.id) })}>
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </RowActions>
                </td>
              </tr>
            );
          })}
          {visibleSafes.length === 0 && <EmptyRow colSpan={4}>{s.safes.length === 0 ? 'No early money yet — skip this if friends & family haven\u2019t invested.' : 'No investments match this filter.'}</EmptyRow>}
        </CrudTable>
        <Tip>A SAFE is early cash that turns into shares later, usually cheaper than the new investors pay. A <em>cap</em> is the highest company value the early investor pays at; a <em>discount</em> is their %-off the round price. We always give them whichever is cheaper.</Tip>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Step 3b — Staff option pool</p>
          <Input className="w-32" placeholder="Pool size" value={pool} onChange={(e) => setPool(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => update({ ...s, optionPoolAuthorized: Number(pool) || 0 })}>Set aside ({s.optionPoolAuthorized.toLocaleString()})</Button>
          <Button size="sm" variant="outline" onClick={() => setShowGrant(true)}>＋ Give options</Button>
        </div>
        <CrudTable headers={['Staff', <span key="g" className="block text-right">Promised</span>, <span key="v" className="block text-right">Earned</span>, 'Progress']}>
          {s.options.map((o) => {
            const st = s.stakeholders.find((t) => t.id === o.stakeholderId)?.name ?? o.stakeholderId;
            const vpct = o.granted ? Math.round((o.vested / o.granted) * 100) : 0;
            return (
              <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20">
                <IdCell sub={o.strike ? `buys at ${fmt$(o.strike)} each` : undefined}>{st}</IdCell>
                <AmountCell value={o.granted.toLocaleString()} />
                <AmountCell value={o.vested.toLocaleString()} sub={`${vpct}% vested`} />
                <td className="px-4 py-2.5">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${vpct}%` }} />
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <RowActions>
                    <IconBtn title="Remove grant" tone="red" onClick={() => update({ ...s, options: s.options.filter((y) => y.id !== o.id) })}>
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </RowActions>
                </td>
              </tr>
            );
          })}
          {s.options.length === 0 && <EmptyRow colSpan={5}>No option grants yet — set a pool aside, then give options.</EmptyRow>}
        </CrudTable>
        <Tip>The pool is shares kept aside for future and current staff. <em>Vested</em> means already earned (usually monthly over 4 years); unvested shares still count in everyone&apos;s % above.</Tip>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Step 4 — The new round: how much are you raising?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="text-sm">Shares before round <Input className="mt-0.5 w-40" value={preShares} onChange={(e) => setPreShares(e.target.value)} /></label>
          <label className="text-sm">Price per share ($) <Input className="mt-0.5 w-32" placeholder={impliedPrice > 0 ? `≈ ${impliedPrice.toFixed(2)}` : 'e.g. 2.00'} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="text-sm">Raising now ($) <Input className="mt-0.5 w-40" value={newMoney} onChange={(e) => setNewMoney(e.target.value)} /></label>
        </div>
        <Tip>Price per share is usually <em>pre-money value ÷ shares before the round</em>{impliedPrice > 0 ? ` — about $${impliedPrice.toFixed(2)} with your numbers, already filled in unless you type your own` : ''}. New shares = money raised ÷ price.</Tip>
        <div className="mt-3 rounded-xl bg-muted/40 p-3 text-sm">
          <p className="font-semibold">The answer — calculated automatically</p>
          <p className="mt-1">Company value before: <strong>{fmtM(math.preMoney)}</strong> (pre-money) → after: <strong>{fmtM(math.postMoney)}</strong> (post-money = pre + early money {fmtM(math.convertingAmount)} + new cash {fmtM(math.newMoney)})</p>
          <p>New shares created: <strong>{Math.round(math.newShares).toLocaleString()}</strong> for investors + <strong>{Math.round(math.convertingShares).toLocaleString()}</strong> for early backers</p>
          <div className="mt-2 space-y-0.5">
            {math.rows.map((r) => {
              const st = s.stakeholders.find((t) => t.id === r.stakeholderId);
              return <p key={r.stakeholderId}>{st?.name}: <strong>{r.prePct.toFixed(2)}%</strong> → <strong>{r.postPct.toFixed(2)}%</strong>{r.convertedShares > 0 && <span className="text-muted-foreground"> (incl. {Math.round(r.convertedShares).toLocaleString()} early-bird shares)</span>}</p>;
            })}
            {math.rows.length === 0 && <p className="text-muted-foreground">Add owners in step 2 to see everyone&apos;s before → after %.</p>}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Extra — if you sold the company, who gets what?</p>
        <div className="mt-1 flex gap-2">
          <Input className="w-40" placeholder="Sale price $" value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {exit.map((x) => {
            const st = s.stakeholders.find((t) => t.id === x.stakeholderId)?.name ?? x.stakeholderId;
            return <p key={x.stakeholderId}>{st}: {fmt$(x.amount)}</p>;
          })}
          {exit.length === 0 && <p>Enter a sale price to split it.</p>}
        </div>
        <Tip>Preferred share classes get paid first (see share types below), everyone else splits what&apos;s left by %. This is the same math lawyers call a <em>waterfall</em>.</Tip>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Share types — advanced, optional ({s.classes.length})</p>
          <Button size="sm" variant="outline" onClick={() => setShowClass(true)}>＋ Add type</Button>
        </div>
        <CrudTable headers={['Type', 'Payout order', 'Multiple', 'Holdings']}>
          {s.classes.map((c) => {
            const used = classUsage(s, c.id);
            return (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                <IdCell>{c.name}</IdCell>
                <TextCell>{c.seniority === 0 ? '0 — paid last (common)' : `${c.seniority}`}</TextCell>
                <TextCell>{c.liquidationMultiple ? `${c.liquidationMultiple}×` : '1×'}</TextCell>
                <TextCell>{used > 0 ? `${used} holding${used === 1 ? '' : 's'}` : 'unused'}</TextCell>
                <td className="px-2 py-2.5">
                  <RowActions>
                    <IconBtn title={`Edit ${c.name}`} onClick={() => setEditClass({ id: c.id, name: c.name, seniority: String(c.seniority), mult: c.liquidationMultiple ? String(c.liquidationMultiple) : '' })}>
                      <Pencil className="h-3 w-3" />
                    </IconBtn>
                    <IconBtn
                      title={used > 0 ? `Cannot remove — ${used} holding(s) point at it` : `Remove ${c.name}`}
                      tone="red"
                      onClick={() => {
                        try {
                          update(deleteShareClass(s, c.id));
                          setMsg(null);
                        } catch (e) {
                          setMsg(e instanceof Error ? e.message : 'Could not delete.');
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </IconBtn>
                  </RowActions>
                </td>
              </tr>
            );
          })}
        </CrudTable>
        <Tip>Most small businesses only need &quot;Common&quot;. Add a type (e.g. &quot;Series A Preferred&quot;) when investors negotiate to be paid first on a sale.</Tip>
      </Card>

      <FormDialog
        open={showClass}
        onOpenChange={setShowClass}
        title="New share type"
        description="Most small businesses only ever need “Common”."
        submitLabel="Add type"
        onSubmit={() => {
          if (!className.trim()) return;
          update({ ...s, classes: [...s.classes, { id: `cl-${Date.now().toString(36)}`, name: className.trim(), seniority: s.classes.length, liquidationMultiple: Number(mult) || undefined }] });
          setClassName(''); setMult(''); setShowClass(false);
        }}
      >
        <TextField label="Type name" value={className} onChange={setClassName} placeholder="e.g. Series A Preferred" />
        <TextField label="Payout multiple (optional)" value={mult} onChange={setMult} placeholder="e.g. 1" type="number" hint="Paid first on a sale, this many times over. Common shares are order 0 with 1×." />
      </FormDialog>

      <FormDialog
        open={showSafe}
        onOpenChange={setShowSafe}
        title="Add early money"
        description="Cash invested now that turns into shares at the next round — cheaper than new investors pay."
        submitLabel="Record it"
        onSubmit={() => {
          const amt = Number(safeForm.amount);
          if (!safeForm.stakeholderId || !(amt > 0)) { setMsg('Pick who invested and enter the amount first.'); return; }
          const safe: SafeNote = {
            id: `safe-${Date.now().toString(36)}`, stakeholderId: safeForm.stakeholderId, amount: amt,
            cap: Number(safeForm.cap) || undefined,
            discount: safeForm.discount ? Number(safeForm.discount) / 100 : undefined,
            mfn: safeForm.mfn, kind: safeForm.kind,
          };
          update({ ...s, safes: [...s.safes, safe] });
          setSafeForm({ stakeholderId: '', amount: '', cap: '', discount: '', kind: 'safe', mfn: false });
          setShowSafe(false); setMsg('Early money recorded — watch it turn into shares in step 4.');
        }}
      >
        <Field label="Who put the money in?">
          <SearchSelect
            options={s.stakeholders.map((t) => ({ value: t.id, label: t.name, detail: t.kind }))}
            value={safeForm.stakeholderId}
            onChange={(v) => setSafeForm((f) => ({ ...f, stakeholderId: v }))}
            placeholder="Search owners… (add them in step 2 first)"
            searchPlaceholder="Search owners"
          />
        </Field>
        <FieldGrid cols={2}>
          <SelectField label="Deal type" value={safeForm.kind} onChange={(v) => setSafeForm((f) => ({ ...f, kind: v as 'safe' | 'note' }))} options={[{ value: 'safe', label: 'SAFE — converts later, no interest' }, { value: 'note', label: 'Convertible loan — converts later' }]} />
          <MoneyField label="Amount" value={safeForm.amount} onChange={(v) => setSafeForm((f) => ({ ...f, amount: v }))} placeholder="e.g. 50000" type="number" symbol="$" />
        </FieldGrid>
        <FieldGrid cols={2}>
          <TextField label="Max value (cap)" value={safeForm.cap} onChange={(v) => setSafeForm((f) => ({ ...f, cap: v }))} placeholder="Optional — e.g. 10000000" type="number" hint="Highest company value they pay at." />
          <TextField label="Discount %" value={safeForm.discount} onChange={(v) => setSafeForm((f) => ({ ...f, discount: v }))} placeholder="Optional — e.g. 20" type="number" hint="Their %-off the round price." />
        </FieldGrid>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={safeForm.mfn} onChange={(e) => setSafeForm((f) => ({ ...f, mfn: e.target.checked }))} /> Promise them any better deal given to later investors (MFN)</label>
        <Tip>Unsure? A $10M cap with 20% discount is the most common early deal. Leave both empty and they simply pay the round price.</Tip>
      </FormDialog>

      <FormDialog
        open={showGrant}
        onOpenChange={setShowGrant}
        title="Give staff options"
        description="Promise shares that staff earn over time (vesting)."
        submitLabel="Give options"
        onSubmit={() => {
          const g = Number(grantForm.granted);
          if (!grantForm.stakeholderId || !(g > 0)) { setMsg('Pick who earns them and enter the total promised.'); return; }
          update({ ...s, options: [...s.options, { id: `opt-${Date.now().toString(36)}`, stakeholderId: grantForm.stakeholderId, granted: g, vested: Math.min(g, Number(grantForm.vested) || 0), strike: Number(grantForm.strike) || undefined }] });
          setGrantForm({ stakeholderId: '', granted: '', vested: '', strike: '' });
          setShowGrant(false);
        }}
      >
        <Field label="Who earns them?">
          <SearchSelect
            options={s.stakeholders.map((t) => ({ value: t.id, label: t.name, detail: t.kind }))}
            value={grantForm.stakeholderId}
            onChange={(v) => setGrantForm((f) => ({ ...f, stakeholderId: v }))}
            placeholder="Search owners…"
            searchPlaceholder="Search owners"
          />
        </Field>
        <FieldGrid cols={3}>
          <TextField label="Total promised" value={grantForm.granted} onChange={(v) => setGrantForm((f) => ({ ...f, granted: v }))} placeholder="e.g. 48000" type="number" />
          <TextField label="Earned so far" value={grantForm.vested} onChange={(v) => setGrantForm((f) => ({ ...f, vested: v }))} placeholder="e.g. 12000" type="number" hint="Vested = already theirs." />
          <MoneyField label="Buy price each" value={grantForm.strike} onChange={(v) => setGrantForm((f) => ({ ...f, strike: v }))} placeholder="Optional" type="number" symbol="$" />
        </FieldGrid>
        <Tip>Example: 48,000 shares over 4 years means 1,000 earn each month. The buy price is usually the company value when promised.</Tip>
      </FormDialog>

      <FormDialog
        open={!!editClass}
        onOpenChange={(o) => { if (!o) setEditClass(null); }}
        title={editClass ? `Edit ${s.classes.find((c) => c.id === editClass.id)?.name ?? 'share type'}` : 'Edit share type'}
        description="Rename it, change who gets paid first, or set a payout multiple."
        submitLabel="Save changes"
        onSubmit={() => {
          if (!editClass) return;
          try {
            update(updateShareClass(s, editClass.id, {
              name: editClass.name,
              seniority: Number(editClass.seniority),
              liquidationMultiple: editClass.mult.trim() ? Number(editClass.mult) : null,
            }));
            setEditClass(null); setMsg(null);
          } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Could not save.');
          }
        }}
      >
        <TextField label="Type name" value={editClass?.name ?? ''} onChange={(v) => setEditClass((e) => (e ? { ...e, name: v } : e))} placeholder="e.g. Series A Preferred" />
        <FieldGrid cols={2}>
          <TextField label="Payout order" value={editClass?.seniority ?? '0'} onChange={(v) => setEditClass((e) => (e ? { ...e, seniority: v } : e))} placeholder="0" type="number" hint="Higher = paid earlier on a sale." />
          <TextField label="Payout multiple" value={editClass?.mult ?? ''} onChange={(v) => setEditClass((e) => (e ? { ...e, mult: v } : e))} placeholder="Empty = 1×" type="number" hint="Empty means paid once (1×)." />
        </FieldGrid>
      </FormDialog>

      <FormDialog
        open={!!editSt}
        onOpenChange={(o) => { if (!o) setEditSt(null); }}
        title={editSt ? `Edit ${editSt.name}` : 'Edit owner'}
        description="Contact details stay on the cap table for signatures and updates."
        submitLabel="Save changes"
        onSubmit={() => {
          if (!editSt) return;
          update({ ...s, stakeholders: s.stakeholders.map((t) => t.id === editSt.id ? { ...t, name: editSt.name.trim() || t.name, kind: editSt.kind, email: editSt.email.trim() || undefined, phone: editSt.phone.trim() || undefined } : t) });
          setEditSt(null);
        }}
      >
        <FieldGrid cols={2}>
          <TextField label="Full name" value={editSt?.name ?? ''} onChange={(v) => setEditSt((e) => (e ? { ...e, name: v } : e))} placeholder="e.g. Ama Serwaa" />
          <SelectField label="Role" value={editSt?.kind ?? 'founder'} onChange={(v) => setEditSt((e) => (e ? { ...e, kind: v as Kind } : e))} options={[{ value: 'founder', label: 'Founder' }, { value: 'investor', label: 'Investor' }, { value: 'employee', label: 'Employee' }, { value: 'advisor', label: 'Advisor' }]} />
        </FieldGrid>
        <FieldGrid cols={2}>
          <TextField label="Email" value={editSt?.email ?? ''} onChange={(v) => setEditSt((e) => (e ? { ...e, email: v } : e))} placeholder="For signatures & updates" type="email" />
          <TextField label="Phone" value={editSt?.phone ?? ''} onChange={(v) => setEditSt((e) => (e ? { ...e, phone: v } : e))} placeholder="Optional" />
        </FieldGrid>
      </FormDialog>

      <p className="text-xs text-muted-foreground">Everything saves automatically to this company. Post-money math lives in lib/borga/cap-table.ts — not financial advice, confirm big rounds with your accountant or lawyer.</p>
    </div>
  );
}

