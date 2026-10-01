'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, ArrowLeft, Check, Loader2, Building2, Wallet,
  Users, LineChart, Sparkles,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { parseServices } from '@/lib/borga/services';
import {
  makeOnboarding, industryProfile, INDUSTRY_VALUATION, deriveValuation,
  CURRENCY_SYMBOL, type OnboardingStepId, type Workspace,
} from '@/lib/borga/data';

type StepId = OnboardingStepId;
const ORDER: StepId[] = ['profile', 'industry', 'financials', 'team', 'valuation'];

const STEP_META: Record<StepId, { icon: typeof Building2; title: string; blurb: string }> = {
  profile: { icon: Building2, title: 'Company profile', blurb: 'Legal name, location and branding.' },
  industry: { icon: Building2, title: 'Industry & operations', blurb: 'What you do and how you differ.' },
  financials: { icon: Wallet, title: 'Financials', blurb: 'Revenue inputs for the valuation model.' },
  team: { icon: Users, title: 'Team', blurb: 'Add your key people.' },
  valuation: { icon: LineChart, title: 'Valuation', blurb: 'See your derived, industry-aware value.' },
  knowledge: { icon: Sparkles, title: 'Knowledge', blurb: 'Knowledge base.' },
};

const INDUSTRY_OPTIONS = INDUSTRY_VALUATION.map((e) => e.profile.label);

