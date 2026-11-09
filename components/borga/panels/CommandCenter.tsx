'use client';

import { useEffect, useState } from 'react';
import {
  Target,
  Grip,
  ArrowRight,
  BrainCircuit,
  AlertTriangle,
  Plus,
  Wallet,
  BadgeCheck,
  Check,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Trash2,
  Users,
  Phone,
  BookOpen,
  HandCoins,
  BarChart3,
  ReceiptText,
  ChevronRight,
  Pencil,
  Save,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBorga, sortTasks } from '@/lib/borga/store';
import { agentStatusNow } from '@/lib/borga/agent-status';
import { useHealth } from '../use-health';
import { PRIORITY_LABEL, PRIORITY_COLOR, APPROVAL_LABEL, LLM_PROVIDERS, GOAL_KPI_PRESETS, type Goal, type GoalStatus } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { DateInput } from '../form-widgets';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { openConfigDeepLink } from '@/lib/borga/config-deeplink';
import { cn } from '@/lib/utils';
import { sendCompanyEmail } from '@/lib/borga/send-mail-client';

const GOAL_STATUS_STYLE: Record<string, string> = {
  'on-track': 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  'at-risk': 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  behind: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  done: 'bg-muted text-muted-foreground ring-border',
};

function fmtMoney(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n.toLocaleString()}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The face: one glanceable "needs you" strip. Pending approvals (with
 * inline approve/reject), held heartbeat notices (dismissible), heartbeat
 * status + kill switch, and today's model-cost tally from the audit trail.
 * Everything actionable without leaving this panel.
 */
