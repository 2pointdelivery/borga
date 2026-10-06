'use client';

import { useState } from 'react';
import { Plus, DollarSign, Target, TrendingUp, GripVertical, Mail, Users, MessageSquare, Send, MessageCircle, LayoutGrid, LayoutList, Pencil, ReceiptText, Stethoscope } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import { SearchSelect } from '../SearchSelect';
import { STAGE_COLOR, STAGE_LABEL, type LeadStage, type Priority, type Lead, PRIORITY_COLOR, COMMS_CHANNEL_LABEL, COMMS_CHANNEL_COLOR } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { CommsDialog } from '../CommsDialog';
import { WhatsAppPanel } from '../WhatsAppPanel';
import { LeadEditDialog, LeadDiagnosisInputs } from '../LeadEditDialog';
import { cn } from '@/lib/utils';

const COMMS_ICON: Record<string, typeof Mail> = { email: Mail, sms: MessageSquare, whatsapp: MessageCircle };

const STAGES: LeadStage[] = ['new', 'qualified', 'proposal', 'won', 'lost'];

/** A lead counts as diagnosed when at least one of the three questions was answered. */
const hasDiagnosis = (l: Lead) => !!(l.diagnosis?.problem || l.diagnosis?.since || l.diagnosis?.tried);

export function SalesPipelineTab() {
  const { leads, moveLeadStage, addLead, agents, messages, log, convertLeadToInvoice, invoices, activeWorkspace } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [commsOpen, setCommsOpen] = useState(false);
  const [commsMode, setCommsMode] = useState<'single' | 'bulk'>('single');
  const [commsLead, setCommsLead] = useState<Lead | null>(null);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [whatsOpen, setWhatsOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [form, setForm] = useState({ name: '', company: '', email: '', phone: '', value: '', priority: 'P1' as Priority, source: 'Web — Form', ownerId: 'a-sales', diagnosis: undefined as Lead['diagnosis'] });

  const openComms = (mode: 'single' | 'bulk', lead: Lead | null = null) => {
    setCommsMode(mode);
    setCommsLead(lead);
    setCommsOpen(true);
  };

  // Open pipeline only: closed deals (won or lost) are not pipeline.
  const pipelineValue = leads.filter((l) => l.stage !== 'lost' && l.stage !== 'won').reduce((s, l) => s + l.value, 0);
  const wonValue = leads.filter((l) => l.stage === 'won').reduce((s, l) => s + l.value, 0);

  const submit = () => {
    if (!form.name.trim()) return;
    addLead({
      id: `l-${Date.now()}`,
      name: form.name.trim(),
      company: form.company.trim(),
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
    setForm({ name: '', company: '', email: '', phone: '', value: '', priority: 'P1', source: 'Web — Form', ownerId: 'a-sales', diagnosis: undefined });
    setOpen(false);
  };

  const onDrop = (stage: LeadStage) => {
    if (dragId) {
      moveLeadStage(dragId, stage);
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'handoff', message: `Deal moved to ${STAGE_LABEL[stage]}.` });
    }
    setDragId(null);
  };

  const summary = [
    { label: 'Pipeline value', value: money(pipelineValue), icon: DollarSign, color: 'text-primary' },
    { label: 'Open deals', value: String(leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length), icon: Target, color: 'text-sky-600' },
    { label: 'Closed (won)', value: money(wonValue), icon: TrendingUp, color: 'text-emerald-600' },
  ];

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Sales & leads pipeline" sub="Drag deals between stages — recorded in Borga, pull your CRM data from Company → Company Engine" />
        <div className="flex flex-wrap gap-2">
          <div className="flex overflow-hidden rounded-lg border bg-muted/20">
            <button
              onClick={() => setView('board')}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors', view === 'board' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Board
            </button>
            <button
              onClick={() => setView('list')}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors', view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
            >
              <LayoutList className="h-3.5 w-3.5" /> List
            </button>
          </div>
          <Button variant="outline" className="gap-1.5" onClick={() => setWhatsOpen(true)}>
            <MessageCircle className="h-4 w-4 text-green-600" /> WhatsApp
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => openComms('bulk')} title="Pick recipients in the dialog — it needs at least one lead">
            <Mail className="h-4 w-4" /> Send message
          </Button>
          <Button variant="outline" className="gap-1.5" onClick={() => openComms('bulk')}>
            <Users className="h-4 w-4" /> Bulk message
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add lead
          </Button>
        </div>
      </div>

      {/* Recent communications */}
      {messages.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle title="Outbound communications" sub="Email, SMS & WhatsApp — single and bulk" />
            <span className="text-xs text-muted-foreground">{messages.filter((m) => m.status === 'sent').length} sent — {messages.filter((m) => m.status === 'scheduled').length} scheduled</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {messages.slice(0, 6).map((m) => {
              const Icon = COMMS_ICON[m.channel] ?? Mail;
              return (
                <div key={m.id} className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1', COMMS_CHANNEL_COLOR[m.channel])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium capitalize">{COMMS_CHANNEL_LABEL[m.channel]}</p>
                      {m.mode === 'bulk' && <Badge variant="secondary" className="text-[10px]">bulk — {m.count}</Badge>}
                      <span className={cn('ml-auto text-[11px]', m.status === 'sent' ? 'text-emerald-600' : m.status === 'scheduled' ? 'text-sky-600' : 'text-rose-600')}>{m.status}</span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{m.to}</p>
                    {m.subject && <p className="truncate text-xs font-medium">{m.subject}</p>}
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{m.sentAt}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
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
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">{l.company}</p>
                          <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary">{money(l.value)}</span>
                            <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', PRIORITY_COLOR[l.priority])}>
                              {l.priority}
                            </span>
                          </div>
                            <div className="mt-1.5 flex items-center justify-between">
                              {owner ? <AgentAvatar name={owner.name} color={owner.avatarColor} size={16} /> : null}
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground">{l.source}</span>
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
            <span className="text-xs text-muted-foreground">Pipeline value {money(pipelineValue)} — closed {money(wonValue)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
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
                        </p>
                        <p className="text-[11px] text-muted-foreground">{l.company}{l.email ? ` — ${l.email}` : ''}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1', STAGE_COLOR[l.stage])}>{STAGE_LABEL[l.stage]}</span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-primary">{money(l.value)}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded px-1 py-px text-[10px] font-semibold ring-1', PRIORITY_COLOR[l.priority])}>{l.priority}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-xs">{owner ? <AgentAvatar name={owner.name} color={owner.avatarColor} size={16} /> : null}{owner?.name ?? '…'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{l.source}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openComms('single', l)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Message">
                            <Mail className="h-3.5 w-3.5" />
                          </button>
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
                {leads.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No leads yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Capture a new lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <Input placeholder="Phone (used for outbound calls)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Source (e.g. Web — Form)" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              <SearchSelect
                options={agents.map((a) => ({ value: a.id, label: a.name, detail: a.department }))}
                value={form.ownerId}
                onChange={(v) => setForm({ ...form, ownerId: v || 'a-sales' })}
                placeholder="Owner agent…"
                searchPlaceholder="Search agents"
                clearable={false}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Deal value ($)" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
              <div>
                <SelectPriority value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
              </div>
            </div>
            <LeadDiagnosisInputs value={form.diagnosis} onChange={(d) => setForm({ ...form, diagnosis: d })} />
            <Button className="w-full" onClick={submit}>
              <Plus className="h-4 w-4" /> Add to pipeline
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CommsDialog open={commsOpen} onOpenChange={setCommsOpen} mode={commsMode} lead={commsLead} />
      <WhatsAppPanel open={whatsOpen} onOpenChange={setWhatsOpen} />
      <LeadEditDialog open={!!editLead} onOpenChange={(o) => { if (!o) setEditLead(null); }} lead={editLead} />
    </div>
  );
}

function SelectPriority({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
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
