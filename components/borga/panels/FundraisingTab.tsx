'use client';

import { useState } from 'react';
import { Globe, Search, Rocket, ExternalLink, CheckCircle2, Timer, Sparkles, Wand2, Trash2, Pencil, FileText, ListChecks, ClipboardCheck, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import { FUNDING_AUTO_APPLY_FIT, FUNDING_STAGE_COLOR, FUNDING_STAGE_LABEL, type FundingStage, type FundingOpportunity } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const STAGES: FundingStage[] = ['identified', 'evaluating', 'applying', 'applied', 'won', 'rejected'];

export function FundraisingTab() {
  const { agents, fundraising, browses, browse, updateFunding, deleteFunding, log, activeWorkspace, activeWorkspaceId } = useBorga();
  const ws = activeWorkspace();
  const currency = ws?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);
  const wsName = ws?.legalName ?? ws?.name ?? 'your company';
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState<FundingOpportunity | null>(null);
  const [editForm, setEditForm] = useState({ program: '', amount: '', deadline: '', url: '', note: '' });
  const [confirmDelete, setConfirmDelete] = useState<FundingOpportunity | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineNote, setPipelineNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

  /** Server-backed pipeline call — syncs every returned opportunity into the store. */
  const callPipeline = async (action: string, id?: string) => {
    const r = await fetch('/api/borga/fundraising', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action, id, ws: activeWorkspaceId }),
    });
    const d = await r.json() as {
      ok?: boolean; error?: string;
      opportunity?: FundingOpportunity; opportunities?: FundingOpportunity[];
      result?: { error?: string; auto?: boolean; matchScore?: number; program?: string };
      report?: { analyzed: { ok: boolean }[]; autoApplied: string[]; needsReview: string[] };
    };
    if (d.opportunity) updateFunding(d.opportunity.id, d.opportunity);
    if (d.opportunities) d.opportunities.forEach((o) => updateFunding(o.id, o));
    return d;
  };

  const analyzeOne = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const d = await callPipeline('analyze', id);
      const f = fundraising.find((x) => x.id === id);
      log({
        agentId: 'a-fundraising', agentName: 'Nadia', actor: 'agent', kind: 'task',
        message: d.ok
          ? `Nadia analyzed ${f?.program ?? id}: requirements + expectations summarized, fit ${d.result && 'matchScore' in (d.result as object) ? (d.result as { matchScore?: number }).matchScore : '?'}%.`
          : `Nadia could not analyze ${f?.program ?? id}: ${d.error ?? d.result?.error ?? 'unknown error'}.`,
      });
      setExpanded((e) => ({ ...e, [id]: true }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  /** Full autonomous pass: browse every site, summarize, draft, auto-apply ≥ threshold. */
  const runPipeline = async () => {
    setPipelineBusy(true);
    setPipelineNote(null);
    try {
      const d = await callPipeline('pipeline');
      if (d.ok && d.report) {
        const done = d.report.analyzed.filter((a) => a.ok).length;
        setPipelineNote(
          `Pipeline: ${done}/${d.report.analyzed.length} sites analyzed, ${d.report.autoApplied.length} auto-applied` +
          (d.report.autoApplied.length ? ` (${d.report.autoApplied.slice(0, 3).join(', ')})` : '') +
          (d.report.needsReview.length ? `, ${d.report.needsReview.length} need review.` : ', nothing left to review.'),
        );
        log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'agent', kind: 'handoff', message: `Funding pipeline finished: ${done} analyzed, ${d.report.autoApplied.length} auto-applied.` });
      } else {
        setPipelineNote(d.error ?? 'Pipeline failed — try again.');
      }
    } finally {
      setPipelineBusy(false);
    }
  };

  const autoApply = async (id: string) => {
    const f = fundraising.find((x) => x.id === id);
    if (!f) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const d = await callPipeline('apply', id);
      if (d.ok && d.result) {
        log({
          agentId: 'a-fundraising', agentName: 'Nadia', actor: 'agent', kind: 'handoff',
          message: d.result.auto
            ? `Auto-applied to ${f.program} (${f.matchScore}% fit) on behalf of ${wsName}.`
            : `Application draft ready for ${f.program} — ${f.matchScore}% fit below ${FUNDING_AUTO_APPLY_FIT}% auto-apply threshold, awaiting review.`,
        });
        setExpanded((e) => ({ ...e, [id]: true }));
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const openEdit = (f: FundingOpportunity) => {
    setEditing(f);
    setEditForm({ program: f.program, amount: String(f.amount), deadline: f.deadline, url: f.url, note: f.note });
  };

  const saveEdit = () => {
    if (!editing || !editForm.program.trim()) return;
    updateFunding(editing.id, {
      program: editForm.program.trim(),
      amount: Math.max(0, Number(editForm.amount) || 0),
      deadline: editForm.deadline.trim(),
      url: editForm.url.trim(),
      note: editForm.note.trim(),
    });
    log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'user', kind: 'task', message: `Funding opportunity updated: ${editForm.program.trim()}.` });
    setEditing(null);
  };

  const summary = [
    { label: 'Live opportunities', value: String(fundraising.length), icon: Globe, color: 'text-sky-600' },
    { label: 'In flight', value: String(inFlight), icon: Timer, color: 'text-amber-600' },
    { label: 'Submitted', value: String(applied), icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Total sought', value: money(totalRequested), icon: Sparkles, color: 'text-primary' },
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

      {/* Autonomous pipeline */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Autonomous pipeline</p>
            <p className="text-[11px] text-muted-foreground">Browses every program site, summarizes requirements, drafts each application, auto-applies at {FUNDING_AUTO_APPLY_FIT}%+ fit.</p>
          </div>
        </div>
        <Button onClick={runPipeline} disabled={pipelineBusy || fundraising.length === 0} className="gap-1.5">
          <Rocket className="h-4 w-4" /> {pipelineBusy ? 'Running pipeline…' : 'Run full pipeline'}
        </Button>
      </Card>
      {pipelineNote && (
        <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">{pipelineNote}</p>
      )}

      {/* Opportunities grid */}
      <div>
        <SectionTitle title="Funding opportunities" sub={`Scouted by Nadia — opportunities at or above ${FUNDING_AUTO_APPLY_FIT}% fit auto-apply`} />
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
              <p className="mt-2 text-lg font-bold text-primary">{money(f.amount)}</p>

              <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> Deadline {f.deadline}</p>
                <p className="flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5" /> Fit
                  <span className={cn('font-semibold', f.matchScore >= 85 ? 'text-emerald-600' : 'text-amber-600')}>{f.matchScore}%</span>
                  {f.matchScore >= FUNDING_AUTO_APPLY_FIT && f.stage !== 'applied' && f.stage !== 'won' && <Badge className="bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30">auto-apply</Badge>}
                </p>
              </div>

              <p className="mt-2.5 line-clamp-2 text-xs text-muted-foreground">{f.note}</p>

              {f.analysisError && (
                <p className="mt-2 rounded-md bg-rose-500/5 px-2 py-1.5 text-[11px] text-rose-600">Analysis failed: {f.analysisError}</p>
              )}
              {f.lastAnalyzedAt && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">Analyzed {new Date(f.lastAnalyzedAt).toLocaleString()}</p>
              )}

              {/* Requirements / expectations / draft — browsed from the program site */}
              {(f.requirements || f.expectations || f.applicationDraft) && (
                <div className="mt-2.5 rounded-lg border bg-muted/20">
                  <button
                    onClick={() => setExpanded((e) => ({ ...e, [f.id]: !e[f.id] }))}
                    className="flex w-full items-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                  >
                    {expanded[f.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Site analysis{f.documentsNeeded?.length ? ` · ${f.documentsNeeded.length} docs` : ''}
                  </button>
                  {expanded[f.id] && (
                    <div className="space-y-2.5 px-2.5 pb-2.5 text-[11px] leading-snug">
                      {f.requirements && (
                        <div>
                          <p className="flex items-center gap-1 font-semibold"><ListChecks className="h-3 w-3 text-primary" /> Requirements</p>
                          <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{f.requirements}</p>
                        </div>
                      )}
                      {f.expectations && (
                        <div>
                          <p className="flex items-center gap-1 font-semibold"><ClipboardCheck className="h-3 w-3 text-primary" /> What they expect</p>
                          <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{f.expectations}</p>
                        </div>
                      )}
                      {!!f.documentsNeeded?.length && (
                        <div>
                          <p className="flex items-center gap-1 font-semibold"><FileText className="h-3 w-3 text-primary" /> Documents needed</p>
                          <ul className="mt-0.5 list-inside list-disc text-muted-foreground">
                            {f.documentsNeeded.map((d) => <li key={d}>{d}</li>)}
                          </ul>
                        </div>
                      )}
                      {f.applicationDraft && (
                        <div>
                          <p className="flex items-center gap-1 font-semibold"><FileText className="h-3 w-3 text-primary" /> Application draft</p>
                          <p className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-line rounded bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">{f.applicationDraft}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-2 border-t pt-3">
                {f.stage !== 'rejected' && f.stage !== 'won' ? (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5" title="Browse the program site and summarize requirements" onClick={() => analyzeOne(f.id)} disabled={!!busy[f.id]}>
                      <Search className="h-3.5 w-3.5" /> {f.requirements ? 'Re-analyze' : 'Analyze site'}
                    </Button>
                    <Button size="sm" className="flex-1 gap-1.5" onClick={() => autoApply(f.id)} disabled={!!busy[f.id]}>
                      <Rocket className="h-3.5 w-3.5" /> {f.matchScore >= FUNDING_AUTO_APPLY_FIT ? 'Auto-apply' : 'Advance'}
                    </Button>
                  </>
                ) : (
                  <span className="flex-1 text-center text-[11px] font-medium text-muted-foreground capitalize">{f.stage}</span>
                )}
                <button onClick={() => openEdit(f)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit opportunity">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <a href={f.url} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Open source">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button onClick={() => setConfirmDelete(f)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete opportunity">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit opportunity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Program</label>
              <Input value={editForm.program} onChange={(e) => setEditForm((s) => ({ ...s, program: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amount ({currency})</label>
                <Input type="number" min={0} value={editForm.amount} onChange={(e) => setEditForm((s) => ({ ...s, amount: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Deadline</label>
                <Input value={editForm.deadline} onChange={(e) => setEditForm((s) => ({ ...s, deadline: e.target.value }))} placeholder="e.g. Mar 15" className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source URL</label>
              <Input value={editForm.url} onChange={(e) => setEditForm((s) => ({ ...s, url: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Note</label>
              <Textarea rows={2} value={editForm.note} onChange={(e) => setEditForm((s) => ({ ...s, note: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={!editForm.program.trim()}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title={`Delete "${confirmDelete?.program ?? 'opportunity'}"?`}
        description="The funding opportunity is removed permanently — including wrong-fit and rejected entries."
        confirmLabel="Delete opportunity"
        onConfirm={() => {
          if (!confirmDelete) return;
          deleteFunding(confirmDelete.id);
          log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'user', kind: 'task', message: `Funding opportunity removed: ${confirmDelete.program}.` });
          setConfirmDelete(null);
        }}
      />

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
