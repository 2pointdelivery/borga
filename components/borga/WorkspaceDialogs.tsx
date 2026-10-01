'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MONTH_NAMES, PLAN_LABEL, makeOnboarding, type Workspace, type WorkspacePlan } from '@/lib/borga/data';
import {
  CityInput,
  CountrySelect,
  CurrencySelect,
  DateInput,
  Field,
  IndustryInput,
  RegionSelect,
  TimezoneSelect,
} from './form-widgets';
import { useBorga } from '@/lib/borga/store';

const COLORS = ['#6366f1', '#0ea5e9', '#059669', '#f59e0b', '#ec4899', '#8b5cf6'];

interface CompanyForm {
  name: string;
  legalName: string;
  tradingName: string;
  industry: string;
  businessNumber: string;
  taxNumber: string;
  incorporationDate: string;
  addressLine: string;
  city: string;
  state: string;
  country: string;
  timezone: string;
  currency: Workspace['currency'];
  fiscalYearEndMonth: number;
  fiscalYearEndDay: number;
  email: string;
  phone: string;
  website: string;
  plan: WorkspacePlan;
}

function formFrom(ws: Workspace | null): CompanyForm {
  return {
    name: ws?.name ?? '',
    legalName: ws?.legalName ?? '',
    tradingName: ws?.tradingName ?? '',
    industry: ws?.industry ?? '',
    businessNumber: ws?.businessNumber ?? '',
    taxNumber: ws?.taxNumber ?? '',
    incorporationDate: ws?.incorporationDate ?? '',
    addressLine: ws?.addressLine ?? '',
    city: ws?.city ?? '',
    state: ws?.state ?? '',
    country: ws?.country ?? '',
    timezone: ws?.timezone ?? 'UTC',
    currency: ws?.currency ?? 'USD',
    fiscalYearEndMonth: ws?.fiscalYearEndMonth ?? 12,
    fiscalYearEndDay: ws?.fiscalYearEndDay ?? 31,
    email: ws?.email ?? '',
    phone: ws?.phone ?? '',
    website: ws?.website ?? '',
    plan: ws?.plan ?? 'trial',
  };
}

