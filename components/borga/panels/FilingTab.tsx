'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Download, ExternalLink, Info, Plus, Settings2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoneyFull } from '@/lib/borga/currencies';
import {
  ENTITY_LABEL, ENTITY_TYPES_BY_COUNTRY, FREQUENCY_LABEL, LEVEL_LABEL, fiscalYearEnd, isIso, jurisdictionOf, levelLabel, recordKey,
  type CustomObligation, type DueState, type EntityType, type FilingLevel, type FilingProfile, type FilingRecord, type Frequency,
} from '@/lib/borga/filing-catalog';
import { planFilings, summarize, type PlanRow } from '@/lib/borga/filing-plan';
import { figuresCsv, figuresFor } from '@/lib/borga/filing-figures';
import { SectionTitle } from '../bits';
import { DateInput, Field } from '../form-widgets';

const todayIso = () => new Date().toISOString().slice(0, 10);
const newCustomId = (name: string) => `custom-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Math.random().toString(36).slice(2, 7)}`;
const noopSubscribe = () => () => {};
/** Today's date, as an empty string while the page is rendered on the server so the two renders never disagree. */
const useToday = () => useSyncExternalStore(noopSubscribe, todayIso, () => '');

const fmtDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const STATE_STYLE: Record<DueState, string> = {
  filed: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  'not-required': 'bg-muted text-muted-foreground ring-border',
  overdue: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  'due-soon': 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  upcoming: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  'needs-date': 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
};

function stateText(r: PlanRow): string {
  switch (r.state) {
    case 'filed': return 'Filed';
    case 'not-required': return 'Not required';
    case 'overdue': return `Overdue by ${Math.abs(r.daysLeft ?? 0)} day${Math.abs(r.daysLeft ?? 0) === 1 ? '' : 's'}`;
    case 'due-soon': return r.daysLeft === 0 ? 'Due today' : `Due in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`;
    case 'needs-date': return 'Enter the date';
    default: return 'Upcoming';
  }
}

