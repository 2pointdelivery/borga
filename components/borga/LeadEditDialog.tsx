'use client';

import { useState } from 'react';
import { Save, Trash2, Building2, ArrowRight, Stethoscope, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchSelect } from './SearchSelect';
import { ConfirmDialog } from './ConfirmDialog';
import { useBorga } from '@/lib/borga/store';
import { STAGE_LABEL, type Lead, type LeadStage, type Priority, type Customer } from '@/lib/borga/data';
import { scoreLead } from '@/lib/borga/lead-score';
import { RecordTimeline } from './RecordTimeline';

/**
 * The three-question need diagnosis, shared by lead capture and lead editing.
 * Answers are optional — a lead without them simply shows none.
 */
export function LeadDiagnosisInputs({ value, onChange }: { value: Lead['diagnosis']; onChange: (d: Lead['diagnosis']) => void }) {
  const d = value ?? {};
  const set = (k: 'problem' | 'since' | 'tried') => (v: string) => {
    const next = { ...d, [k]: v || undefined };
    onChange(!next.problem && !next.since && !next.tried ? undefined : next);
  };
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium"><Stethoscope className="h-3.5 w-3.5 text-primary" /> Need diagnosis <span className="font-normal text-muted-foreground">— three questions that reveal what to sell</span></p>
      <div>
        <label className="text-xs font-medium text-muted-foreground">1. What is the single biggest problem you&apos;re facing right now?</label>
        <Textarea rows={2} value={d.problem ?? ''} onChange={(e) => set('problem')(e.target.value)} placeholder="In their own words" className="mt-1" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">2. How long has this issue existed?</label>
        <Input value={d.since ?? ''} onChange={(e) => set('since')(e.target.value)} placeholder="e.g. 6 months, since January" className="mt-1" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground">3. What have you already tried that has not worked?</label>
        <Textarea rows={2} value={d.tried ?? ''} onChange={(e) => set('tried')(e.target.value)} placeholder="Competitors, workarounds, nothing yet…" className="mt-1" />
      </div>
    </div>
  );
}

/**
 * The score, explained: what earns points and what would earn more. Updates live as the rep edits.
 */
function LeadScoreBlock({ lead }: { lead: Lead }) {
  const s = scoreLead(lead);
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs font-medium">Lead score <span className="font-bold">{s.score}/100</span> <span className="font-normal text-muted-foreground">({s.band})</span></p>
      <ul className="mt-1 space-y-0.5">
        {s.factors.map((f) => (
          <li key={f.key} className="text-[11px] text-muted-foreground">+{f.points}/{f.max} {f.key} — {f.why}</li>
        ))}
      </ul>
    </div>
  );
}