function CompanyFormFields({
  form,
  set,
  color,
  setColor,
  showPlan = true,
  suggestCurrency = false,
}: {
  form: CompanyForm;
  set: (patch: Partial<CompanyForm>) => void;
  color: string;
  setColor: (c: string) => void;
  showPlan?: boolean;
  /** Picking a country also sets that country's currency (used when creating a company, not when editing one). */
  suggestCurrency?: boolean;
}) {
  return (
    <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
      {/* Identity */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Identity</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company name *">
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Acme Industries" autoFocus />
          </Field>
          <Field label="Legal name">
            <Input value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder="Acme Industries Inc. Ltd." />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Trading name (DBA)" className="col-span-2">
            <Input value={form.tradingName} onChange={(e) => set({ tradingName: e.target.value })} placeholder="AcmeGo" />
          </Field>
          <Field label="Industry">
            <IndustryInput value={form.industry} onChange={(v) => set({ industry: v })} />
          </Field>
        </div>
      </section>

      {/* Regulatory */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Regulatory &amp; tax</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Business number">
            <Input value={form.businessNumber} onChange={(e) => set({ businessNumber: e.target.value })} placeholder="85472 1666 RC0001" />
          </Field>
          <Field label="Tax number (VAT/GST/EIN)">
            <Input value={form.taxNumber} onChange={(e) => set({ taxNumber: e.target.value })} placeholder="RT00012345" />
          </Field>
          <Field label="Incorporation date">
            <DateInput value={form.incorporationDate} onChange={(v) => set({ incorporationDate: v })} />
          </Field>
        </div>
      </section>

      {/* Localization */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Localization</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Address" className="col-span-3 sm:col-span-1">
            <Input value={form.addressLine} onChange={(e) => set({ addressLine: e.target.value })} placeholder="100 Main St, Suite 200" />
          </Field>
          <Field label="Country">
            <CountrySelect value={form.country} onChange={(v) => set({ country: v, state: '', city: '' })} onPick={(c) => suggestCurrency && c.cur && set({ currency: c.cur })} />
          </Field>
          <Field label="State / Province">
            <RegionSelect country={form.country} value={form.state} onChange={(v) => set({ state: v })} />
          </Field>
          <Field label="City">
            <CityInput country={form.country} state={form.state} value={form.city} onChange={(v) => set({ city: v })} />
          </Field>
          <Field label="Currency">
            <CurrencySelect value={form.currency} onChange={(v) => set({ currency: v })} />
          </Field>
          <Field label="Timezone">
            <TimezoneSelect value={form.timezone} onChange={(v) => set({ timezone: v })} />
          </Field>
        </div>
      </section>

      {/* Financial year */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Accounting year close</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fiscal year end  month">
            <Select value={String(form.fiscalYearEndMonth)} onValueChange={(v) => set({ fiscalYearEndMonth: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_NAMES.map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fiscal year end  day">
            <Input type="number" min={1} max={31} value={form.fiscalYearEndDay} onChange={(e) => set({ fiscalYearEndDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Drives the annual book-closure period and financial-report year presets.
        </p>
      </section>

      {/* Contact */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contact</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="hello@acme.com" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+1 306 555 0100" />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="acme.com" />
          </Field>
        </div>
      </section>

      {/* Brand + plan */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</p>
        <div className="flex flex-wrap items-center gap-6">
          {showPlan && (
            <Field label="Plan">
              <Select value={form.plan} onValueChange={(v) => set({ plan: v as WorkspacePlan })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PLAN_LABEL) as WorkspacePlan[]).map((p) => (
                    <SelectItem key={p} value={p}>{PLAN_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Colour</Label>
            <div className="mt-2 flex gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Use colour ${c}`}
                  className={
                    'h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-background transition-transform hover:scale-110 ' +
                    (color === c ? 'ring-foreground' : 'ring-transparent')
                  }
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { addWorkspace, setActiveWorkspace, log } = useBorga();
  const router = useRouter();
  const [form, setForm] = useState<CompanyForm>(formFrom(null));
  const [color, setColor] = useState(COLORS[0]);

  useEffect(() => {
    if (open) {
      setForm(formFrom(null));
      setColor(COLORS[(Math.random() * COLORS.length) | 0]);
    }
  }, [open]);

  const set = (patch: Partial<CompanyForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.name.trim()) return;
    const ws: Workspace = {
      id: `ws-${Date.now().toString(36)}`,
      name: form.name.trim(),
      industry: form.industry.trim() || 'General',
      plan: form.plan,
      color,
      currency: form.currency,
      createdAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
      legalName: form.legalName.trim() || undefined,
      tradingName: form.tradingName.trim() || undefined,
      businessNumber: form.businessNumber.trim() || undefined,
      taxNumber: form.taxNumber.trim() || undefined,
      incorporationDate: form.incorporationDate || undefined,
      addressLine: form.addressLine.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      country: form.country || undefined,
      timezone: form.timezone,
      fiscalYearEndMonth: form.fiscalYearEndMonth,
      fiscalYearEndDay: form.fiscalYearEndDay,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      website: form.website.trim() || undefined,
      // This dialog already collected the company profile, so the wizard must not ask for it again on a second, simpler page:
      // the profile step starts completed and the wizard opens at the next step.
      onboarding: ((ob) => ({ ...ob, started: true, currentStep: 'industry' as const, steps: ob.steps.map((s) => (s.id === 'profile' ? { ...s, completed: true } : s)) }))(makeOnboarding()),
    };
    addWorkspace(ws);
    setActiveWorkspace(ws.id);
    log({
      agentId: 'a-borga',
      agentName: 'Borga',
      actor: 'user',
      kind: 'system',
      message: `Company "${ws.name}" registered${ws.country ? ` in ${ws.country}` : ''} and activated. All modules now scope to this tenant.`,
    });
    onOpenChange(false);
    router.push('/app/onboarding?step=industry');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> New company workspace
          </DialogTitle>
          <DialogDescription>
            Register the company once — legal identity, tax numbers, localization and fiscal year feed every module.
          </DialogDescription>
        </DialogHeader>
        <CompanyFormFields form={form} set={set} color={color} setColor={setColor} suggestCurrency />
        <DialogFooter>
          <Button onClick={submit} disabled={!form.name.trim()}>Create workspace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { updateWorkspace, log } = useBorga();
  const [form, setForm] = useState<CompanyForm>(formFrom(workspace));
  const [color, setColor] = useState(workspace?.color ?? COLORS[0]);
  const [primedId, setPrimedId] = useState<string | null>(null);

  // Re-seed the form whenever a different workspace is opened for editing.
  if (open && workspace && primedId !== workspace.id) {
    setPrimedId(workspace.id);
    setForm(formFrom(workspace));
    setColor(workspace.color);
  }

  useEffect(() => {
    if (!open) setPrimedId(null);
  }, [open]);

  if (!workspace) return null;

  const set = (patch: Partial<CompanyForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    if (!form.name.trim()) return;
    updateWorkspace(workspace.id, {
      name: form.name.trim(),
      industry: form.industry.trim() || workspace.industry,
      plan: form.plan,
      color,
      currency: form.currency,
      legalName: form.legalName.trim() || undefined,
      tradingName: form.tradingName.trim() || undefined,
      businessNumber: form.businessNumber.trim() || undefined,
      taxNumber: form.taxNumber.trim() || undefined,
      incorporationDate: form.incorporationDate || undefined,
      addressLine: form.addressLine.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      country: form.country || undefined,
      timezone: form.timezone,
      fiscalYearEndMonth: form.fiscalYearEndMonth,
      fiscalYearEndDay: form.fiscalYearEndDay,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      website: form.website.trim() || undefined,
    });
    log({
      agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system',
      message: `Company profile updated for ${form.name.trim()}.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit company — {workspace.name}</DialogTitle>
          <DialogDescription>Update the company profile shown across the suite.</DialogDescription>
        </DialogHeader>
        <CompanyFormFields form={form} set={set} color={color} setColor={setColor} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
