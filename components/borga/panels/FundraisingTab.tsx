'use client';

import { useState } from 'react';
import { Globe, Search, Rocket, ExternalLink, CheckCircle2, Timer, Sparkles, Wand2, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { FUNDING_STAGE_COLOR, FUNDING_STAGE_LABEL, type FundingStage } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

const STAGES: FundingStage[] = ['identified', 'evaluating', 'applying', 'applied', 'won', 'rejected'];

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

export function FundraisingTab() {
  const { agents, fundraising, browses, browse, updateFundingStage, log, activeWorkspace } = useBorga();
  const ws = activeWorkspace();
  const wsName = ws?.legalName ?? ws?.name ?? 'your company';
  const [url, setUrl] = useState('');
  const nadia = agents.find((a) => a.id === 'a-fundraising');

  const applied = fundraising.filter((f) => f.stage === 'applied' || f.stage === 'won').length;
  const inFlight = fundraising.filter((f) => f.stage !== 'won' && f.stage !== 'rejected').length;
  const totalRequested = fundraising.filter((f) => f.stage !== 'rejected').reduce((s, f) => s + f.amount, 0);

  const runBrowse = () => {
    const target = url.trim() || 'https://eic.ec.europa.eu/programmes';
    browse(target, 'Nadia');
    log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'agent', kind: 'task', message: `Nadia browsed ${target} to scout funding calls.` });
    setUrl('');
  };

  const autoApply = (id: string) => {
    const f = fundraising.find((x) => x.id === id);
    if (!f) return;
    const next = f.matchScore >= 85 ? 'applied' : 'applying';
    updateFundingStage(id, next);
    log({
      agentId: 'a-fundraising', agentName: 'Nadia', actor: 'agent', kind: 'handoff',
      message: f.matchScore >= 85
        ? `Auto-applied to ${f.program} (${f.matchScore}% fit) on behalf of ${wsName}.`
        : `Started application for ${f.program} — ${f.matchScore}% fit below 85% auto-apply threshold.`,
    });
  };

  const summary = [
    { label: 'Live opportunities', value: String(fundraising.length), icon: Globe, color: 'text-sky-600' },
    { label: 'In flight', value: String(inFlight), icon: Timer, color: 'text-amber-600' },
    { label: 'Submitted', value: String(applied), icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Total sought', value: fmtMoney(totalRequested), icon: Sparkles, color: 'text-primary' },
  ];

  return (
    <div className="borga-fade-up space-y-5">
      <SectionTitle title="Fundraising agent" sub="Nadia scouts grant & accelerator programs, then auto-applies on high-fit opportunities" />

      {/* Nadia agent card + browser tool */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-1">
          <div className="flex items-center gap-3">
            {nadia ? <AgentAvatar name={nadia.name} color={nadia.avatarColor} size={44} /> : null}
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">{nadia?.name ?? 'Nadia'} <Badge className="bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30">active</Badge></p>
              <p className="text-[11px] text-muted-foreground">{nadia?.role}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{nadia?.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(nadia?.skills ?? []).map((s) => (
              <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Model</span>
            <span className="font-medium">{nadia?.model}</span>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Brain linked</span>
            <span className="font-medium">{nadia?.brainLinked ? 'Yes' : 'No'}</span>
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <SectionTitle title="Website browsing tool" sub="Ask Nadia to research a funding source — it loads, extracts and logs what it finds" />
          <div className="mt-3 flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runBrowse(); }}
              placeholder="https://eic.ec.europa.eu/programmes"
              className="h-9"
            />
            <Button className="h-9 gap-1.5" onClick={runBrowse}>
              <Search className="h-4 w-4" /> Browse
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {browses.slice(0, 4).map((b) => (
              <div key={b.id} className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Globe className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{b.title}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{b.at}</span>
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{b.url}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{b.summary}</p>
                </div>
              </div>
            ))}
            {browses.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No pages browsed yet — run a search above.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="flex items-center gap-3 p-3">
            <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10', s.color)}>
              <s.icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Opportunities grid */}
      <div>
        <SectionTitle title="Funding opportunities" sub="Scouted by Nadia — opportunities at or above 85% fit auto-apply" />
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fundraising.map((f) => (
            <Card key={f.id} className="flex flex-col p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.source}</span>
                <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1', FUNDING_STAGE_COLOR[f.stage])}>
                  {FUNDING_STAGE_LABEL[f.stage]}
                </span>
              </div>
              <p className="mt-1.5 text-sm font-semibold leading-snug">{f.program}</p>
              <p className="mt-2 text-lg font-bold text-primary">{fmtMoney(f.amount)}</p>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> Deadline {f.deadline}</p>
                <p className="flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5" /> Fit
                  <span className={cn('font-semibold', f.matchScore >= 85 ? 'text-emerald-600' : 'text-amber-600')}>{f.matchScore}%</span>
                  {f.matchScore >= 85 && f.stage !== 'applied' && f.stage !== 'won' && <Badge className="bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30">auto-apply</Badge>}
                </p>
              </div>

              <p className="mt-2.5 line-clamp-2 text-xs text-muted-foreground">{f.note}</p>

              <div className="mt-3 flex items-center gap-2 border-t pt-3">
                {f.stage !== 'rejected' && f.stage !== 'won' ? (
                  <Button size="sm" className="flex-1 gap-1.5" onClick={() => autoApply(f.id)}>
                    <Rocket className="h-3.5 w-3.5" /> {f.matchScore >= 85 ? 'Auto-apply' : 'Advance'}
                  </Button>
                ) : (
                  <span className="flex-1 text-center text-[11px] font-medium text-muted-foreground capitalize">{f.stage}</span>
                )}
                <a href={f.url} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Open source">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Stage legend */}
      <div className="flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <span key={s} className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1', FUNDING_STAGE_COLOR[s])}>
            <CheckCircle2 className="h-3 w-3" /> {FUNDING_STAGE_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