export function LeadEditDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {  const { updateLead, deleteLead, agents, customers, addCustomer, log } = useBorga();
  const [form, setForm] = useState<Lead | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmConvert, setConfirmConvert] = useState(false);
  const editing = form ?? lead;
  const linkedCustomer = customers.find((c) => c.id === editing?.customerId);

  const convertToCustomer = () => {
    if (!editing) return;
    const dg = editing.diagnosis;
    const diagnosisNotes = dg && (dg.problem || dg.since || dg.tried)
      ? ` Need: ${dg.problem ?? '—'}${dg.since ? ` (since ${dg.since})` : ''}${dg.tried ? ` Tried and failed: ${dg.tried}.` : ''}`
      : '';
    const c: Customer = {
      id: `cust-${Date.now()}`,
      name: editing.company.trim() || editing.name.trim(),
      industry: 'General',
      website: '',
      email: editing.email,
      phone: editing.phone,
      addressLine: '',
      city: '',
      country: '',
      status: 'prospect',
      owner: agents.find((a) => a.id === editing.ownerId)?.name ?? 'Unassigned',
      createdAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
      notes: `Converted from lead "${editing.name}".${diagnosisNotes}`,
    };
    addCustomer(c);
    updateLead(editing.id, { customerId: c.id });
    setForm((f) => ({ ...(f ?? editing), customerId: c.id }));
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'system', message: `Converted lead "${editing.name}" into customer account "${c.name}".`, ref: { kind: 'customer', id: c.id, label: c.name } });
    setConfirmConvert(false);
  };

  const save = () => {
    if (!editing || !editing.name.trim()) return;
    updateLead(editing.id, {
      name: editing.name.trim(),
      company: editing.company,
      email: editing.email,
      phone: editing.phone,
      value: editing.value,
      stage: editing.stage,
      source: editing.source,
      ownerId: editing.ownerId,
      priority: editing.priority,
      diagnosis: editing.diagnosis,
    });
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Updated lead ${editing.name.trim()}.` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!lead) return;
    setConfirmDelete(true);
  };

  const doRemove = () => {
    if (!lead) return;
    deleteLead(lead.id);
    log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'user', kind: 'task', message: `Removed lead ${lead.name}.` });
    setForm(null);
    setConfirmDelete(false);
    onOpenChange(false);
  };

  const patch = (p: Partial<Lead>) => setForm((f) => (lead ? { ...(f ?? lead), ...p } : f));

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-md" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit lead — {editing.name}</DialogTitle>
              <DialogDescription>Update the details and owner — changes sync to the CRM.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {linkedCustomer ? (
                <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-600">
                  <Building2 className="h-3.5 w-3.5" /> Linked to customer account &ldquo;{linkedCustomer.name}&rdquo;
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setConfirmConvert(true)}>
                  <ArrowRight className="h-3.5 w-3.5" /> Convert to customer account
                </Button>
              )}
              {editing.hotWhy && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Flame className="h-3.5 w-3.5 shrink-0 text-amber-500" /> Why this lead is hot
                    <span className="font-normal text-muted-foreground">— their reply, word for word</span>
                  </p>
                  <p className="mt-1 text-xs italic leading-relaxed">&ldquo;{editing.hotWhy}&rdquo;</p>
                  {editing.explee && (editing.explee.jobTitle || editing.explee.country || editing.explee.linkedinUrl || editing.explee.companyDomain) && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      {[editing.explee.jobTitle, editing.explee.country].filter(Boolean).join(' · ')}
                      {editing.explee.linkedinUrl && (
                        <>
                          {(editing.explee.jobTitle || editing.explee.country) && '·'}{' '}
                          <a href={editing.explee.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">LinkedIn profile</a>
                        </>
                      )}
                      {editing.explee.companyDomain && (
                        <>
                          {(editing.explee.jobTitle || editing.explee.country || editing.explee.linkedinUrl) && '·'}{' '}
                          <a href={`https://${editing.explee.companyDomain}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{editing.explee.companyDomain}</a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Full name" value={editing.name} onChange={(e) => patch({ name: e.target.value })} />
                <Input placeholder="Company" value={editing.company} onChange={(e) => patch({ company: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Email" value={editing.email} onChange={(e) => patch({ email: e.target.value })} />
                <Input placeholder="Phone" value={editing.phone} onChange={(e) => patch({ phone: e.target.value })} />
              </div>
              <Input placeholder="Deal value ($)" type="number" value={editing.value} onChange={(e) => patch({ value: Number(e.target.value) || 0 })} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Stage</label>
                  <Select value={editing.stage} onValueChange={(v) => patch({ stage: v as LeadStage })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STAGE_LABEL) as LeadStage[]).map((s) => (
                        <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Priority</label>
                  <Select value={editing.priority} onValueChange={(v) => patch({ priority: v as Priority })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="P0">P0 — Critical</SelectItem>
                      <SelectItem value="P1">P1 — High</SelectItem>
                      <SelectItem value="P2">P2 — Medium</SelectItem>
                      <SelectItem value="P3">P3 — Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Owner agent</label>
                <SearchSelect
                  options={agents.map((a) => ({ value: a.id, label: a.name, detail: a.department }))}
                  value={editing.ownerId}
                  onChange={(v) => patch({ ownerId: v || editing.ownerId })}
                  placeholder="Owner agent…"
                  searchPlaceholder="Search agents"
                  clearable={false}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Source</label>
                <Input className="mt-1" value={editing.source} onChange={(e) => patch({ source: e.target.value })} placeholder="Where this lead came from" />
              </div>
              <LeadDiagnosisInputs value={editing.diagnosis} onChange={(d) => patch({ diagnosis: d })} />
              <LeadScoreBlock lead={editing} />
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={remove} title="Delete lead">
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
                <Button className="flex-1 gap-1.5" onClick={save}>
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <RecordTimeline target={{ kind: 'lead', id: editing.id }} />
              </div>
            </div>
            </>
          )}
      </DialogContent>
    </Dialog>
      <ConfirmDialog
        open={confirmConvert && !!editing && !linkedCustomer}
        onOpenChange={setConfirmConvert}
        title="Convert to customer account?"
        description={editing ? `Creates a prospect account "${editing.company.trim() || editing.name.trim()}" (industry: General; address empty — fill it in under Sales → Customers). The lead stays linked to it.` : ''}
        confirmLabel="Convert"
        destructive={false}
        onConfirm={convertToCustomer}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete lead "${lead?.name ?? ''}"?`}
        description="The lead and its pipeline history are removed permanently."
        confirmLabel="Delete lead"
        onConfirm={doRemove}
      />
    </>
  );
}