export function OnboardingWizard() {
  const router = useRouter();
  const { activeWorkspace, updateWorkspace, addFinanceEntry, addEmployee, addKnowledge, setOnboarding, setActiveWorkspace, hydrate, synced, finance, knowledge } = useBorga();
  const ws = activeWorkspace();

  const [step, setStep] = useState<StepId>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('step');
      if (p && ORDER.includes(p as StepId)) return p as StepId;
    }
    return 'profile';
  });

  const [profile, setProfile] = useState({ name: '', legalName: '', country: '', currency: 'USD', website: '', email: '' });
  const [ind, setInd] = useState({ industry: '', description: '', services: '', differentiators: '', facts: '' });
  const [fin, setFin] = useState({ revenue: '', period: 'monthly' });
  const [team, setTeam] = useState<{ name: string; role: string }[]>([{ name: '', role: '' }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!synced) void hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onboarding = ws?.onboarding ?? makeOnboarding();

  function markComplete(ids: StepId[]) {
    if (!ws) return;
    const steps = (onboarding.steps.length ? onboarding.steps : makeOnboarding().steps).map((s) =>
      ids.includes(s.id) ? { ...s, completed: true } : s,
    );
    const completed = steps.every((s) => s.completed);
    setOnboarding(ws.id, { started: true, completed, steps });
  }

  const valFacts = useMemo(
    () => (ws ? deriveValuation(finance, knowledge, ws) : null),
    [ws, finance, knowledge, step],
  );

  if (!ws) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const idx = ORDER.indexOf(step);
  const sym = CURRENCY_SYMBOL[ws.currency ?? 'USD'];

  const errors: Record<string, string> = {};
  if (step === 'profile' && !profile.name.trim()) errors.profile = 'Company name is required.';
  if (step === 'industry' && !ind.industry) errors.industry = 'Pick an industry to calibrate the model.';
  if (step === 'financials') {
    const amt = Number(fin.revenue);
    if (fin.revenue !== '' && (Number.isNaN(amt) || amt < 0)) errors.financials = 'Enter a valid revenue amount.';
  }
  const stepError = errors[step];
  const canContinue = !stepError;

  function next() {
    const ni = Math.min(ORDER.length - 1, idx + 1);
    if (ws) setOnboarding(ws.id, { currentStep: ORDER[ni] });
    setStep(ORDER[ni]);
  }

  async function saveProfile() {
    setSaving(true);
    updateWorkspace(ws!.id, {
      name: profile.name.trim() || ws!.name,
      legalName: profile.legalName.trim() || undefined,
      country: profile.country.trim() || undefined,
      currency: (profile.currency as Workspace['currency']) ?? ws!.currency,
      website: profile.website.trim() || undefined,
      email: profile.email.trim() || undefined,
    });
    markComplete(['profile']);
    setSaving(false);
    next();
  }

  function saveIndustry() {
    const industry = ind.industry || 'General business';
    const profileData = industryProfile(industry);
    updateWorkspace(ws!.id, { industry, services: parseServices(ind.services) });
    addKnowledge({
      id: `kb-company-${Date.now().toString(36)}`,
      category: 'company',
      title: 'What does the company do?',
      answer: ind.description.trim() || industry,
      source: 'Collected',
      updatedAt: new Date().toISOString(),
    });
    addKnowledge({
      id: `kb-services-${Date.now().toString(36)}`,
      category: 'services',
      title: 'Key services & differentiators',
      answer: `Services: ${ind.services || '—'}. Differentiators: ${ind.differentiators || '—'}.`,
      source: 'Collected',
      updatedAt: new Date().toISOString(),
    });
    addKnowledge({
      id: 'kb-valuation',
      category: 'company',
      title: 'Valuation assumptions',
      answer: `Industry: ${industry}. Revenue multiple: ${profileData.baseMultiple}×. Momentum score ${Math.round(profileData.growthProxy)}. Margin proxy ${profileData.marginProxy}%.`,
      source: 'Collected',
      updatedAt: new Date().toISOString(),
    });
    ind.facts
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((line, i) => {
        addKnowledge({
          id: `kb-fact-${Date.now().toString(36)}-${i}`,
          category: 'company',
          title: 'Key fact',
          answer: line,
          source: 'Collected',
          updatedAt: new Date().toISOString(),
        });
      });
    markComplete(['industry', 'knowledge']);
    next();
  }

  function saveFinancials() {
    const amt = Number(fin.revenue) || 0;
    if (amt > 0) {
      const annual = fin.period === 'monthly' ? amt * 12 : amt;
      addFinanceEntry({
        id: `f-onb-${Date.now().toString(36)}`,
        label: 'Onboarding — stated revenue',
        amount: annual,
        category: 'Sales',
        kind: 'revenue',
        dateIso: new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString(),
        source: 'auto',
      });
    }
    markComplete(['financials']);
    next();
  }

  function saveTeam() {
    team.filter((t) => t.name.trim()).forEach((t, i) => {
      addEmployee({
        id: `e-onb-${Date.now().toString(36)}-${i}`,
        name: t.name.trim(),
        role: t.role.trim() || 'Team member',
        department: 'General',
        email: '',
        employmentType: 'full-time',
        status: 'active',
        salary: 0,
        location: '',
        startedAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
        performance: 80,
      });
    });
    markComplete(['team']);
    next();
  }

  function finish() {
    markComplete(['valuation']);
    if (ws) {
      setOnboarding(ws.id, { completed: true, currentStep: 'valuation' });
      setActiveWorkspace(ws.id);
    }
    router.push('/app');
  }

  const StepIcon = STEP_META[step].icon;

  return (
    <div className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Set up {ws.name}</h1>
            <p className="text-xs text-muted-foreground">A 5-step onboarding builds the knowledge base your agents and valuation model use.</p>
          </div>
        </div>

        {/* Stepper */}
        <div className="mb-8 flex items-center gap-2">
          {ORDER.map((s, i) => {
            const done = onboarding.steps.find((x) => x.id === s)?.completed;
            const active = s === step;
            const Icon = STEP_META[s].icon;
            return (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`flex flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-left transition ${
                  active ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-card'
                }`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${done ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <div className="hidden sm:block">
                  <div className="text-[11px] font-semibold">{STEP_META[s].title}</div>
                </div>
              </button>
            );
          })}
        </div>

        <Card className="borga-fade-up p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <StepIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-semibold">{STEP_META[step].title}</h2>
              <p className="text-xs text-muted-foreground">{STEP_META[step].blurb}</p>
            </div>
          </div>

          {step === 'profile' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-muted-foreground">Company name</Label><Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder={ws.name} className="mt-1" /></div>
                <div><Label className="text-xs text-muted-foreground">Legal name</Label><Input value={profile.legalName} onChange={(e) => setProfile({ ...profile, legalName: e.target.value })} className="mt-1" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-muted-foreground">Country</Label><Input value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} className="mt-1" /></div>
                <div><Label className="text-xs text-muted-foreground">Currency</Label>
                  <Select value={profile.currency} onValueChange={(v) => setProfile({ ...profile, currency: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(CURRENCY_SYMBOL).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-muted-foreground">Website</Label><Input value={profile.website} onChange={(e) => setProfile({ ...profile, website: e.target.value })} className="mt-1" /></div>
                <div><Label className="text-xs text-muted-foreground">Email</Label><Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} className="mt-1" /></div>
              </div>
            </div>
          )}

          {step === 'industry' && (
            <div className="space-y-4">
              <div><Label className="text-xs text-muted-foreground">Industry</Label>
                <Select value={ind.industry} onValueChange={(v) => setInd({ ...ind, industry: v })}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select your industry" /></SelectTrigger>
                  <SelectContent>{INDUSTRY_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs text-muted-foreground">What does your company do?</Label>
                <Textarea value={ind.description} onChange={(e) => setInd({ ...ind, description: e.target.value })} placeholder="We help logistics teams route deliveries with AI…" className="mt-1" />
              </div>
              <div><Label className="text-xs text-muted-foreground">Key services / products (comma separated; each becomes a line in your Revenue Tracker)</Label>
                <Input value={ind.services} onChange={(e) => setInd({ ...ind, services: e.target.value })} className="mt-1" />
              </div>
              <div><Label className="text-xs text-muted-foreground">Key differentiators</Label>
                <Input value={ind.differentiators} onChange={(e) => setInd({ ...ind, differentiators: e.target.value })} className="mt-1" />
              </div>
              <div><Label className="text-xs text-muted-foreground">Key facts (one per line — added to the knowledge base)</Label>
                <Textarea value={ind.facts} onChange={(e) => setInd({ ...ind, facts: e.target.value })} placeholder={'We are SOC2 certified\nLaunched in 3 new markets\nMain competitor is Acme'} className="mt-1 min-h-24" />
              </div>
            </div>
          )}

          {step === 'financials' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs text-muted-foreground">Revenue ({sym})</Label><Input type="number" value={fin.revenue} onChange={(e) => setFin({ ...fin, revenue: e.target.value })} placeholder="e.g. 50000" className="mt-1" /></div>
                <div><Label className="text-xs text-muted-foreground">Period</Label>
                  <Select value={fin.period} onValueChange={(v) => setFin({ ...fin, period: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="monthly">Per month</SelectItem><SelectItem value="annual">Per year</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Used to derive your NTM revenue and feed the valuation model. You can refine this anytime in Finance.</p>
            </div>
          )}

          {step === 'team' && (
            <div className="space-y-3">
              {team.map((t, i) => (
                <div key={i} className="grid grid-cols-2 gap-3">
                  <Input value={t.name} onChange={(e) => setTeam(team.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Name" />
                  <Input value={t.role} onChange={(e) => setTeam(team.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} placeholder="Role" />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setTeam([...team, { name: '', role: '' }])}>+ Add person</Button>
            </div>
          )}

          {step === 'valuation' && valFacts && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Blended valuation</p><p className="text-2xl font-bold">{sym}{valFacts.fmv.toFixed(2)}M</p></div>
                <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Revenue multiple</p><p className="text-2xl font-bold">{valFacts.multiple}×</p></div>
                <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">NTM revenue</p><p className="text-2xl font-bold">{sym}{valFacts.revenue.toFixed(2)}M</p></div>
                <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Bear case</p><p className="text-2xl font-bold">{sym}{valFacts.floor.toFixed(2)}M</p></div>
                <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Bull case</p><p className="text-2xl font-bold">{sym}{valFacts.ceiling.toFixed(2)}M</p></div>
                <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs text-muted-foreground">Growth (YoY)</p><p className="text-2xl font-bold">{valFacts.growthPct}%</p></div>
              </div>
              <p className="text-xs text-muted-foreground">
                Derived from your industry ({industryProfile(ws.industry).label}), the revenue you entered, and your knowledge base.
                This updates live as you add real financials and answer more questions.
              </p>
            </div>
          )}

          <div className="mt-7 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(ORDER[Math.max(0, idx - 1)])} disabled={idx === 0}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className="flex items-center gap-3">
              {stepError && <span className="text-xs font-medium text-rose-500">{stepError}</span>}
              {step !== 'valuation' ? (
                <Button onClick={step === 'profile' ? saveProfile : step === 'industry' ? saveIndustry : step === 'financials' ? saveFinancials : saveTeam} disabled={saving || !canContinue}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Continue
                </Button>
              ) : (
                <Button onClick={finish}>Finish & open dashboard <Check className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
