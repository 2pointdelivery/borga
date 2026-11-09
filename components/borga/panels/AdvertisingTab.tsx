'use client';

import { useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  DollarSign,
  CircleDollarSign,
  MousePointerClick,
  TrendingUp,
  Megaphone,
  AlertTriangle,
  Check,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  AD_PLATFORM_LABEL,
  AD_STATUS_STYLE,
  campaignPacing,
  fmtNum,
  type AdCampaign,
  type AdPlatform,
} from '@/lib/borga/data';
import { parseAdCsv, dedupeAdRows } from '@/lib/borga/ads-import';
import { computeCashRunway } from '@/lib/borga/insights';
import { fmtMoney } from '@/lib/borga/currencies';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { CampaignEditDialog } from './SocialEditDialogs';
import { cn } from '@/lib/utils';

export function AdvertisingTab() {
  const { ads, addCampaign, setCampaignStatus, log, finance, bankAccounts, activeWorkspace } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const [adOpen, setAdOpen] = useState(false);
  const [confirmThinRunway, setConfirmThinRunway] = useState(false);
  const [editCampaign, setEditCampaign] = useState<AdCampaign | null>(null);
  const [adForm, setAdForm] = useState<{
    name: string;
    platforms: AdPlatform[];
    budgetMode: 'per-platform' | 'split';
    budget: string;
    spent: string;
    status: AdCampaign['status'];
    draft?: AdCampaign['draft'];
  }>({
    name: '',
    platforms: ['google'],
    budgetMode: 'per-platform',
    budget: '',
    spent: '',
    status: 'active',
  });

  const allPlatforms = useMemo(() => Object.keys(AD_PLATFORM_LABEL) as AdPlatform[], []);

  const togglePlatform = (p: AdPlatform) => {
    setAdForm((s) => {
      const exists = s.platforms.includes(p);
      if (exists && s.platforms.length === 1) return s; // keep at least 1 selected
      const next = exists ? s.platforms.filter((x) => x !== p) : [...s.platforms, p];
      return { ...s, platforms: next };
    });
  };

  // Cash-runway guard: paid media is the first lever pulled when runway thins.
  const { months: runwayMonths } = computeCashRunway(finance, bankAccounts);
  const activeAds = ads.filter((a) => a.status === 'active');
  const activeDailyPace = activeAds.reduce((s, a) => s + campaignPacing(a).dailyRunRate, 0);
  // Pausing the weakest campaign frees its own monthly run rate (not a share of the budget).
  const worstPace = useMemo(() => {
    const sorted = [...activeAds].sort((a, b) => a.roas - b.roas);
    const w = sorted[0];
    return w ? campaignPacing(w) : { dailyRunRate: 0 };
  }, [activeAds]);

  const totalBudget = ads.reduce((s, a) => s + a.budget, 0);
  const totalSpent = ads.reduce((s, a) => s + a.spent, 0);
  const totalConv = ads.reduce((s, a) => s + a.conversions, 0);
  const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
  const convRate = totalClicks ? (totalConv / totalClicks) * 100 : 0;

  const submitCampaign = () => {
    if (!adForm.name.trim() || adForm.platforms.length === 0) return;
    if (adForm.status === 'active' && runwayMonths < 6) {
      setConfirmThinRunway(true);
      return;
    }
    saveCampaign(false);
  };

  const saveCampaign = (overrodeRunwayGuard: boolean) => {
    if (overrodeRunwayGuard) {
      log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'system', kind: 'system', message: `Campaign launched despite thin runway (${runwayMonths.toFixed(1)} mo) — flagged for finance review.` });
    }
    const draft = adForm.draft?.headline || adForm.draft?.body || adForm.draft?.link || adForm.draft?.imageText
      ? { headline: adForm.draft.headline.trim(), body: adForm.draft.body.trim(), link: adForm.draft.link.trim(), imageText: adForm.draft.imageText?.trim() }
      : undefined;

    const selected = adForm.platforms.length > 0 ? adForm.platforms : (['google'] as AdPlatform[]);
    const rawBudget = Number(adForm.budget) || 0;
    const rawSpent = Number(adForm.spent) || 0;
    const perPlatformBudget =
      adForm.budgetMode === 'split' && selected.length > 1
        ? Math.round((rawBudget / selected.length) * 100) / 100
        : rawBudget;
    const perPlatformSpent =
      adForm.budgetMode === 'split' && selected.length > 1
        ? Math.round((rawSpent / selected.length) * 100) / 100
        : rawSpent;

    const now = Date.now();
    selected.forEach((platform, idx) => {
      addCampaign({
        id: `ad-${now}-${idx}`,
        name: adForm.name.trim(),
        platform,
        budget: perPlatformBudget,
        spent: perPlatformSpent,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        roas: 0,
        status: adForm.status,
        draft,
      });
    });

    const platformLabels = selected.map((p) => AD_PLATFORM_LABEL[p]).join(', ');
    log({
      agentId: 'a-paidmedia',
      agentName: 'Paige',
      actor: 'user',
      kind: 'task',
      message: `Paid campaign launched: ${adForm.name.trim()} (${platformLabels}).`,
    });
    setAdForm({ name: '', platforms: ['google'], budgetMode: 'per-platform', budget: '', spent: '', status: 'active' });
    setAdOpen(false);
  };

  const byPlatform = (Object.keys(AD_PLATFORM_LABEL) as AdPlatform[])
    .map((p) => ({
      platform: AD_PLATFORM_LABEL[p],
      spend: ads.filter((a) => a.platform === p).reduce((s, a) => s + a.spent, 0),
      conversions: ads.filter((a) => a.platform === p).reduce((s, a) => s + a.conversions, 0),
    }))
    .filter((r) => r.spend > 0 || r.conversions > 0);

  // ── CSV import (any platform's export) ──────────────────────────────────────
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const csvPreview = useMemo(() => (csvText.trim() ? parseAdCsv(csvText) : null), [csvText]);
  const csvPlan = useMemo(
    () => (csvPreview ? dedupeAdRows(csvPreview.rows, ads.map((a) => ({ name: a.name, platform: a.platform }))) : null),
    [csvPreview, ads],
  );
  const importCsv = () => {
    if (!csvPlan) return;
    for (const r of csvPlan.toAdd) {
      addCampaign({
        id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: r.name,
        platform: r.platform as AdPlatform,
        budget: r.budget, spent: r.spent,
        impressions: r.impressions, clicks: r.clicks, conversions: r.conversions,
        roas: r.spent > 0 ? Math.round((r.revenue / r.spent) * 100) / 100 : 0,
        status: 'active', startDate: r.startDate || undefined, endDate: r.endDate || undefined,
      });
    }
    log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'user', kind: 'sync', message: `Imported ${csvPlan.toAdd.length} campaign(s) from CSV${csvPlan.duplicates.length ? `, skipped ${csvPlan.duplicates.length} duplicate(s)` : ''}.` });
    setCsvMsg(`Imported ${csvPlan.toAdd.length}. ${csvPlan.duplicates.length ? `Skipped ${csvPlan.duplicates.length} already here.` : ''}`);
    setCsvText('');
    setTimeout(() => { setCsvMsg(null); setCsvOpen(false); }, 1200);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Advertising" sub="Paid campaigns across search and social — spend, conversions and ROAS" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setCsvText(''); setCsvMsg(null); setCsvOpen(true); }}>
            Import CSV
          </Button>
          <Button onClick={() => setAdOpen(true)}>
            <Plus className="h-4 w-4" /> New campaign
          </Button>
        </div>
      </div>

      {/* Cash-runway pacing guard */}
      {Number.isFinite(runwayMonths) && runwayMonths < 12 && activeAds.length > 0 && (
        <Card className={cn('p-3', runwayMonths < 6 ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/30 bg-amber-500/5')}>
          <p className={cn('flex items-center gap-1.5 text-xs font-semibold', runwayMonths < 6 ? 'text-destructive' : 'text-amber-600')}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {runwayMonths < 6 ? 'Thin cash runway' : 'Runway watch'} — {runwayMonths.toFixed(1)} months at current burn
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Active campaigns pace at {fmtMoney(Math.round(activeDailyPace * 30), currency)}/mo ({fmtNum(Math.round(activeDailyPace))}/day).{' '}
            {runwayMonths < 6
              ? `Pausing the lowest-ROAS campaign frees ~${fmtNum(Math.round(worstPace.dailyRunRate * 30))}/mo toward runway.`
              : 'Monitor pacing weekly; throttle the weakest ROAS campaign first if burn accelerates.'}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><DollarSign className="h-3.5 w-3.5" /> Total budget</p>
          <p className="mt-1 text-xl font-semibold">{fmtMoney(totalBudget, currency)}</p>
        </Card>
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CircleDollarSign className="h-3.5 w-3.5" /> Spent</p>
          <p className="mt-1 text-xl font-semibold">{fmtMoney(totalSpent, currency)}</p>
        </Card>
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><MousePointerClick className="h-3.5 w-3.5" /> Clicks / Conv.</p>
          <p className="mt-1 text-xl font-semibold">{fmtNum(totalClicks)} <span className="text-sm text-muted-foreground">/ {totalConv}</span></p>
        </Card>
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> Conv. rate</p>
          <p className="mt-1 text-xl font-semibold">{convRate.toFixed(1)}%</p>
        </Card>
      </div>

      {/* Spend by platform */}
      {byPlatform.length > 0 && (
        <Card className="p-4">
          <SectionTitle title="Spend & conversions by platform" sub="Where the paid budget is working hardest" />
          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPlatform} margin={{ left: -12, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="platform" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="spend" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="conversions" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ads.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{a.name}</p>
                <p className="text-[11px] text-muted-foreground">{AD_PLATFORM_LABEL[a.platform]}</p>
                {a.status === 'active' && (() => {
                  const pace = campaignPacing(a);
                  return (
                    <span
                      className={cn(
                        'mt-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1',
                        pace.verdict === 'overspending'
                          ? 'bg-rose-500/10 text-rose-600 ring-rose-500/30'
                          : pace.verdict === 'underspending'
                            ? 'bg-sky-500/10 text-sky-600 ring-sky-500/30'
                            : 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
                      )}
                      title={`Spent ${Math.round(pace.spentPct)}% of budget with ${Math.round(pace.expectedPct)}% of the window elapsed — ${fmtNum(Math.round(pace.dailyRunRate))}/day run rate`}
                    >
                      {pace.verdict} · {Math.round(pace.spentPct)}% / {Math.round(pace.expectedPct)}%
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditCampaign(a)} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit campaign">
                  <Pencil className="h-3 w-3" />
                </button>
                <Select value={a.status} onValueChange={(v) => setCampaignStatus(a.id, v as AdCampaign['status'])}>
                  <SelectTrigger className={cn('h-6 w-24 px-1 text-[10px] font-medium', AD_STATUS_STYLE[a.status])}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="paused">paused</SelectItem>
                    <SelectItem value="ended">ended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/20 p-2">
                <p className="text-sm font-semibold">{fmtMoney(a.spent, currency)}</p>
                <p className="text-[10px] text-muted-foreground">of {fmtMoney(a.budget, currency)}</p>
              </div>

              <div className="rounded-lg bg-muted/20 p-2">
                <p className="text-sm font-semibold">{fmtNum(a.impressions)}</p>
                <p className="text-[10px] text-muted-foreground">impr.</p>
              </div>
              <div className="rounded-lg bg-muted/20 p-2">
                <p className="text-sm font-semibold">{a.conversions}</p>
                <p className="text-[10px] text-muted-foreground">conv.</p>
              </div>
            </div>
            {a.draft?.headline && (
              <div className="mt-2 rounded-lg border border-dashed bg-muted/10 p-2.5">
                <p className="text-[11px] font-semibold">{a.draft.headline}</p>
                {a.draft.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{a.draft.body}</p>}
                {a.draft.link && <p className="mt-1 truncate text-[10px] text-primary">{a.draft.link}</p>}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{a.clicks.toLocaleString()} clicks</span>
              <span className="font-medium text-primary">ROAS {a.roas}x</span>
            </div>
          </Card>
        ))}
        {ads.length === 0 && (
          <p className="text-sm text-muted-foreground">No campaigns yet — launch one to start tracking paid performance.</p>
        )}
      </div>

      {/* New paid campaign dialog */}
      <Dialog open={adOpen} onOpenChange={setAdOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Launch a paid campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Campaign name</label>
                <Input
                  value={adForm.name}
                  onChange={(e) => setAdForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Q4 Retargeting"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Initial status</label>
                <Select value={adForm.status} onValueChange={(v) => setAdForm((s) => ({ ...s, status: v as AdCampaign['status'] }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="ended">Ended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Multi-select Ad Platforms */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Ad platforms ({adForm.platforms.length} selected)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setAdForm((s) => ({
                      ...s,
                      platforms: s.platforms.length === allPlatforms.length ? ['google'] : [...allPlatforms],
                    }))
                  }
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  {adForm.platforms.length === allPlatforms.length ? 'Reset to Google' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {allPlatforms.map((p) => {
                  const active = adForm.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={cn(
                        'flex items-center justify-between gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-all',
                        active
                          ? 'border-primary bg-primary/10 text-foreground shadow-2xs ring-1 ring-primary/25'
                          : 'border-border/80 bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                      )}
                    >
                      <span className="truncate">{AD_PLATFORM_LABEL[p]}</span>
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded-xs border',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                        )}
                      >
                        {active && <Check className="h-2.5 w-2.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {adForm.platforms.length > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2 text-xs">
                <span className="text-[11px] font-medium text-muted-foreground">Budget allocation</span>
                <div className="inline-flex rounded-md border border-border/80 bg-background p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setAdForm((s) => ({ ...s, budgetMode: 'per-platform' }))}
                    className={cn(
                      'rounded px-2 py-0.5 font-medium transition',
                      adForm.budgetMode === 'per-platform' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    Per platform
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdForm((s) => ({ ...s, budgetMode: 'split' }))}
                    className={cn(
                      'rounded px-2 py-0.5 font-medium transition',
                      adForm.budgetMode === 'split' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                  >
                    Split total evenly
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {adForm.platforms.length > 1 && adForm.budgetMode === 'split'
                    ? `Total budget across ${adForm.platforms.length} (${currency})`
                    : `Budget per platform (${currency})`}
                </label>
                <Input
                  type="number"
                  value={adForm.budget}
                  onChange={(e) => setAdForm((s) => ({ ...s, budget: e.target.value }))}
                  placeholder="5000"
                  className="font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Spent so far ({currency})</label>
                <Input
                  type="number"
                  value={adForm.spent}
                  onChange={(e) => setAdForm((s) => ({ ...s, spent: e.target.value }))}
                  placeholder="0"
                  className="font-mono tabular-nums"
                />
              </div>
            </div>

            {adForm.platforms.length > 1 && Number(adForm.budget) > 0 && (
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {adForm.budgetMode === 'per-platform'
                  ? `${adForm.platforms.length} campaigns × ${fmtMoney(Number(adForm.budget), currency)} = ${fmtMoney(Number(adForm.budget) * adForm.platforms.length, currency)} total committed`
                  : `${fmtMoney(Number(adForm.budget), currency)} split across ${adForm.platforms.length} platforms = ${fmtMoney(Math.round((Number(adForm.budget) / adForm.platforms.length) * 100) / 100, currency)} each`}
              </p>
            )}

            <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/15 p-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ad creative draft</p>
                <p className="text-[11px] text-muted-foreground">Shared across the selected platform campaigns; customize anytime after launch.</p>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Headline</label>
                <Input
                  value={adForm.draft?.headline ?? ''}
                  onChange={(e) => setAdForm((s) => ({ ...s, draft: { ...s.draft, headline: e.target.value, body: s.draft?.body ?? '', link: s.draft?.link ?? '' } }))}
                  placeholder="Fast, reliable freight across Europe"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Body copy</label>
                <Textarea
                  rows={2}
                  value={adForm.draft?.body ?? ''}
                  onChange={(e) => setAdForm((s) => ({ ...s, draft: { ...s.draft, headline: s.draft?.headline ?? '', body: e.target.value, link: s.draft?.link ?? '' } }))}
                  placeholder="Door-to-door with fixed time windows. Request a freight quote today."
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Destination URL</label>
                  <Input
                    value={adForm.draft?.link ?? ''}
                    onChange={(e) => setAdForm((s) => ({ ...s, draft: { ...s.draft, headline: s.draft?.headline ?? '', body: s.draft?.body ?? '', link: e.target.value } }))}
                    placeholder="https://…/quote"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Image alt / visual note</label>
                  <Input
                    value={adForm.draft?.imageText ?? ''}
                    onChange={(e) => setAdForm((s) => ({ ...s, draft: { ...s.draft, headline: s.draft?.headline ?? '', body: s.draft?.body ?? '', link: s.draft?.link ?? '', imageText: e.target.value } }))}
                    placeholder="Fleet on the road"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
              <Button variant="ghost" size="sm" onClick={() => setAdOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" className="gap-1.5" onClick={submitCampaign} disabled={!adForm.name.trim() || adForm.platforms.length === 0}>
                <Megaphone className="h-4 w-4" />
                {adForm.platforms.length > 1 ? `Launch on ${adForm.platforms.length} platforms` : 'Launch campaign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CampaignEditDialog campaign={editCampaign} open={!!editCampaign} onOpenChange={(o) => { if (!o) setEditCampaign(null); }} />

      <ConfirmDialog
        open={confirmThinRunway}
        onOpenChange={setConfirmThinRunway}
        title="Thin cash runway — launch anyway?"
        description={`Cash runway is ${runwayMonths.toFixed(1)} months. Launching "${adForm.name.trim()}" adds to the ${fmtNum(Math.round(activeDailyPace * 30))}/mo active ad pace, and the override is flagged for finance review.`}
        confirmLabel="Launch anyway"
        onConfirm={() => { setConfirmThinRunway(false); saveCampaign(true); }}
      />

      {/* CSV import — any platform's export; duplicates by (name, platform) are skipped */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import campaigns from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Paste your ad platform&apos;s export (or type rows). Headers are matched tolerantly —
              <code className="mx-1 rounded bg-muted px-1 text-xs">name/campaign, platform/channel, budget, spend/cost, impressions, clicks, conversions, revenue, start, end</code>
              all work. Existing campaigns (same name + platform) are skipped, never overwritten.
            </p>
            <Textarea
              rows={7}
              className="font-mono text-xs"
              placeholder={'Campaign Name,Channel,Budget,Spend,Impressions,Clicks,Conversions,Revenue,Start,End\n"Spring Sale",LinkedIn,1000,812.50,12000,340,12,2400,2026-03-01,2026-03-31'}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            {csvPreview && (
              <p className="text-xs text-muted-foreground">
                Found {csvPreview.rows.length} row(s){csvPlan && csvPlan.duplicates.length ? `, ${csvPlan.duplicates.length} already here` : ''}.
                {csvPreview.skipped.length ? ` Skipped: ${csvPreview.skipped[0]}${csvPreview.skipped.length > 1 ? ` (+${csvPreview.skipped.length - 1} more)` : ''}` : ''}
              </p>
            )}
            {csvMsg && <p className="text-xs text-emerald-600">{csvMsg}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCsvOpen(false)}>Cancel</Button>
            <Button disabled={!csvPlan || csvPlan.toAdd.length === 0} onClick={importCsv}>
              Import {csvPlan?.toAdd.length ?? 0} campaign{csvPlan?.toAdd.length === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
