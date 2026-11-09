'use client';

import { useState } from 'react';
import { Plus, DollarSign, Target, TrendingUp, GripVertical, Mail, Users, MessageSquare, Send, MessageCircle, LayoutGrid, LayoutList, Pencil, ReceiptText, Stethoscope, FileText, ArrowDownUp, UserCheck, Copy, Flame } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import { SearchSelect } from '../SearchSelect';
import { STAGE_COLOR, STAGE_LABEL, STAGE_PROBABILITY, LEAD_LOSS_REASONS, type LeadStage, type Priority, type Lead, PRIORITY_COLOR, COMMS_CHANNEL_LABEL, COMMS_CHANNEL_COLOR } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { WhatsAppPanel } from '../WhatsAppPanel';
import { LeadEditDialog, LeadDiagnosisInputs } from '../LeadEditDialog';
import { LeadRulesDialog } from '../LeadRulesDialog';
import { LeadDedupeDialog } from '../LeadDedupeDialog';
import { ExpleeSyncCard } from './ExpleeSyncCard';
import { scoreLead, compareLeadsByScore, type LeadScore } from '@/lib/borga/lead-score';
import { findLeadDuplicates } from '@/lib/borga/duplicates';
import { cn } from '@/lib/utils';

const COMMS_ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageCircle };

const STAGES: LeadStage[] = ['new', 'qualified', 'proposal', 'won', 'lost'];

/** A lead counts as diagnosed when at least one of the three questions was answered. */
const hasDiagnosis = (l: Lead) => !!(l.diagnosis?.problem || l.diagnosis?.since || l.diagnosis?.tried);

const SCORE_STYLE: Record<LeadScore['band'], string> = {
  hot: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  warm: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  cold: 'bg-muted text-muted-foreground',
};

function ScorePill({ score }: { score: LeadScore }) {
  return (
    <span
      title={`${score.score}/100 — ${score.factors.map((f) => `${f.key} +${f.points}: ${f.why}`).join(' ')}`}
      className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', SCORE_STYLE[score.band])}
    >
      {score.score}
    </span>
  );
}

