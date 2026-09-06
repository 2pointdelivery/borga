'use client';

import { useState, useMemo } from 'react';
import { Plus, BrainCircuit, Zap, Pencil, Check, X, Settings2, Phone, Sparkles, GraduationCap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import type { Agent } from '@/lib/borga/data';
import { ELEVENLABS_VOICES } from '@/lib/borga/data';
import { deriveBusinessInsights, insightsToMemories, type InsightSeverity } from '@/lib/borga/insights';
import { AgentAvatar, StatusPill, SectionTitle } from '../bits';
import { AgentEditDialog } from './AgentEditDialog';
import { cn } from '@/lib/utils';

const PALETTE = ['#6366f1', '#22d3ee', '#f472b6', '#f59e0b', '#34d399', '#a78bfa', '#fb7185', '#38bdf8'];

export function AgentsTab() {
  const { agents, updateAgent, addAgent, addMemory, memories, log, activeAgentId, setActiveAgentId, placeCall, elevenlabs, leads,
    finance, invoices, bills, vendors, customers, goals, journals, bankTxns, bankAccounts, employees, activeWorkspace, llm } = useBorga();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [instructions, setInstructions] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [callAgent, setCallAgent] = useState<Agent | null>(null);
  const [callContact, setCallContact] = useState('');
  const [callLead, setCallLead] = useState('');
  const [callLeadId, setCallLeadId] = useState('');
  const voice = ELEVENLABS_VOICES.find((v) => v.id === elevenlabs.voice) ?? ELEVENLABS_VOICES[0];

  const selectCallLead = (id: string) => {
    setCallLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (lead) {
      setCallContact(lead.phone);
      setCallLead(lead.name);
    }
  };

  const placeCallNow = () => {
    if (!callAgent) return;
    placeCall({
      agentId: callAgent.id,
      agentName: callAgent.name,
      contact: callContact.trim() || '+1 555 0100',
      leadName: callLead.trim() || 'Client',
    });
    setCallAgent(null);
    setCallContact('');
    setCallLead('');
    setCallLeadId('');
  };

  const add = () => {
    if (!name.trim()) return;
    const a: Agent = {
      id: `a-${Date.now()}`,
      name: name.trim(),
      role: role.trim() || 'Specialist Agent',
      department: 'Custom',
      status: 'idle',
      avatarColor: PALETTE[agents.length % PALETTE.length],
      skills: ['Auto-assign'],
      model: llm.model,
      tasksCompleted: 0,
      accuracy: 90,
      brainLinked: true,
      description: 'Custom agent added by the user.',
      instructions: instructions.trim() || 'Follow the shared brain and cooperate with the rest of the fleet.',
    };
    addAgent(a);
    log({ agentId: a.id, agentName: a.name, actor: 'user', kind: 'system', message: `Agent ${a.name} provisioned and linked to the shared brain.` });
    setName('');
    setRole('');
    setInstructions('');
    setOpen(false);
  };

  const saveName = (id: string) => {
    const old = agents.find((a) => a.id === id);
    updateAgent(id, { name: editName.trim() || old!.name });
    log({ agentId: id, agentName: editName.trim() || old!.name, actor: 'user', kind: 'system', message: `Renamed agent ${old!.name} → ${editName.trim() || old!.name}.` });
    setEditingId(null);
  };

  const evolve = (a: Agent) => {
    updateAgent(a.id, { status: 'learning', accuracy: Math.min(100, a.accuracy + 1) });
    log({ agentId: a.id, agentName: a.name, actor: 'agent', kind: 'learn', message: `${a.name} fine-tuned from recent outcomes — accuracy improved.` });
  };

  const collaborate = (a: Agent) => {
    log({ agentId: a.id, agentName: a.name, actor: 'agent', kind: 'handoff', message: `${a.name} requested help from the shared brain and peers.` });
  };

  const totalTasks = agents.reduce((s, a) => s + a.tasksCompleted, 0);
  const avgAcc = Math.round(agents.reduce((s, a) => s + a.accuracy, 0) / agents.length);

  // Live business learning: derive insights from every module; one click makes
  // them durable agent memories (skills) the whole fleet reasons over.
  const insights = useMemo(
    () => deriveBusinessInsights({ finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees }),
    [finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees],
  );
  const SEV_STYLE: Record<InsightSeverity, string> = {
    critical: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
    watch: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
    info: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
    positive: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  };
  const trainAgents = () => {
    const wsName = activeWorkspace()?.name ?? 'the company';
    const fresh = insightsToMemories(insights, wsName).filter((m) => !memories.some((x) => x.content === m.content));
    if (!fresh.length) {
      log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'system', kind: 'learn', message: 'Fleet knowledge already up to date — no new insights to store.' });
      return;
    }
    fresh.forEach(addMemory);
    log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'system', kind: 'learn', message: `Trained ${agents.length} agents on ${fresh.length} new business insight${fresh.length === 1 ? '' : 's'} across finance, sales, ops and people.` });
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Agent fleet" sub={`${agents.length} agents — ${totalTasks} tasks completed — ${avgAcc}% avg accuracy`} />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add agent
        </Button>
      </div>

      {/* Business intelligence feed — what the fleet has learned from every module */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-500" /> Business intelligence — learned from all modules</p>
          <Button size="sm" variant="outline" onClick={trainAgents} disabled={insights.length === 0}>
            <GraduationCap className="h-3.5 w-3.5" /> Train fleet ({insights.length})
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {insights.slice(0, 6).map((i) => (
            <div key={i.id} className="rounded-lg border bg-muted/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">{i.title}</p>
                <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1', SEV_STYLE[i.severity])}>{i.severity}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{i.detail}</p>
              <p className="mt-1 text-[11px] font-medium text-primary">→ {i.action}</p>
            </div>
          ))}
          {insights.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No signals detected yet — insights appear as the modules accumulate activity.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <Card
            key={a.id}
            className={cn(
              'group relative cursor-pointer border p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg',
              activeAgentId === a.id && 'ring-2 ring-ring',
            )}
            onClick={() => setActiveAgentId(a.id)}
          >
            <div className="flex items-start gap-3">
              <AgentAvatar name={a.name} color={a.avatarColor} size={44} />
              <div className="min-w-0 flex-1">
                {editingId === a.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm" autoFocus />
                    <Button size="icon" className="h-7 w-7" onClick={() => saveName(a.id)}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-semibold">{a.name}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(a.id);
                        setEditName(a.name);
                      }}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <p className="truncate text-xs text-muted-foreground">{a.role}</p>
              </div>
              <StatusPill status={a.status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {a.emoji ? `${a.emoji} ` : ''}{a.type ?? a.department}
              </Badge>
              {a.department !== (a.type ?? a.department) && (
                <span className="text-[10px] text-muted-foreground">· {a.department}</span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.skills.map((s) => (
                <Badge key={s} variant="secondary" className="text-[11px]">
                  {s}
                </Badge>
              ))}
            </div>

            <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{a.description}</p>

            {a.instructions && (
              <p className="mt-2 line-clamp-2 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/70">Operating instructions:</span> {a.instructions}
              </p>
            )}

            {activeAgentId === a.id && a.vibe && (
              <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Selected — {a.type ?? a.department} agent</p>
                <p className="mt-1 text-xs italic leading-snug text-foreground/80">"{a.vibe}"</p>
                {a.persona && <p className="mt-1 truncate text-[10px] text-muted-foreground">persona: {a.persona}</p>}
              </div>
            )}

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tasks done</span>
                <span className="font-medium">{a.tasksCompleted}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Accuracy</span>
                <span className="font-medium text-emerald-600">{a.accuracy}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Model</span>
                <span className="max-w-[55%] truncate font-mono text-[10px]">{a.model}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                <BrainCircuit className="h-3.5 w-3.5" />
                Brain linked
                <Switch
                  checked={a.brainLinked}
                  onCheckedChange={(v) => updateAgent(a.id, { brainLinked: v })}
                  className="ml-1 scale-75"
                />
              </label>
              <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Place a call via ElevenLabs" onClick={() => setCallAgent(a)}>
                  <Phone className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit details" onClick={() => setEditAgent(a)}>
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Collaborate" onClick={() => collaborate(a)}>
                  <Zap className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Evolve & learn" onClick={() => evolve(a)}>
                  <BrainCircuit className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Provision a new agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Agent name (real name)</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rhea" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role / department</label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Customer Success" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Agent instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Prioritise inbound leads under 24h, hand off to Atlas for proposals, and log every outcome to the shared brain."
                className="mt-1 min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">These operating instructions are stored with the agent and fed to its model at runtime.</p>
            </div>
            <Button className="w-full" onClick={add}>
              <Plus className="h-4 w-4" /> Create agent
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AgentEditDialog agent={editAgent} open={!!editAgent} onOpenChange={(o) => { if (!o) setEditAgent(null); }} />

      <Dialog open={!!callAgent} onOpenChange={(o) => { if (!o) setCallAgent(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Place an outbound call</DialogTitle>
            <DialogDescription>
              {callAgent?.name} dials out through ElevenLabs using the <span className="font-medium text-foreground">{voice.label}</span> voice ({voice.tag}). Number shown: {elevenlabs.outboundNumber || 'not set'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lead / customer (auto-fills number)</label>
              <select
                value={callLeadId}
                onChange={(e) => selectCallLead(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Custom / manual entry—</option>
                {leads.filter((l) => l.stage !== 'lost').map((l) => (
                  <option key={l.id} value={l.id}>{l.name} — {l.company}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Phone number to dial</label>
              <Input value={callContact} onChange={(e) => setCallContact(e.target.value)} placeholder="+1 555 0100" className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lead / contact name</label>
              <Input value={callLead} onChange={(e) => setCallLead(e.target.value)} placeholder="e.g. Marcus Webb" className="mt-1" />
            </div>
            {!elevenlabs.connected && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
                ElevenLabs isn&apos;t connected yet — connect it in Settings to place real outbound calls. The call will still be simulated below.
              </p>
            )}
            <Button className="w-full gap-1.5" onClick={placeCallNow}>
              <Phone className="h-4 w-4" /> Call via ElevenLabs
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
