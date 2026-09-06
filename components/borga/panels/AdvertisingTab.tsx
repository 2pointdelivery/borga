'use client';

import { useState } from 'react';
import {
  Plus,
  Pencil,
  DollarSign,
  CircleDollarSign,
  MousePointerClick,
  TrendingUp,
  Megaphone,
  AlertTriangle,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AD_PLATFORM_LABEL,
  AD_STATUS_STYLE,
  campaignPacing,
  fmtNum,
  type AdCampaign,
  type AdPlatform,
} from '@/lib/borga/data';
import { computeCashRunway } from '@/lib/borga/insights';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { CampaignEditDialog } from './SocialEditDialogs';
import { cn } from '@/lib/utils';

export function AdvertisingTab() {
  const { ads, addCampaign, setCampaignStatus, log, finance, bankAccounts } = useBorga();
  const [adOpen, setAdOpen] = useState(false);
  const [editCampaign, setEditCampaign] = useState<AdCampaign | null>(null);
  const [adForm, setAdForm] = useState({ name: '', platform: 'google' as AdPlatform, budget: '', spent: '', status: 'active' as AdCampaign['status'] });

  // Cash-runway guard: paid media is the first lever pulled when runway thins.
  const { cash, monthlyBurn, months: runwayMonths } = computeCashRunway(finance, bankAccounts);
  const activeAds = ads.filter((a) => a.status === 'active');
  const activeDailyPace = activeAds.reduce((s, a) => s + campaignPacing(a).dailyRunRate, 0);

  const totalBudget = ads.reduce((s, a) => s + a.budget, 0);
  const totalSpent = ads.reduce((s, a) => s + a.spent, 0);
  const totalConv = ads.reduce((s, a) => s + a.conversions, 0);
  const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
  const convRate = totalClicks ? (totalConv / totalClicks) * 100 : 0;

  const submitCampaign = () => {
    if (!adForm.name.trim()) return;
    if (adForm.status === 'active' && runwayMonths < 6) {
      const ok = window.confirm(`Cash runway is ${runwayMonths.toFixed(1)} months. Launching "${adForm.name.trim()}" adds to the ${fmtNum(Math.round(activeDailyPace * 30))}/mo active ad pace. Launch anyway?`);
      if (!ok) return;
      log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'system', kind: 'system', message: `Campaign launched despite thin runway (${runwayMonths.toFixed(1)} mo) — flagged for finance review.` });
    }
    addCampaign({
      id: `ad-${Date.now()}`,
      name: adForm.name.trim(),
      platform: adForm.platform,
      budget: Number(adForm.budget) || 0,
      spent: Number(adForm.spent) || 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      roas: 0,
      status: adForm.status,
    });
    log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'user', kind: 'task', message: `Paid campaign launched: ${adForm.name.trim()} (${AD_PLATFORM_LABEL[adForm.platform]}).` });
    setAdForm({ name: '', platform: 'google', budget: '', spent: '', status: 'active' });
    setAdOpen(false);
  };

  const byPlatform = (Object.keys(AD_PLATFORM_LABEL) as AdPlatform[])
    .map((p) => ({
      platform: AD_PLATFORM_LABEL[p],
      spend: ads.filter((a) => a.platform === p).reduce((s, a) => s + a.spent, 0),
      conversions: ads.filter((a) => a.platform === p).reduce((s, a) => s + a.conversions, 0),
    }))
    .filter((r) => r.spend > 0 || r.conversions > 0);

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Advertising" sub="Paid campaigns across search and social — spend, conversions and ROAS" />
        <Button onClick={() => setAdOpen(true)}>
          <Plus className="h-4 w-4" /> New campaign
        </Button>
      </div>

      {/* Cash-runway pacing guard */}
      {Number.isFinite(runwayMonths) && runwayMonths < 12 && activeAds.length > 0 && (
        <Card className={cn('p-3', runwayMonths < 6 ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/30 bg-amber-500/5')}>
          <p className={cn('flex items-center gap-1.5 text-xs font-semibold', runwayMonths < 6 ? 'text-destructive' : 'text-amber-600')}>
            <AlertTriangle className="h-3.5 w-3.5" />
            {runwayMonths < 6 ? 'Thin cash runway' : 'Runway watch'} — {runwayMonths.toFixed(1)} months at current burn
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Active campaigns pace at ${fmtNum(Math.round(activeDailyPace * 30))}/mo ({fmtNum(Math.round(activeDailyPace))}/day).{' '}
            {runwayMonths < 6
              ? `Pausing the lowest-ROAS campaign frees ~${fmtNum(Math.round(Math.min(...activeAds.map((a) => a.spent / Math.max(1, a.budget))) * totalBudget / 12))}/mo toward runway.`
              : 'Monitor pacing weekly; throttle the weakest ROAS campaign first if burn accelerates.'}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><DollarSign className="h-3.5 w-3.5" /> Total budget</p>
          <p className="mt-1 text-xl font-semibold">${fmtNum(totalBudget)}</p>
        </Card>        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CircleDollarSign className="h-3.5 w-3.5" /> Spent</p>
          <p className="mt-1 text-xl font-semibold">${fmtNum(totalSpent)}</p>
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
                <select
                  value={a.status}
                  onChange={(e) => setCampaignStatus(a.id, e.target.value as AdCampaign['status'])}
                  className={cn('h-6 rounded-md px-1 text-[10px] font-medium ring-1 outline-none', AD_STATUS_STYLE[a.status])}
                >
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="ended">ended</option>
                </select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-muted/20 p-2">
                <p className="text-sm font-semibold">${fmtNum(a.spent)}</p>
                <p className="text-[10px] text-muted-foreground">of ${fmtNum(a.budget)}</p>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Launch a paid campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Campaign name</label>
              <Input value={adForm.name} onChange={(e) => setAdForm((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Q4 Retargeting" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Platform</label>
                <Select value={adForm.platform} onValueChange={(v) => setAdForm((s) => ({ ...s, platform: v as AdPlatform }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(AD_PLATFORM_LABEL) as AdPlatform[]).map((p) => (
                      <SelectItem key={p} value={p}>{AD_PLATFORM_LABEL[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={adForm.status} onValueChange={(v) => setAdForm((s) => ({ ...s, status: v as AdCampaign['status'] }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="ended">Ended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Budget ($)</label>
                <Input type="number" value={adForm.budget} onChange={(e) => setAdForm((s) => ({ ...s, budget: e.target.value }))} placeholder="5000" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Spent so far ($)</label>
                <Input type="number" value={adForm.spent} onChange={(e) => setAdForm((s) => ({ ...s, spent: e.target.value }))} placeholder="0" className="mt-1" />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={submitCampaign}>
              <Megaphone className="h-4 w-4" /> Launch campaign
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CampaignEditDialog campaign={editCampaign} open={!!editCampaign} onOpenChange={(o) => { if (!o) setEditCampaign(null); }} />
    </div>
  );
}