export function SalesPipelineTab() {
  const { leads, moveLeadStage, addLead, agents, customers, messages, log, convertLeadToInvoice, quoteFromLead, invoices, activeWorkspace, whatsapp } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'list'>('list');
  const [outcomeTarget, setOutcomeTarget] = useState<{ lead: Lead; stage: 'won' | 'lost' } | null>(null);
  const [outcomeReason, setOutcomeReason] = useState('');
  const [outcomeNote, setOutcomeNote] = useState('');
  const [whatsOpen, setWhatsOpen] = useState(false);
  const [whatsLeadId, setWhatsLeadId] = useState<string | undefined>(undefined);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [sortByScore, setSortByScore] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);  const [form, setForm] = useState({ name: '', company: '', customerId: '' as string | undefined, email: '', phone: '', value: '', priority: 'P1' as Priority, source: 'Web — Form', ownerId: 'a-sales', diagnosis: undefined as Lead['diagnosis'] });

  const openWhatsAppForLead = (lead?: Lead) => {
    setWhatsLeadId(lead?.id);
    setWhatsOpen(true);
  };

  const openComms = (mode: 'single' | 'bulk', lead: Lead | null = null) => {
    // The inbox is the one home for communications now: a lead row opens its
    // thread; the bulk buttons land on the sales inbox to compose for many.
    const target = lead?.email?.trim() || lead?.phone?.trim() || '';
    window.dispatchEvent(new CustomEvent('borga:nav', {
      detail: { page: 'sales', tab: 'inbox', contactKey: target || undefined },
    }));
  };

  // Open pipeline only: closed deals (won or lost) are not pipeline.
  const pipelineValue = leads.filter((l) => l.stage !== 'lost' && l.stage !== 'won').reduce((s, l) => s + l.value, 0);
  const wonValue = leads.filter((l) => l.stage === 'won').reduce((s, l) => s + l.value, 0);
  // Weighted forecast: each open deal counted at its stage's win probability. An estimate, never booked revenue.
  const weightedPipeline = leads
    .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
    .reduce((s, l) => s + (l.value * STAGE_PROBABILITY[l.stage]) / 100, 0);

  const submit = () => {
    if (!form.name.trim()) return;
    addLead({
      id: `l-${Date.now()}`,
      name: form.name.trim(),
      company: form.company.trim(),
      customerId: form.customerId,
      email: form.email.trim(),
      phone: form.phone.trim(),
      value: Number(form.value) || 0,
      stage: 'new',
      source: form.source.trim() || 'Manual entry',
      ownerId: form.ownerId,
      priority: form.priority,
      diagnosis: form.diagnosis,
    });
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `New lead captured: ${form.name.trim()}.` });
    setForm({ name: '', company: '', customerId: undefined, email: '', phone: '', value: '', priority: 'P1', source: 'Web — Form', ownerId: 'a-sales', diagnosis: undefined });
    setOpen(false);
  };

  const onDrop = (stage: LeadStage) => {
    const lead = dragId ? leads.find((l) => l.id === dragId) : null;
    if (!lead) { setDragId(null); return; }
    // Closing a deal deserves an honest reason — ask before the stage flips,
    // so the loss report is real instead of guessed.
    if ((stage === 'won' || stage === 'lost') && lead.stage !== stage) {
      setOutcomeTarget({ lead, stage });
      setDragId(null);
      return;
    }
    moveLeadStage(dragId!, stage);
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'handoff', message: `Deal moved to ${STAGE_LABEL[stage]}.` });
    setDragId(null);
  };

  const summary = [
    { label: 'Pipeline value', value: money(pipelineValue), icon: DollarSign, color: 'text-primary' },
    { label: 'Weighted (est.)', value: money(weightedPipeline), icon: Target, color: 'text-sky-600', hint: 'Each open deal at its stage probability — an estimate, not booked revenue.' },
    { label: 'Open deals', value: String(leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length), icon: Target, color: 'text-sky-600' },
    { label: 'Closed (won)', value: money(wonValue), icon: TrendingUp, color: 'text-emerald-600' },
  ];

  // Scores are pure and cheap: one pass per render keeps every card and row honest.
  const scores = new Map(leads.map((l) => [l.id, scoreLead(l)] as const));
  const dupCount = findLeadDuplicates(leads).length;
  const listed = sortByScore ? [...leads].sort(compareLeadsByScore) : leads;

  const startQuote = (l: Lead) => {
    const q = quoteFromLead(l.id);
    if (q) window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: 'sales', tab: 'quotes' } }));
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Sales & leads pipeline" sub="Drag deals between stages — recorded in Borga. Hot leads arrive on their own from Explee; CRM data can be pulled from Company → Company Engine" />
        <div className="flex flex-wrap gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border/80 bg-muted/35 p-0.5">
            <button
              onClick={() => setView('list')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                view === 'list' ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutList className="h-3.5 w-3.5" /> List
            </button>
            <button
              onClick={() => setView('board')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                view === 'board' ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
          </div>
          <Button variant="outline" className="gap-1.5" onClick={() => openWhatsAppForLead()}>
            <MessageCircle className="h-4 w-4 text-emerald-600" />
            <span>WhatsApp</span>
            {whatsapp.connected && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title={`Connected: ${whatsapp.phone}`} />
            )}
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => openComms('bulk')} title="Pick recipients in the dialog — it needs at least one lead">
            <Mail className="h-4 w-4" /> Send message
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => openComms('bulk')}>
            <Users className="h-4 w-4" /> Bulk message
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => setRulesOpen(true)} title="Who owns a new lead — first matching rule wins">
            <UserCheck className="h-4 w-4" /> Assignment
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => setDedupeOpen(true)} title="Same relationship entered twice">
            <Copy className="h-4 w-4" /> Duplicates{dupCount > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-600">{dupCount}</span>}
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add lead
          </Button>
        </div>
      </div>

      <ExpleeSyncCard />

      {/* 1. Metrics strip first */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="flex flex-row items-center gap-3 p-3.5" title={'hint' in s ? s.hint : undefined}>
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15', s.color)}>
              <s.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-base font-semibold tabular-nums tracking-tight text-foreground">{s.value}</p>
              <p className="truncate text-[11px] font-medium text-muted-foreground">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {view === 'board' ? (
        <div className="grid gap-4 lg:grid-cols-5">
        {STAGES.map((stage) => {
          const list = leads.filter((l) => l.stage === stage);
          const value = list.reduce((s, l) => s + l.value, 0);
          return (
            <div
              key={stage}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(stage)}
              className={cn(
                'flex min-h-[240px] flex-col rounded-2xl border bg-muted/20 p-2.5 transition-colors',
                dragId && 'border-dashed border-primary bg-primary/5',
              )}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1', STAGE_COLOR[stage])}>
                  {STAGE_LABEL[stage]}
                </span>
                <Badge variant="secondary">{list.length} — {money(value)}</Badge>
              </div>
              <div className="flex flex-col gap-2">
                {list.map((l) => {
                  const owner = agents.find((a) => a.id === l.ownerId);
                  return (
                    <Card
                      key={l.id}
                      draggable
                      onDragStart={() => setDragId(l.id)}
                      onDragEnd={() => setDragId(null)}
                      className={cn('cursor-grab p-2.5 active:cursor-grabbing', dragId === l.id && 'opacity-50')}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1 truncate text-sm font-medium">
                            {l.name}
                            {hasDiagnosis(l) && (
                              <span title={`Diagnosed: ${l.diagnosis?.problem ?? '—'}${l.diagnosis?.since ? ` (since ${l.diagnosis.since})` : ''}${l.diagnosis?.tried ? ` — tried: ${l.diagnosis.tried}` : ''}`}>
                                <Stethoscope className="h-3 w-3 shrink-0 text-emerald-600" />
                              </span>
                            )}
                            {l.hotWhy && (
                              <span title={`Hot lead — their reply: “${l.hotWhy}”`}>
                                <Flame className="h-3 w-3 shrink-0 text-amber-500" />
                              </span>
                            )}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{l.company}</p>
                          <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary">{money(l.value)}</span>
                            <span className="flex items-center gap-1">
                              <ScorePill score={scores.get(l.id)!} />
                              <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', PRIORITY_COLOR[l.priority])}>
                                {l.priority}
                              </span>
                            </span>
                          </div>
                            <div className="mt-1.5 flex items-center justify-between">
                              <span className="flex items-center gap-1.5">
                                <AgentAvatar name={owner?.name ?? l.ownerId ?? '?'} color={owner?.avatarColor ?? '#6366f1'} size={16} />
                                {!owner && l.ownerId && <span className="text-[10px] text-muted-foreground">{l.ownerId}</span>}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground">{l.source}</span>
                                {/* Quote-to-cash: quote any open deal in one click (won deals convert to a draft invoice instead). */}
                                {l.stage !== 'won' && l.stage !== 'lost' && (
                                  <button
                                    onClick={() => startQuote(l)}
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-sky-500/10 hover:text-sky-600"
                                    title="Start a quote from this lead"
                                  >
                                    <FileText className="h-3 w-3" />
                                  </button>
                                )}
                                {/* Quote-to-cash: won deals convert to a draft invoice, board and list alike. */}
                                {l.stage === 'won' && !invoices.some((i) => i.externalRef === `lead-${l.id}` && !i.voidedAt) && (
                                  <button
                                    onClick={() => {
                                      const inv = convertLeadToInvoice(l.id);
                                      if (inv) log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'handoff', message: `Draft invoice ${inv.number} created from won deal ${l.name} — review it under Sales → Invoicing.` });
                                    }}
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
                                    title="Create draft invoice from this won deal"
                                  >
                                    <ReceiptText className="h-3 w-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => setEditLead(l)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  title={`Edit ${l.name}`}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => openWhatsAppForLead(l)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
                                  title={`WhatsApp ${l.name}`}
                                >
                                  <MessageCircle className="h-3 w-3" />
                                </button>
                                <button
                                  onClick={() => openComms('single', l)}
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  title={`Send message to ${l.name}`}
                                >
                                  <Send className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
                {list.length === 0 && (
                  <div className="flex h-20 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <p className="text-sm font-medium">{leads.length} leads</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setSortByScore((v) => !v)} className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-xs', sortByScore ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')} title="Hottest deals first">
                <ArrowDownUp className="h-3.5 w-3.5" /> Score
              </button>
              <span className="text-xs text-muted-foreground">Pipeline value {money(pipelineValue)} — closed {money(wonValue)}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Score</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listed.map((l) => {
                  const owner = agents.find((a) => a.id === l.ownerId);
                  return (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <p className="flex items-center gap-1 font-medium">
                          {l.name}
                          {hasDiagnosis(l) && (
                            <span title={`Diagnosed: ${l.diagnosis?.problem ?? '—'}${l.diagnosis?.since ? ` (since ${l.diagnosis.since})` : ''}${l.diagnosis?.tried ? ` — tried: ${l.diagnosis.tried}` : ''}`}>
                              <Stethoscope className="h-3 w-3 shrink-0 text-emerald-600" />
                            </span>
                          )}
                          {l.hotWhy && (
                            <span title={`Hot lead — their reply: “${l.hotWhy}”`}>
                              <Flame className="h-3 w-3 shrink-0 text-amber-500" />
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{l.company}{l.email ? ` — ${l.email}` : ''}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1', STAGE_COLOR[l.stage])}>{STAGE_LABEL[l.stage]}</span>
                        {(l.stage === 'won' || l.stage === 'lost') && l.outcomeNote && (
                          <span className="mt-0.5 block max-w-[160px] truncate text-[10px] text-muted-foreground" title={l.outcomeNote}>{l.outcomeNote}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-primary">{money(l.value)}</td>
                      <td className="px-4 py-2.5">
                        <ScorePill score={scores.get(l.id)!} />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded px-1 py-px text-[10px] font-semibold ring-1', PRIORITY_COLOR[l.priority])}>{l.priority}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-xs">{owner ? <AgentAvatar name={owner.name} color={owner.avatarColor} size={16} /> : null}{owner?.name ?? l.ownerId ?? '…'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.source}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openWhatsAppForLead(l)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600" title={`WhatsApp ${l.name}`}>
                            <MessageCircle className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => openComms('single', l)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Message">
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                          {l.stage !== 'won' && l.stage !== 'lost' && (
                            <button
                              onClick={() => startQuote(l)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sky-500/10 hover:text-sky-600"
                              title="Start a quote from this lead"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {/* Quote→cash: won deals convert to a draft invoice in one click. */}
                          {l.stage === 'won' && !invoices.some((i) => i.externalRef === `lead-${l.id}` && !i.voidedAt) && (
                            <button
                              onClick={() => {
                                const inv = convertLeadToInvoice(l.id);
                                if (inv) log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'handoff', message: `Draft invoice ${inv.number} created from won deal ${l.name} — review it under Sales → Invoicing.` });
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
                              title="Create draft invoice from this won deal"
                            >
                              <ReceiptText className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => setEditLead(l)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {listed.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-xs text-muted-foreground">No leads yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 3. Outbound communications third (after leads section) */}
      {messages.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle title="Outbound communications" sub="Email, SMS & WhatsApp — single and bulk" />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {messages.filter((m) => m.status === 'sent').length} sent · {messages.filter((m) => m.status === 'scheduled').length} scheduled
            </span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {messages.slice(0, 6).map((m) => {
              const Icon = COMMS_ICON[m.channel] ?? Mail;
              return (
                <div key={m.id} className="flex items-start gap-3 rounded-lg border border-border/80 bg-muted/15 p-3">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1', COMMS_CHANNEL_COLOR[m.channel])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold capitalize">{COMMS_CHANNEL_LABEL[m.channel]}</p>
                      {m.mode === 'bulk' && <Badge variant="secondary" className="text-[10px]">bulk — {m.count}</Badge>}
                      <span className={cn('ml-auto font-mono text-[10px] font-medium uppercase', m.status === 'sent' ? 'text-emerald-600' : m.status === 'scheduled' ? 'text-sky-600' : 'text-rose-600')}>{m.status}</span>
                    </div>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{m.to}</p>
                    {m.subject && <p className="mt-0.5 truncate text-xs font-medium">{m.subject}</p>}
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">{m.sentAt}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Capture a new lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">Full name</label>
              <Input placeholder="e.g. Ama Mensah" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Company</label>
                <SearchSelect
                  options={customers.map((c) => ({ value: c.id, label: c.name, detail: c.industry }))}
                  value={form.customerId ?? form.company}
                  onChange={(v, option) => {
                    const picked = customers.find((c) => c.id === v);
                    if (picked) setForm({ ...form, customerId: picked.id, company: picked.name });
                    else setForm({ ...form, customerId: undefined, company: option?.label ?? v });
                  }}
                  placeholder="Search or type company…"
                  searchPlaceholder="Search customers"
                  allowCustom
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Email</label>
                <Input type="email" placeholder="ama@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Phone (WhatsApp &amp; calls)</label>
                <Input placeholder="+1 (555) 234-5678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="font-mono text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Lead source</label>
                <Input placeholder="e.g. Web — Form" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Deal value ({currency})</label>
                <Input placeholder="0.00" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="font-mono tabular-nums" />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
                <SelectPriority value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Owner agent</label>
                <SearchSelect
                  options={agents.map((a) => ({ value: a.id, label: a.name, detail: a.department }))}
                  value={form.ownerId}
                  onChange={(v) => setForm({ ...form, ownerId: v || 'a-sales' })}
                  placeholder="Owner agent…"
                  searchPlaceholder="Search agents"
                  clearable={false}
                />
              </div>
            </div>
            <LeadDiagnosisInputs value={form.diagnosis} onChange={(d) => setForm({ ...form, diagnosis: d })} />
            <DraftDuplicates name={form.name} company={form.company} email={form.email} phone={form.phone} />
            <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submit} disabled={!form.name.trim()}>
                <Plus className="h-4 w-4" /> Add to pipeline
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Win / loss reason — asked before the stage flips so the report is honest */}
      <Dialog open={!!outcomeTarget} onOpenChange={(o) => { if (!o) setOutcomeTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{outcomeTarget?.stage === 'won' ? `Why did ${outcomeTarget?.lead.company || outcomeTarget?.lead.name} buy?` : `Why did ${outcomeTarget?.lead.company || outcomeTarget?.lead.name} not buy?`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{outcomeTarget?.stage === 'won' ? 'What won it (optional)' : 'Main reason'}</p>
              <select
                className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm shadow-xs outline-none focus-visible:border-ring"
                value={outcomeReason}
                onChange={(e) => setOutcomeReason(e.target.value)}
              >
                <option value="">Pick a reason…</option>
                {(outcomeTarget?.stage === 'won'
                  ? ['Price & value', 'Relationship', 'Speed / availability', 'Product fit', 'No competition']
                  : [...LEAD_LOSS_REASONS]
                ).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">One line for the record (optional)</p>
              <Input
                value={outcomeNote}
                onChange={(e) => setOutcomeNote(e.target.value)}
                placeholder={outcomeTarget?.stage === 'won' ? 'e.g. They needed delivery before Q4' : 'e.g. Competitor undercut us by 20%'}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Feeds the win/loss report — deals close honestly instead of vanishing into a column.
              {' '}You can skip the questions and just close it.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOutcomeTarget(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!outcomeTarget) return;
                const note = [outcomeReason, outcomeNote.trim()].filter(Boolean).join(' — ');
                moveLeadStage(outcomeTarget.lead.id, outcomeTarget.stage, note || undefined);
                log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'handoff', message: `${outcomeTarget.lead.company || outcomeTarget.lead.name} marked ${outcomeTarget.stage}${note ? ` (${note})` : ''}.` });
                setOutcomeReason(''); setOutcomeNote(''); setOutcomeTarget(null);
              }}
            >
              Mark {outcomeTarget?.stage === 'won' ? 'won' : 'lost'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <WhatsAppPanel open={whatsOpen} onOpenChange={setWhatsOpen} initialLeadId={whatsLeadId} />
      <LeadRulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />
      <LeadDedupeDialog open={dedupeOpen} onOpenChange={setDedupeOpen} />
      <LeadEditDialog open={!!editLead} onOpenChange={(o) => { if (!o) setEditLead(null); }} lead={editLead} />
    </div>
  );
}

/** Warns while capturing: this person or company may already be in the pipeline. */
function DraftDuplicates({ name, company, email, phone }: { name: string; company: string; email: string; phone: string }) {
  const leads = useBorga((s) => s.leads);
  if (!name.trim() && !email.trim() && !phone.trim() && !company.trim()) return null;
  const draft = { id: 'draft', name, company, email, phone, stage: 'new' };
  const hits = findLeadDuplicates([...leads, draft]).filter((p) => p.aId === 'draft' || p.bId === 'draft');
  if (!hits.length) return null;
  const other = (p: { aId: string; bId: string }) => leads.find((l) => l.id === (p.aId === 'draft' ? p.bId : p.aId));
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
      Possible {hits.length === 1 ? 'duplicate' : 'duplicates'}: {hits.map((p) => `${other(p)?.name ?? 'a lead'} (${p.reason})`).join('; ')}. You can still add it and merge later under Duplicates.
    </div>
  );
}

function SelectPriority({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="P0">P0 — Critical</SelectItem>
        <SelectItem value="P1">P1 — High</SelectItem>
        <SelectItem value="P2">P2 — Medium</SelectItem>
        <SelectItem value="P3">P3 — Low</SelectItem>
      </SelectContent>
    </Select>
  );
}