export function FilingTab() {
  const { activeWorkspace, filings, setFilingProfile, saveFilingRecord, clearFilingRecord, employees, invoices, bills, taxProfiles, log } = useBorga();
  const today = useToday();
  const ws = activeWorkspace();
  const [setupOpen, setSetupOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [open, setOpen] = useState<PlanRow | null>(null);
  const [showFiled, setShowFiled] = useState(false);

  const jurisdiction = useMemo(() => jurisdictionOf(ws?.country, ws?.state), [ws?.country, ws?.state]);
  const profile = filings.profile;
  const fye = useMemo(() => fiscalYearEnd(ws), [ws]);
  const ctx = useMemo(
    () => ({
      employees: profile.hasEmployees ?? employees.some((e) => e.status !== 'offboarded'),
      registered: profile.salesTaxRegistered ?? !!ws?.taxNumber?.trim(),
    }),
    [profile.hasEmployees, profile.salesTaxRegistered, employees, ws?.taxNumber],
  );
  const joined = ws?.createdAt && isIso(ws.createdAt.slice(0, 10)) ? ws.createdAt.slice(0, 10) : today;
  const trackedFrom = profile.trackedFrom ?? joined;

  const rows = useMemo(
    () => (today ? planFilings({ jurisdiction, profile, ctx, fye, today, trackedFrom, records: filings.records }) : []),
    [today, jurisdiction, profile, ctx, fye, trackedFrom, filings.records],
  );
  const summary = summarize(rows);
  const active = rows.filter((r) => r.state !== 'filed' && r.state !== 'not-required');
  const done = rows.filter((r) => r.state === 'filed' || r.state === 'not-required');
  const currency = ws?.currency ?? 'USD';

  const levels: FilingLevel[] = ['federal', 'provincial', 'state', 'regional'];
  const grouped = levels.map((l) => ({ level: l, rows: (showFiled ? rows : active).filter((r) => r.ob.level === l) })).filter((g) => g.rows.length > 0);

  if (!ws) return <Card className="p-6 text-sm text-muted-foreground">Create or select a company to see its tax filings.</Card>;

  const place = [ws.city, ws.state, ws.country].filter(Boolean).join(', ');
  const customRemove = (id: string) => setFilingProfile({ custom: profile.custom.filter((c) => c.id !== id) });

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Tax filings"
          sub={ws.country ? `${ws.country}${ws.state ? ` · ${ws.state}` : ''}: ${levelLabel(jurisdiction.country, 'federal').toLowerCase()}${jurisdiction.regionLevel ? ` and ${jurisdiction.regionLevel}` : ''} returns, due dates and worksheets` : 'Set the company country to see which returns apply'}
        />
        <Button variant="outline" onClick={() => setSetupOpen(true)}><Settings2 className="h-4 w-4" /> Filing setup</Button>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
        <p>
          This page tells you which returns your company has to file, when, and prepares the figures from your invoices and bills. It does <strong>not</strong> file anything
          with a tax authority: you or your accountant files, then records it here. Dates are the general rule. A weekend or holiday, an extension, or a different
          filing frequency assigned to you by the authority can change them. Rows marked &ldquo;confirm&rdquo; are the ones we are less sure of.
        </p>
      </Card>

      {!profile.confirmed && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-sky-500/30 bg-sky-500/5 p-4">
          <div className="text-sm">
            <p className="font-medium">Check your filing setup</p>
            <p className="text-xs text-muted-foreground">
              We assumed a {ENTITY_LABEL[profile.entityType].toLowerCase()}{ctx.registered ? ` registered for sales tax, filing ${FREQUENCY_LABEL[profile.salesTaxFrequency].toLowerCase()}` : ' not registered for sales tax'}
              {ctx.employees ? ', with employees' : ', with no employees'}. Wrong guesses mean wrong due dates.
            </p>
          </div>
          <Button size="sm" onClick={() => setSetupOpen(true)}>Review setup</Button>
        </Card>
      )}

      {jurisdiction.notes.length > 0 && (
        <Card className="space-y-1 p-3 text-xs text-muted-foreground">
          {jurisdiction.notes.map((n) => (
            <p key={n} className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {n}</p>
          ))}
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile icon={AlertTriangle} label="Overdue" value={summary.overdue} tone={summary.overdue ? 'text-rose-600' : ''} />
        <Tile icon={CalendarClock} label="Due in 30 days" value={summary.dueSoon} tone={summary.dueSoon ? 'text-amber-600' : ''} />
        <Tile icon={Info} label="Need a date" value={summary.needsDate} />
        <Tile icon={CheckCircle2} label="Filed (tracked)" value={summary.filed} tone="text-emerald-600" />
      </div>

      {jurisdiction.country === 'OTHER' && profile.custom.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">
          There are no built-in filings for {ws.country || 'this country'} yet. Add the returns your company has to file below and they will be tracked the same way.
        </Card>
      )}

      {grouped.length === 0 && jurisdiction.country !== 'OTHER' && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {showFiled ? 'Nothing to show.' : 'No filings are open right now.'}
        </Card>
      )}

      {grouped.map((g) => (
        <Card key={g.level} className="overflow-hidden">
          <div className="border-b bg-muted/40 px-4 py-2.5">
            <p className="text-sm font-semibold">{levelLabel(jurisdiction.country, g.level)}</p>
            <p className="text-[11px] text-muted-foreground">
              {g.level === 'federal' && jurisdiction.country !== 'GH' && 'Filed with the national tax authority.'}
              {g.level === 'federal' && jurisdiction.country === 'GH' && 'Filed with the Ghana Revenue Authority and SSNIT.'}
              {g.level === 'provincial' && `Filed with ${jurisdiction.regionName || 'your province'}.`}
              {g.level === 'state' && `Filed with ${jurisdiction.regionName || 'your state'}.`}
              {g.level === 'regional' && 'Filed with your local authority.'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Filing</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Period</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="w-24 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={`${r.ob.id}|${r.filing.key}`} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">
                        {r.ob.name}
                        {r.ob.form && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{r.ob.form}</span>}
                        {r.ob.confidence === 'confirm' && <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">confirm</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{r.ob.authority}</p>
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{r.filing.label}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(r.due)}{r.record?.dueOverride && r.due === r.record.dueOverride ? <span className="ml-1 text-[10px] text-muted-foreground">(yours)</span> : null}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATE_STYLE[r.state]}`}>{stateText(r)}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {done.length > 0 && (
        <button className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowFiled((v) => !v)}>
          {showFiled ? 'Hide' : 'Show'} {done.length} filed or not required
        </button>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Your own filings</p>
            <p className="text-[11px] text-muted-foreground">Anything not covered above: another country, a licence, an industry return. Tracked the same way.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setCustomOpen(true)}><Plus className="h-3.5 w-3.5" /> Add a filing</Button>
        </div>
        {profile.custom.length > 0 && (
          <ul className="mt-3 divide-y text-sm">
            {profile.custom.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.authority} · {FREQUENCY_LABEL[c.frequency].toLowerCase()} · {c.day === 'end' ? 'last day' : `day ${c.day}`} of month {c.monthsAfter} after the period</span>
                </span>
                <button className="text-muted-foreground hover:text-destructive" title="Remove" onClick={() => customRemove(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Tracking filings due on or after {fmtDate(trackedFrom)}{place ? ` for ${ws.legalName || ws.name} (${place})` : ''}. Change this in Filing setup to include earlier ones.
      </p>

      {setupOpen && (
        <SetupDialog
          profile={profile} country={jurisdiction.country} detected={ctx} joined={joined}
          onClose={() => setSetupOpen(false)}
          onSave={(p) => { setFilingProfile({ ...p, confirmed: true }); log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: 'Tax filing setup updated.' }); setSetupOpen(false); }}
        />
      )}
      {customOpen && (
        <CustomDialog
          onClose={() => setCustomOpen(false)}
          onSave={(c) => { setFilingProfile({ custom: [...profile.custom, c] }); setCustomOpen(false); }}
        />
      )}
      {open && (
        <FilingDialog
          key={`${open.ob.id}|${open.filing.key}`} row={open} today={today} currency={currency} legal={ws.legalName || ws.name}
          data={{ invoices, bills, employees, taxProfiles }}
          onClose={() => setOpen(null)}
          onSave={(rec) => { saveFilingRecord(rec); log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `${open.ob.name} (${open.filing.label}) marked ${rec.status === 'filed' ? 'filed' : 'not required'}.` }); setOpen(null); }}
          onClear={(key) => { clearFilingRecord(key); setOpen(null); }}
        />
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, tone = '' }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone?: string }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <Icon className={`h-5 w-5 ${tone || 'text-muted-foreground'}`} />
      <div>
        <p className={`text-xl font-semibold leading-none ${tone}`}>{value}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

// ── one filing: the worksheet and the record ──────────────────────────────────────────────────────────────────────────

function FilingDialog({ row, today, currency, legal, data, onClose, onSave, onClear }: {
  row: PlanRow; today: string; currency: string; legal: string;
  data: Parameters<typeof figuresFor>[2];
  onClose: () => void; onSave: (rec: FilingRecord) => void; onClear: (key: string) => void;
}) {
  const key = recordKey(row.ob.id, row.filing.key);
  const rec = row.record;
  const [status, setStatus] = useState<'open' | 'filed' | 'not-required'>(rec?.status ?? 'open');
  const [filedOn, setFiledOn] = useState(rec?.filedOn ?? today);
  const [reference, setReference] = useState(rec?.reference ?? '');
  const [amount, setAmount] = useState(rec?.amount != null ? String(rec.amount) : '');
  const [note, setNote] = useState(rec?.note ?? '');
  const [dueOverride, setDueOverride] = useState(rec?.dueOverride ?? '');
  const figs = useMemo(() => figuresFor(row.ob, row.filing.period, data), [row.ob, row.filing.period, data]);
  const manual = row.filing.due === null;
  const title = `${row.ob.name} · ${row.filing.label}`;

  const download = () => {
    if (!figs) return;
    const blob = new Blob([figuresCsv(`${legal}: ${title}`, figs, currency)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${row.ob.id}-${row.filing.key.replace('#', '-')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const save = () => {
    if (status === 'open') { onClear(key); return; }
    const n = Number(amount);
    onSave({
      key, status,
      filedOn: status === 'filed' && isIso(filedOn) ? filedOn : undefined,
      reference: reference.trim() || undefined,
      amount: amount.trim() !== '' && Number.isFinite(n) ? n : undefined,
      note: note.trim() || undefined,
      dueOverride: isIso(dueOverride) ? dueOverride : undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{row.ob.name}</DialogTitle>
          <DialogDescription>
            {row.ob.authority}{row.ob.form ? ` · Form ${row.ob.form}` : ''} · {row.filing.label}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATE_STYLE[row.state]}`}>{stateText(row)}</span>
            <span className="text-muted-foreground">Due {fmtDate(row.due)}</span>
            {row.ob.url && (
              <a href={row.ob.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Authority page <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {row.ob.note && <p className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">{row.ob.note}</p>}

          {figs && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worksheet · {row.filing.period.start} to {row.filing.period.end}</p>
                <Button size="sm" variant="ghost" onClick={download}><Download className="h-3.5 w-3.5" /> CSV</Button>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {figs.lines.map((l) => (
                    <tr key={l.label} className="border-b last:border-0">
                      <td className={`py-1.5 pr-3 ${l.strong ? 'font-semibold' : 'text-muted-foreground'}`}>{l.label}</td>
                      <td className={`py-1.5 text-right font-mono text-xs ${l.strong ? 'font-semibold' : ''}`}>{l.count ? l.amount : fmtMoneyFull(l.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {figs.skippedUndated > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-600">{figs.skippedUndated} document{figs.skippedUndated === 1 ? ' has' : 's have'} a date that is not a calendar date and {figs.skippedUndated === 1 ? 'is' : 'are'} left out. Open {figs.skippedUndated === 1 ? 'it' : 'them'} and set the date.</p>
              )}
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                {figs.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}

          <div className="space-y-3 border-t pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Record</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open (not filed yet)</SelectItem>
                    <SelectItem value="filed">Filed</SelectItem>
                    <SelectItem value="not-required">Not required</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {status === 'filed' && <Field label="Filed on"><DateInput value={filedOn} onChange={setFiledOn} /></Field>}
            </div>
            {status === 'filed' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Confirmation number"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="From the authority" /></Field>
                <Field label={`Amount paid (${currency})`}><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
              </div>
            )}
            <Field
              label={manual ? 'Due date (enter it)' : 'Your own due date (optional)'}
              hint={manual ? 'The date depends on your state or authority; enter it from their notice.' : 'Use this if the authority gave you an extension or a different date.'}
            >
              <DateInput value={dueOverride} onChange={setDueOverride} />
            </Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{status === 'open' ? (rec ? 'Reopen' : 'Save') : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── setup ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Tri = 'auto' | 'yes' | 'no';
const triOf = (v: boolean | undefined): Tri => (v === undefined ? 'auto' : v ? 'yes' : 'no');
const boolOf = (t: Tri): boolean | undefined => (t === 'auto' ? undefined : t === 'yes');

function SetupDialog({ profile, country, detected, joined, onClose, onSave }: {
  profile: FilingProfile; country: ReturnType<typeof jurisdictionOf>['country'];
  detected: { employees: boolean; registered: boolean }; joined: string;
  onClose: () => void; onSave: (p: FilingProfile) => void;
}) {
  const [entityType, setEntityType] = useState<EntityType>(profile.entityType);
  const [employees, setEmployees] = useState<Tri>(triOf(profile.hasEmployees));
  const [registered, setRegistered] = useState<Tri>(triOf(profile.salesTaxRegistered));
  const [freq, setFreq] = useState<Frequency>(profile.salesTaxFrequency);
  const [from, setFrom] = useState(profile.trackedFrom ?? joined);
  const entities = ENTITY_TYPES_BY_COUNTRY[country];
  const triSelect = (v: Tri, set: (t: Tri) => void, autoLabel: string) => (
    <Select value={v} onValueChange={(x) => set(x as Tri)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{autoLabel}</SelectItem>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
      </SelectContent>
    </Select>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Filing setup</DialogTitle>
          <DialogDescription>These answers decide which returns appear and how often. Your accountant can confirm them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Business structure">
            <Select value={entityType} onValueChange={(v) => setEntityType(v as EntityType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{entities.map((e) => <SelectItem key={e} value={e}>{ENTITY_LABEL[e]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Registered for sales tax (GST/HST, VAT, sales tax)?" hint={`Detected from the company profile: ${detected.registered ? 'yes, a tax number is set' : 'no tax number is set'}.`}>
            {triSelect(registered, setRegistered, 'Detect from my tax number')}
          </Field>
          <Field label="How often do you file it?" hint="The authority assigns this when you register. It is on your registration letter or in your online account.">
            <Select value={freq} onValueChange={(v) => setFreq(v as Frequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(['monthly', 'quarterly', 'annual'] as const).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Do you have employees on payroll?" hint={`Detected from the People page: ${detected.employees ? 'yes' : 'none'}.`}>
            {triSelect(employees, setEmployees, 'Detect from the People page')}
          </Field>
          <Field label="Track filings due from" hint="Earlier filings are not listed. Move this back to catch up on ones you have not recorded.">
            <DateInput value={from} onChange={setFrom} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave({ ...profile, entityType, hasEmployees: boolOf(employees), salesTaxRegistered: boolOf(registered), salesTaxFrequency: freq, trackedFrom: isIso(from) ? from : undefined })}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── a filing of the user's own ────────────────────────────────────────────────────────────────────────────────────────

function CustomDialog({ onClose, onSave }: { onClose: () => void; onSave: (c: CustomObligation) => void }) {
  const [name, setName] = useState('');
  const [authority, setAuthority] = useState('');
  const [level, setLevel] = useState<FilingLevel>('federal');
  const [frequency, setFrequency] = useState<Frequency>('annual');
  const [basis, setBasis] = useState<'fiscal' | 'calendar'>('fiscal');
  const [months, setMonths] = useState('1');
  const [lastDay, setLastDay] = useState(true);
  const [day, setDay] = useState('15');
  const m = Number(months);
  const d = Number(day);
  const valid = name.trim() !== '' && Number.isInteger(m) && m >= 0 && m <= 24 && (lastDay || (Number.isInteger(d) && d >= 1 && d <= 31));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a filing</DialogTitle>
          <DialogDescription>Describe how the due date follows from the end of each period.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name *"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. VAT return" /></Field>
          <Field label="Authority"><Input value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="e.g. the tax office" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Level">
              <Select value={level} onValueChange={(v) => setLevel(v as FilingLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(LEVEL_LABEL) as FilingLevel[]).map((l) => <SelectItem key={l} value={l}>{LEVEL_LABEL[l]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="How often">
              <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(['monthly', 'quarterly', 'annual'] as const).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Periods follow">
            <Select value={basis} onValueChange={(v) => setBasis(v as typeof basis)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fiscal">The company&apos;s fiscal year</SelectItem>
                <SelectItem value="calendar">The calendar year</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Months after the period ends"><Input type="number" min={0} max={24} value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
            <Field label="On day">
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={31} value={day} disabled={lastDay} onChange={(e) => setDay(e.target.value)} className="w-20" />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Switch checked={lastDay} onCheckedChange={setLastDay} /> Last day</label>
              </div>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid}
            onClick={() => onSave({ id: newCustomId(name), name: name.trim(), authority: authority.trim(), level, frequency, periodBasis: basis, monthsAfter: m, day: lastDay ? 'end' : d })}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