function NeedsYouFace({
  pendingApprovals,
  notices,
  heartbeat,
  cost,
  onApprove,
  onReject,
  onDismissNotice,
  onToggleHeartbeat,
}: {
  pendingApprovals: { id: string; title: string; description: string }[];
  notices: { id: string; title: string; body: string }[];
  heartbeat: { paused: boolean | null; quiet: string };
  cost: { todayUsd: string; runs: number };
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDismissNotice: (id: string) => void;
  onToggleHeartbeat: () => void;
}) {
  const total = pendingApprovals.length + notices.length;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Needs you</span>
          <Badge variant="secondary">{total}</Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={cn('flex items-center gap-1.5', heartbeat.paused ? 'text-rose-600' : 'text-emerald-600')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', heartbeat.paused ? 'bg-rose-500' : 'animate-pulse bg-emerald-500')} />
            {heartbeat.paused === null ? 'Heartbeat …' : heartbeat.paused ? `Paused ${heartbeat.quiet}` : `Beating ${heartbeat.quiet}`}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onToggleHeartbeat}>
            {heartbeat.paused ? 'Resume' : 'Pause all'}
          </Button>
          <Badge variant="outline" className="font-mono text-[10px]" title="Estimated model spend from the run audit trail">
            ≈${cost.todayUsd} today · {cost.runs} runs
          </Badge>
        </div>
      </div>
      {total === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">All clear — nothing waiting on you. Borga is working quietly.</p>
      )}
      <div className="mt-3 space-y-2">
        {pendingApprovals.slice(0, 3).map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium">{a.title}</p>
            <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onApprove(a.id)}>Approve</Button>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onReject(a.id)}>Reject</Button>
          </div>
        ))}
        {notices.slice(0, 3).map((n) => (
          <div key={n.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{n.title}</p>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onDismissNotice(n.id)}>Dismiss</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

import { currentHolder } from '@/lib/borga/approval-chain';
import { toast } from '@/lib/toast-bus';
import type { Approval } from '@/lib/borga/data';

/** One pending approval: who holds it, when it is due, delegate / route it, then decide. */
function ApprovalCard({ approval: a, onApprove, onReject }: {
  approval: Approval;
  onApprove: () => void;
  onReject: () => void;
}) {
  const delegateApproval = useBorga((s) => s.delegateApproval);
  const updateApproval = useBorga((s) => s.updateApproval);
  const [delegating, setDelegating] = useState(false);
  const [to, setTo] = useState('');
  const [routing, setRouting] = useState(false);
  const [assignee, setAssignee] = useState(a.assignee ?? '');
  const [dueAt, setDueAt] = useState((a.dueAt ?? '').slice(0, 10));
  const [escalateTo, setEscalateTo] = useState(a.escalateTo ?? '');
  const holder = currentHolder(a);
  const [overdue, setOverdue] = useState(false);
  useEffect(() => {
    setOverdue(a.dueAt ? Date.parse(a.dueAt) < Date.now() : false);
  }, [a.dueAt]);

  const saveRouting = () => {
    updateApproval(a.id, {
      assignee: assignee.trim() || undefined,
      dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : undefined,
      escalateTo: escalateTo.trim() || undefined,
    });
    setRouting(false);
  };

  const send = () => {
    const err = delegateApproval(a.id, to);
    if (err) toast({ title: 'Could not delegate', description: err, variant: 'error' });
    else {
      toast({ title: `Delegated to ${to.trim()}`, variant: 'success' });
      setTo('');
      setDelegating(false);
    }
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', APPROVAL_LABEL[a.category] ? 'bg-primary/10 text-primary ring-primary/30' : '')}>
          {APPROVAL_LABEL[a.category]}
        </span>
        <span className="text-[11px] text-muted-foreground">{a.submittedBy} — {a.createdAt}</span>
      </div>
      <p className="mt-2 text-sm font-medium">{a.title}</p>
      {a.amount > 0 && <p className="text-xs font-semibold text-primary">{fmtMoney(a.amount)}</p>}
      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.description}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Waiting on <strong className="text-foreground">{holder ?? 'you'}</strong>
        {a.dueAt && <> · due {new Date(a.dueAt).toLocaleDateString()}{overdue && <span className="font-semibold text-rose-600"> (overdue)</span>}</>}
        {a.escalatedAt && <span className="font-semibold text-amber-600"> · escalated</span>}
        {(a.history?.length ?? 0) > 0 && <span title={a.history!.map((h) => `${h.action} by ${h.by}`).join(' → ')}> · {a.history!.length} hand{a.history!.length === 1 ? '' : 's'}</span>}
      </p>
      {!delegating && !routing && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" className="flex-1 gap-1" onClick={onApprove}>
            <Check className="h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={onReject}>
            <X className="h-3.5 w-3.5" /> Reject
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => setDelegating(true)} title="Hand to someone else">
            Delegate
          </Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => setRouting(true)} title="Assign, set a due date and escalation">
            Route
          </Button>
        </div>
      )}
      {delegating && (
        <div className="mt-2 flex gap-2">
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Hand to…" className="h-8 flex-1" />
          <Button size="sm" onClick={send} disabled={!to.trim()}>Hand over</Button>
          <Button size="sm" variant="ghost" onClick={() => setDelegating(false)}>Cancel</Button>
        </div>
      )}
      {routing && (
        <div className="mt-2 space-y-2 rounded-lg border p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Assign to</label>
              <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Name" className="mt-0.5 h-8" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Decide by</label>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-0.5 h-8" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Escalate to when overdue</label>
            <Input value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)} placeholder="Name" className="mt-0.5 h-8" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveRouting}>Save routing</Button>
            <Button size="sm" variant="ghost" onClick={() => setRouting(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CommandCenter() {  const {
    userName,
    tasks,
    agents,
    activity,
    goals,
    addGoal,
    updateGoal,
    deleteGoal,
    approvals,
    setApproval,
    recordApprovalResult,
    finance,
    connections,
    llm,
    llmCatalog,
    log,
    payBill,
    composio,
    activeWorkspaceId,
    notices,
    dismissNotice,
  } = useBorga();
  const [hbPaused, setHbPaused] = useState<boolean | null>(null);
  const [hbQuiet, setHbQuiet] = useState('22:00–07:00');

  useEffect(() => {
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'heartbeat', ws: activeWorkspaceId }),
    }).then((r) => r.json()).then((d: { paused?: boolean; quietHours?: { start: string; end: string } }) => {
      setHbPaused(d.paused ?? false);
      if (d.quietHours) setHbQuiet(`${d.quietHours.start}–${d.quietHours.end}`);
    }).catch(() => setHbPaused(false));
  }, [activeWorkspaceId]);

  const toggleHeartbeat = () => {
    const next = !(hbPaused ?? false);
    setHbPaused(next);
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'setHeartbeat', paused: next, ws: activeWorkspaceId }),
    }).catch(() => setHbPaused(!next));
  };

  // Today's cost tally from the Tier 6 run-audit trail (≈$ per entry).
  const cost = (() => {
    let sum = 0;
    let runs = 0;
    for (const e of activity) {
      const m = /≈\$(\d+\.\d+)/.exec(e.message);
      if (m) {
        sum += Number(m[1]);
        runs += 1;
      }
    }
    return { todayUsd: sum.toFixed(4), runs };
  })();
  const catalog = llmCatalog && llmCatalog.length ? llmCatalog : LLM_PROVIDERS;
  const [now, setNow] = useState<Date | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: '', objective: '', kpis: '', owner: '', due: '', status: 'on-track' as GoalStatus, progress: 0 });
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [confirmDeleteGoal, setConfirmDeleteGoal] = useState<Goal | null>(null);

  const resetGoalForm = () => {
    setGoalForm({ title: '', objective: '', kpis: '', owner: '', due: '', status: 'on-track', progress: 0 });
    setEditingGoal(null);
  };

  const openGoalDialog = (g?: Goal) => {
    if (g) {
      setEditingGoal(g);
      setGoalForm({ title: g.title, objective: g.objective, kpis: g.kpis, owner: g.owner, due: g.due, status: g.status, progress: g.progress });
    } else {
      resetGoalForm();
    }
    setGoalOpen(true);
  };
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set());

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Which LLM providers can actually be called (keys saved in Integrations, local CLI endpoints, ...).
  useEffect(() => {
    fetch('/api/borga/probe?ws=' + encodeURIComponent(activeWorkspaceId))
      .then((r) => r.json())
      .then((d: { providers?: { id: string; configured: boolean }[] }) => {
        const ids = new Set((d.providers ?? []).filter((p) => p.configured).map((p) => p.id));
        setConfiguredProviders(ids);
      })
      .catch(() => {/* probe is best-effort */});
  }, [activeWorkspaceId]);

  const done = tasks.filter((t) => t.status === 'done').length;
  const agentBusy = useBorga((s) => s.agentBusy);
  const health = useHealth();
  const activeAgents = agents.filter((a) => agentStatusNow(a, agentBusy) === 'active').length;
  const topTasks = sortTasks(tasks.filter((t) => t.status !== 'done')).slice(0, 4);

  // ---- Attention items ----
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  // Approved actions that have run: their execution receipt (ok/failed + why).
  const recentlyExecuted = approvals.filter((a) => a.status === 'approved' && a.lastResult).slice(0, 5);
  const atRiskGoals = goals.filter((g) => g.status === 'at-risk' || g.status === 'behind');
  const offConnections = connections.filter((c) => c.status === 'off' || c.status === 'error');
  const p0Tasks = sortTasks(tasks.filter((t) => t.status !== 'done' && t.priority === 'P0'));
  const attention = [
    ...p0Tasks.map((t) => ({ id: `at-${t.id}`, tone: 'danger' as const, icon: 'task', text: `P0 task needs you: ${t.title}` })),
    ...pendingApprovals.map((a) => ({ id: `ap-${a.id}`, tone: 'warn' as const, icon: 'approval', text: `Approval required: ${a.title}` })),
    ...atRiskGoals.map((g) => ({ id: `ag-${g.id}`, tone: 'warn' as const, icon: 'goal', text: `Goal ${g.title} is ${g.status}` })),
    ...offConnections.map((c) => ({ id: `cn-${c.id}`, tone: 'info' as const, icon: 'connect', text: `${c.label} is disconnected` })),
  ].slice(0, 6);

  // ---- Live KPI stats: every number computed from real store data, no fabricated trends ----
  const linkedAgents = agents.filter((a) => a.brainLinked).length;
  const revenueToDate = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const stats = [
    { label: 'Active agents', value: String(activeAgents), sub: `${agents.length} total` },
    { label: 'Tasks in motion', value: String(tasks.filter((t) => t.status !== 'done').length), sub: `${done} completed` },
    { label: 'Revenue to date', value: fmtMoney(revenueToDate), sub: 'posted revenue, voided excluded' },
    { label: 'Approvals awaiting', value: String(pendingApprovals.length), sub: `${linkedAgents} agents brain-linked` },
  ];

  // ---- Finance summary ----
  const revenue = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const expense = finance.filter((f) => f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const invoicesOut = finance.filter((f) => f.kind === 'invoice' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const net = revenue - expense;

  const submitGoal = () => {
    if (!goalForm.title.trim()) return;
    if (editingGoal) {
      updateGoal(editingGoal.id, {
        title: goalForm.title.trim(),
        objective: goalForm.objective.trim() || goalForm.title.trim(),
        kpis: goalForm.kpis.trim() || 'Custom KPI set',
        owner: goalForm.owner.trim() || 'Borga',
        due: goalForm.due.trim(),
        status: goalForm.status,
        progress: goalForm.progress,
      });
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Goal updated: ${goalForm.title.trim()}.` });
    } else {
      const g: Goal = {
        id: `g-${Date.now()}`,
        title: goalForm.title.trim(),
        objective: goalForm.objective.trim() || goalForm.title.trim(),
        kpis: goalForm.kpis.trim() || 'Custom KPI set',
        owner: goalForm.owner.trim() || 'Borga',
        due: goalForm.due.trim(),
        status: 'on-track',
        progress: 0,
      };
      addGoal(g);
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `New goal created: ${g.title}.` });
    }
    resetGoalForm();
    setGoalOpen(false);
  };

  /** Executes a held autonomous-mode action once its approval is granted (payment release or outbound send). */
  const executeApprovedAction = async (a: NonNullable<ReturnType<typeof approvals.find>>) => {
    // Collect the outcome of whichever held action runs, then write it back as
    // the approval's execution receipt so "approved but nothing happened" is
    // visible and retryable instead of silent.
    let outcome: { ok: boolean; detail: string } | null = null;
    if (a.pendingPayment?.kind === 'bill') {
      const { targetId, method, paidOnIso, externalRef } = a.pendingPayment;
      payBill(targetId, method, paidOnIso, externalRef);
      log({ agentId: 'a-finance', agentName: 'Sage', actor: 'agent', kind: 'task', message: `Approved payment released: ${a.title}.` });
      outcome = { ok: true, detail: `Payment released for bill ${targetId}.` };
    }
    if (a.pendingSend) {
      try {
        const d = await sendCompanyEmail({ ws: activeWorkspaceId, to: a.pendingSend.to, subject: a.pendingSend.subject, body: a.pendingSend.body });
        log({
          agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'sync',
          message: d.ok ? `Approved send delivered to ${a.pendingSend.to}: ${a.title}.` : `Approved send to ${a.pendingSend.to} failed to deliver — resend manually from the record.`,
        });
        outcome = { ok: !!d.ok, detail: d.ok ? `Message delivered to ${a.pendingSend.to}.` : `Delivery to ${a.pendingSend.to} failed.` };
      } catch {
        log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'system', kind: 'system', message: `Approved send to ${a.pendingSend.to} could not be delivered — resend manually from the record.` });
        outcome = { ok: false, detail: `Could not reach the mail server for ${a.pendingSend.to}.` };
      }
    }
    if (a.pendingComposio) {
      const { app, action, parameters, entityId } = a.pendingComposio;
      try {
        const res = await fetch('/api/borga/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'execute', appName: action, entityId, params: parameters }),
        });
        const d = (await res.json()) as { ok?: boolean };
        log({
          agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync',
          message: d.ok ? `Approved autonomous action executed: ${action} on ${app}.` : `Approved action "${action}" on ${app} failed to execute — retry manually.`,
        });
        outcome = { ok: !!d.ok, detail: d.ok ? `Action ${action} executed on ${app}.` : `Action "${action}" on ${app} failed.` };
      } catch {
        log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Approved action "${action}" on ${app} could not be executed — retry manually.` });
        outcome = { ok: false, detail: `Action "${action}" on ${app} could not be reached.` };
      }
    }
    // Tier 6: held MCP tool call runs exactly once on approval (per-action, never blanket).
    if (a.pendingMcp) {
      const { server, tool, params } = a.pendingMcp;
      try {
        const res = await fetch('/api/borga/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'call', ws: activeWorkspaceId, server, tool, params }),
        });
        const d = (await res.json()) as { ok?: boolean; error?: string };
        log({
          agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync',
          message: d.ok ? `Approved MCP tool executed: ${tool} on ${server}.` : `Approved MCP tool "${tool}" on ${server} failed: ${d.error ?? 'unknown error'} — retry manually.`,
        });
        outcome = { ok: !!d.ok, detail: d.ok ? `MCP tool ${tool} executed on ${server}.` : `MCP tool "${tool}" on ${server} failed: ${d.error ?? 'unknown error'}.` };
      } catch {
        log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Approved MCP tool "${tool}" on ${server} could not be executed — retry manually.` });
        outcome = { ok: false, detail: `MCP tool "${tool}" on ${server} could not be reached.` };
      }
    }
    // Tier 6: held workflow triggers on approval; rejecting ran nothing.
    // Approval actually dispatches: the server hands the workflow to the
    // company engine or this workspace's AI workers (run queue).
    if (a.pendingWorkflow) {
      const workflowName = a.pendingWorkflow.workflowName;
      try {
        const res = await fetch('/api/borga/orchestrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'run', workflowName, agent: 'Borga', ws: activeWorkspaceId }),
        });
        const d = (await res.json()) as { ok?: boolean; mode?: string; jobId?: string; agentName?: string; error?: string };
        if (d.ok && d.mode === 'queue') {
          log({
            agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync',
            message: `Approved workflow "${workflowName}" handed to ${d.agentName ?? 'an AI worker'} — live in Runs & Queue (job ${d.jobId}).`,
          });
          outcome = { ok: true, detail: `Handed to ${d.agentName ?? 'an AI worker'} — job ${d.jobId}.` };
        } else if (d.ok) {
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync', message: `Approved workflow "${workflowName}" executed on the company engine.` });
          outcome = { ok: true, detail: 'Executed on the company engine.' };
        } else {
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Approved workflow "${workflowName}" could not start: ${d.error ?? 'unknown error'}.` });
          outcome = { ok: false, detail: d.error ?? 'The workflow could not start.' };
        }
      } catch {
        log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Approved workflow "${workflowName}" could not be dispatched — retry from Workflows.` });
        outcome = { ok: false, detail: 'Could not reach the orchestrator.' };
      }
    }
    if (outcome) recordApprovalResult(a.id, outcome);
  };

  const actOnApproval = (id: string, status: 'approved' | 'rejected') => {
    const a = approvals.find((x) => x.id === id);
    setApproval(id, status);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Approval ${status === 'approved' ? 'approved' : 'rejected'}: ${a?.title ?? ''}.` });
    if (a && status === 'approved' && (a.pendingPayment || a.pendingSend || a.pendingComposio || a.pendingMcp || a.pendingWorkflow)) void executeApprovedAction(a);
  };

  return (
    <div className="borga-fade-up space-y-5">
      {/* Greeting hero */}
      <Card className="relative overflow-hidden border p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: 'var(--ring)' }} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              {now?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) ?? ''}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting()}, <span className="text-primary">{userName}</span> 👋
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Borga and the agent fleet are online. {attention.length} things need your attention right now.
            </p>
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: 'overview', tab: 'analytics' } }))}
            className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
            title="Open the health breakdown"
          >
            <span className={cn('flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold', health.band === 'strong' || health.band === 'healthy' ? 'bg-emerald-500/15 text-emerald-600' : health.band === 'attention' ? 'bg-amber-500/15 text-amber-600' : health.band === 'risk' ? 'bg-rose-500/15 text-rose-600' : 'bg-muted text-muted-foreground')}>
              {health.score ?? '—'}
            </span>
            <div>
              <p className="text-sm font-medium">Company health</p>
              <p className="text-xs text-muted-foreground">{health.score === null ? 'Not enough data yet' : `${health.label} · ${health.measured} areas`}</p>
            </div>
          </button>
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
            <BrainCircuit className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm font-medium">Shared brain</p>
              <p className="text-xs text-muted-foreground">All agents linked &amp; collaborating</p>
            </div>
          </div>
        </div>
      </Card>

      {/* The face — glanceable needs-you strip */}
      <NeedsYouFace
        pendingApprovals={pendingApprovals}
        notices={notices}
        heartbeat={{ paused: hbPaused, quiet: hbQuiet }}
        cost={cost}
        onApprove={(id) => actOnApproval(id, 'approved')}
        onReject={(id) => actOnApproval(id, 'rejected')}
        onDismissNotice={(id) => dismissNotice(id)}
        onToggleHeartbeat={toggleHeartbeat}
      />

      {/* KPI stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>
          </Card>
        ))}
      </div>

      {/* Quick access */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { detail: { page: 'ai', tab: 'agents' }, label: 'Agents', icon: Users },
          { detail: { page: 'communications', tab: 'inbox' }, label: 'Calls', icon: Phone },
          { detail: { page: 'company', tab: 'knowledge' }, label: 'Knowledge Base', icon: BookOpen },
          { detail: { page: 'company', tab: 'valuation' }, label: 'Valuation', icon: BarChart3 },
          { detail: { page: 'sales', tab: 'pipeline' }, label: 'Sales Pipeline', icon: HandCoins },
          { detail: { page: 'sales', tab: 'invoices' }, label: 'Invoicing', icon: ReceiptText },
        ].map((q) => {
          const Icon = q.icon;
          return (
            <button
              key={q.label}
              onClick={() => window.dispatchEvent(new CustomEvent('borga:nav', { detail: q.detail }))}
              className="group flex flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex w-full items-center justify-between text-sm font-medium">
                {q.label}
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </button>
          );
        })}
      </div>

      {/* LLM model selector */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-primary" />
            <SectionTitle title="AI model" sub="Which brain drives Borga's reasoning" />
          </div>
          <div className="flex items-center gap-2 text-xs">
            {configuredProviders.size > 0 ? (() => {
              const active = llm.providerId;
              const ok = configuredProviders.has(active);
              let label = ok ? 'API key configured' : 'No key — add in Integrations → AI & Voice';
              const color = ok ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-amber-500/10 text-amber-600 ring-amber-500/30';
              const dot = ok ? 'bg-emerald-500' : 'bg-amber-500';
              if (active === 'llm-muse' && ok) { label = 'Muse remote API configured'; }
              if (active === 'llm-muse' && !ok) { label = 'Muse not set up — add its remote base URL and key in Integrations → AI & Voice'; }
              return ok ? (
                <span className={`flex items-center gap-1.5 rounded-full px-2 py-1 font-medium ring-1 ${color}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => openConfigDeepLink('ai-providers')}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 transition hover:opacity-85 ${color}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {label} →
                </button>
              );
            })() : (
              <span className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground ring-1 ring-border">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                Checking
              </span>
            )}
            {llm.latency > 0 && <Badge variant="secondary">{llm.latency}ms</Badge>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{catalog.find((x) => x.id === llm.providerId)?.label ?? llm.providerId} <span className="text-muted-foreground">·</span> {catalog.find((x) => x.id === llm.providerId)?.models.find((m) => m.id === llm.model)?.label ?? llm.model}</p>
            <p className="text-[11px] text-muted-foreground">
              {configuredProviders.size > 0 && !configuredProviders.has(llm.providerId) ? 'This provider cannot be reached (no key, no local endpoint, or offline), so chat answers with an error until you fix it.' : llm.latency > 0 ? 'Last test replied in ' + llm.latency + ' ms.' : 'Not tested yet. Press Test on the provider card.'}
            </p>
          </div>
          <button
            onClick={() => openConfigDeepLink('ai-providers')}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Change in Integrations <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </Card>

      {/* Needs your attention */}
      {attention.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Needs your attention
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {attention.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 rounded-lg border bg-background/60 px-3 py-2 text-sm">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', a.tone === 'danger' ? 'bg-rose-500' : a.tone === 'warn' ? 'bg-amber-500' : 'bg-sky-500')} />
                <span className="truncate">{a.text}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Finance / Goals / Approvals */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle title="Finance" sub="Live totals to date" />
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ArrowUpRight className="h-3 w-3 text-emerald-500" /> Revenue
              </p>
              <p className="mt-1 text-lg font-semibold text-emerald-600">{fmtMoney(revenue)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ArrowDownRight className="h-3 w-3 text-rose-500" /> Expenses
              </p>
              <p className="mt-1 text-lg font-semibold text-rose-500">{fmtMoney(expense)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[11px] text-muted-foreground">Net</p>
              <p className="mt-1 text-lg font-semibold">{fmtMoney(net)}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[11px] text-muted-foreground">Invoices out</p>
              <p className="mt-1 text-lg font-semibold">{fmtMoney(invoicesOut)}</p>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            {finance.slice(0, 3).map((f) => (
              <div key={f.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-muted-foreground">{f.label}</span>
                <span className={cn('font-medium', (f.kind === 'revenue' || f.kind === 'invoice') ? 'text-emerald-600' : 'text-muted-foreground')}>
                  {f.kind === 'expense' ? '-' : '+'}
                  {fmtMoney(f.amount)}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle title="Goals" sub="Progress toward targets" />
            <Button size="sm" variant="outline" className="gap-1" onClick={() => openGoalDialog()}>
              <Plus className="h-3.5 w-3.5" /> New goal
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {goals.map((g) => (
              <div key={g.id} className="group">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', GOAL_STATUS_STYLE[g.status])}>
                      {g.status.replace('-', ' ')}
                    </span>
                    <span className="truncate">{g.title}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => openGoalDialog(g)} className="text-muted-foreground hover:text-primary" title={`Edit ${g.title}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setConfirmDeleteGoal(g)} className="text-muted-foreground hover:text-rose-500" title={`Delete ${g.title}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                <Progress value={g.progress} className="h-2" />
                <p className="mt-0.5 text-[11px] text-muted-foreground">{g.owner}{g.due ? ` — due ${g.due}` : ''}{g.kpis ? ` · ${g.kpis}` : ''}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle title="Approvals" sub={`${pendingApprovals.length} awaiting you`} />
            <BadgeCheck className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 space-y-3">
            {pendingApprovals.length === 0 && (
              <p className="text-sm text-muted-foreground">No approvals waiting. All clear ✅</p>
            )}
            {pendingApprovals.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                onApprove={() => actOnApproval(a.id, 'approved')}
                onReject={() => actOnApproval(a.id, 'rejected')}
              />
            ))}
            {recentlyExecuted.length > 0 && (
              <div className="mt-2 space-y-2 border-t pt-3">
                <p className="text-[11px] font-medium text-muted-foreground">Recently executed</p>
                {recentlyExecuted.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                    <span className={cn('mt-0.5 shrink-0 text-[11px] font-semibold', a.lastResult!.ok ? 'text-emerald-600' : 'text-rose-600')}>
                      {a.lastResult!.ok ? 'Executed' : 'Failed'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground">{a.lastResult!.detail}</p>
                    </div>
                    {!a.lastResult!.ok && (
                      <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void executeApprovedAction(a)}>
                        Retry
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Priorities + live updates */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle title="Top priorities" sub="Highest urgency tasks" />
            <Grip className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 space-y-3">
            {topTasks.map((t) => {
              const agent = agents.find((a) => a.name === t.assignee);
              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', PRIORITY_COLOR[t.priority])}>
                    {t.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">{PRIORITY_LABEL[t.priority]} — {t.bucket}</p>
                  </div>
                  {agent && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <AgentAvatar name={agent.name} color={agent.avatarColor} size={20} />
                      {agent.name}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <SectionTitle title="Live updates" sub="Latest from the fleet" />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4 space-y-3">
            {activity.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <div>
                  <p className="text-sm leading-snug">{e.message}</p>
                  <p className="text-[11px] text-muted-foreground">{e.agentName} — {e.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Goal dialog: create and edit share one form */}
      <Dialog open={goalOpen} onOpenChange={(o) => { setGoalOpen(o); if (!o) resetGoalForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGoal ? `Edit goal — ${editingGoal.title}` : 'Create a new goal'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Goal title</label>
              <Input value={goalForm.title} onChange={(e) => setGoalForm((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. 30% faster quote-to-close" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Objective / outcome</label>
              <Textarea rows={3} value={goalForm.objective} onChange={(e) => setGoalForm((s) => ({ ...s, objective: e.target.value }))} placeholder="What success looks like" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">KPI target</label>
              <Input value={goalForm.kpis} onChange={(e) => setGoalForm((s) => ({ ...s, kpis: e.target.value }))} placeholder="e.g. quote-to-close ≤ 12 days" className="mt-1" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {GOAL_KPI_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setGoalForm((s) => ({ ...s, kpis: p }))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                      goalForm.kpis === p ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary hover:text-primary',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Presets mirror the KPIs tab best-practice targets — or type your own.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Owner agent</label>
                <SearchSelect
                  options={agents.map((a) => ({ value: a.name, label: a.name, detail: a.department }))}
                  value={agents.some((a) => a.name === goalForm.owner) ? goalForm.owner : ''}
                  onChange={(v) => setGoalForm((s) => ({ ...s, owner: v }))}
                  placeholder="Owner agent…"
                  searchPlaceholder="Search agents"
                  clearable={false}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Due date</label>
                <DateInput value={goalForm.due} onChange={(v) => setGoalForm((s) => ({ ...s, due: v }))} className="mt-1" />
              </div>
            </div>
            {editingGoal && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={goalForm.status} onValueChange={(v) => setGoalForm((s) => ({ ...s, status: v as GoalStatus }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="on-track">On track</SelectItem>
                      <SelectItem value="at-risk">At risk</SelectItem>
                      <SelectItem value="behind">Behind</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Progress ({goalForm.progress}%)</label>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={goalForm.progress}
                    onChange={(e) => setGoalForm((s) => ({ ...s, progress: Number(e.target.value) }))}
                    className="mt-2 w-full"
                  />
                </div>
              </>
            )}
            <Button className="w-full" onClick={submitGoal} disabled={!goalForm.title.trim()}>
              {editingGoal ? <Save className="h-4 w-4" /> : <Target className="h-4 w-4" />} {editingGoal ? 'Save changes' : 'Create goal'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteGoal}
        onOpenChange={(o) => { if (!o) setConfirmDeleteGoal(null); }}
        title={`Delete goal "${confirmDeleteGoal?.title ?? ''}"?`}
        description="The goal and its recorded progress are removed permanently."
        confirmLabel="Delete goal"
        onConfirm={() => {
          if (!confirmDeleteGoal) return;
          deleteGoal(confirmDeleteGoal.id);
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Goal "${confirmDeleteGoal.title}" deleted.` });
          setConfirmDeleteGoal(null);
        }}
      />
    </div>
  );
}
