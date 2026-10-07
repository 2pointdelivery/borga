'use client';

import { useState } from 'react';
import { Phone, PhoneOutgoing, PhoneIncoming, PhoneMissed, ChevronDown, Plus, Clock, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { ELEVENLABS_VOICES, type CallRecord, type CallStatus } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<CallStatus, string> = {
  dialing: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  active: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  voicemail: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  completed: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  failed: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

function STATUS_ICON(s: CallStatus) {
  if (s === 'completed') return <PhoneIncoming className="h-3.5 w-3.5" />;
  if (s === 'failed') return <PhoneMissed className="h-3.5 w-3.5" />;
  return <PhoneOutgoing className="h-3.5 w-3.5" />;
}

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallsTab() {
  const { agents, calls, placeCall, deleteCall, leads, elevenlabs } = useBorga();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [agentId, setAgentId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [leadName, setLeadName] = useState('');
  const [note, setNote] = useState('');
  const [confirmDeleteCall, setConfirmDeleteCall] = useState<CallRecord | null>(null);
  const voice = ELEVENLABS_VOICES.find((v) => v.id === elevenlabs.voice) ?? ELEVENLABS_VOICES[0];

  const total = calls.length;
  const completed = calls.filter((c) => c.status === 'completed').length;
  const avgDur = total ? Math.round(calls.reduce((s, c) => s + c.durationSec, 0) / total) : 0;

  const selectLead = (id: string) => {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (lead) {
      setManualPhone(lead.phone);
      setLeadName(lead.name);
    } else if (/^[+()\-\s\d]{5,}$/.test(id)) {
      // Custom-typed entry that looks like a phone number flows straight into the dial field.
      setManualPhone(id);
      setLeadName((n) => (n || 'Client'));
    }
  };

  const dial = () => {
    if (!agentId) return;
    const a = agents.find((x) => x.id === agentId);
    const contact = manualPhone.trim();
    if (!contact) return; // button is disabled, but never dial a placeholder
    placeCall({
      agentId: a!.id,
      agentName: a!.name,
      contact,
      leadName: leadName.trim() || 'Client',
      note: note.trim() || undefined,
    });
    setOpen(false);
    setAgentId('');
    setLeadId('');
    setManualPhone('');
    setLeadName('');
    setNote('');
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Calls" sub="Outbound calls placed by agents via ElevenLabs" />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Place a call
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Total calls</p>
          <p className="mt-1 text-2xl font-semibold">{total}</p>
          <p className="text-[11px] text-muted-foreground">logged this cycle</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Connected</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">{completed}</p>
          <p className="text-[11px] text-muted-foreground">talked to a human</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Avg duration</p>
          <p className="mt-1 text-2xl font-semibold">{fmtDur(avgDur)}</p>
          <p className="text-[11px] text-muted-foreground">per call</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Active voice</p>
          <p className="mt-1 text-2xl font-semibold">{voice.label}</p>
          <p className="text-[11px] text-muted-foreground">{voice.tag}</p>
        </Card>
      </div>

      {/* Call history */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle title="Call log" sub="Full history with details" />
          <span className="text-[11px] text-muted-foreground">{elevenlabs.connected ? 'ElevenLabs connected' : 'ElevenLabs not connected'}</span>
        </div>
        <div className="space-y-2">
          {calls.length === 0 && <p className="text-sm text-muted-foreground">No calls placed yet.</p>}
          {calls.map((c) => {
            const agent = agents.find((a) => a.id === c.agentId) ?? agents.find((a) => a.name === c.agentName);
            const isOpen = expanded === c.id;
            return (
              <div key={c.id} className="rounded-xl border bg-muted/20">
                <button
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <AgentAvatar name={c.agentName} color={agent?.avatarColor ?? '#6366f1'} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.agentName} → {c.leadName} <span className="font-mono text-xs text-muted-foreground">({c.contact})</span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{c.note}</p>
                  </div>
                  {c.mode && (
                    <Badge
                      variant="outline"
                      className={cn('hidden text-[10px] sm:inline-flex', c.mode === 'real' ? 'border-emerald-500/30 text-emerald-600' : 'border-amber-500/30 text-amber-600')}
                      title={c.mode === 'real' ? 'A real Twilio call was dialed' : 'Played locally — no Twilio configured, or the number isn’t dialable'}
                    >
                      {c.mode === 'real' ? 'Real call' : 'Simulated'}
                    </Badge>
                  )}
                  <Badge className={cn('hidden gap-1 ring-1 sm:inline-flex', STATUS_STYLE[c.status])}>
                    {STATUS_ICON(c.status)} {c.status}
                  </Badge>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> {fmtDur(c.durationSec)}
                  </span>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="grid gap-3 border-t px-3 py-3 text-xs sm:grid-cols-2">
                    <div>
                      <p className="font-medium text-muted-foreground">Call details</p>
                      <p className="mt-1">Placed by <span className="font-medium">{c.agentName}</span></p>
                      <p>Dialed <span className="font-mono">{c.contact}</span></p>
                      <p>Voice <span className="font-medium">{ELEVENLABS_VOICES.find((v) => v.id === c.voice)?.label ?? c.voice}</span></p>
                      <p>When <span className="font-medium">{c.at}</span></p>
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Outcome</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge className={cn('gap-1 ring-1', STATUS_STYLE[c.status])}>{STATUS_ICON(c.status)} {c.status}</Badge>
                        <span>Duration <span className="font-medium">{fmtDur(c.durationSec)}</span></span>
                      </div>
                      {c.mode && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {c.mode === 'real'
                            ? `Real Twilio call${c.callSid ? ` — ${c.callSid}` : ''}`
                            : 'Simulated — audio played locally, no Twilio configured'}
                        </p>
                      )}
                      <p className="mt-2 rounded-lg border bg-card px-2.5 py-1.5 text-muted-foreground">{c.note}</p>
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-rose-500" onClick={() => setConfirmDeleteCall(c)}>
                          <Trash2 className="h-3 w-3" /> Delete log entry
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* New call dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Place an outbound call</DialogTitle>
            <DialogDescription>
              Choose the calling agent, then pick a lead/customer or enter a phone number. Calls dial out through ElevenLabs using the <span className="font-medium text-foreground">{voice.label}</span> voice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Calling agent</label>
              <SearchSelect
                options={agents.map((a) => ({ value: a.id, label: a.name, detail: a.department }))}
                value={agentId}
                onChange={setAgentId}
                placeholder="Select agent…"
                searchPlaceholder="Search agents"
                clearable={false}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Lead / customer (auto-fills number)</label>
              <SearchSelect
                options={[
                  { value: '', label: 'Custom / manual entry…' },
                  ...leads.filter((l) => l.stage !== 'lost').map((l) => ({ value: l.id, label: l.name, detail: l.company })),
                ]}
                value={leadId}
                onChange={selectLead}
                placeholder="Custom / manual entry…"
                searchPlaceholder="Search leads"
                clearable={false}
                allowCustom
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Phone number to dial</label>
              <Input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} placeholder="+1 555 0100" className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Contact name</label>
              <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="e.g. Marcus Webb" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Call note / objective</label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Follow up on the proposal" className="mt-1" />
            </div>
            {!elevenlabs.connected && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
                ElevenLabs isn&apos;t connected yet — connect it in Settings to place real outbound calls. The call is still logged below.
              </p>
            )}
            <Button className="w-full gap-1.5" onClick={dial} disabled={!agentId || !manualPhone.trim()} title={!manualPhone.trim() ? 'Enter a phone number to dial' : undefined}>
              <Phone className="h-4 w-4" /> Dial via ElevenLabs
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteCall}
        onOpenChange={(o) => { if (!o) setConfirmDeleteCall(null); }}
        title="Delete this call log entry?"
        description={confirmDeleteCall ? `The log of the call from ${confirmDeleteCall.agentName} to ${confirmDeleteCall.contact} is removed. Calls that already happened are unaffected.` : ''}
        confirmLabel="Delete entry"
        onConfirm={() => {
          if (!confirmDeleteCall) return;
          deleteCall(confirmDeleteCall.id);
          setConfirmDeleteCall(null);
        }}
      />
    </div>
  );
}

export type { CallRecord };
