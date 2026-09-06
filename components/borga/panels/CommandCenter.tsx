'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
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
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBorga, sortTasks } from '@/lib/borga/store';
import { PRIORITY_LABEL, PRIORITY_COLOR, APPROVAL_LABEL, LLM_PROVIDERS, type Goal } from '@/lib/borga/data';
import { Sparkline, AgentAvatar, SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

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

export function CommandCenter() {
  const {
    userName,
    tasks,
    agents,
    activity,
    goals,
    addGoal,
    deleteGoal,
    approvals,
    setApproval,
    finance,
    connections,
    llm,
    setLlm,
    llmCatalog,
    log,
    updateAgent,
    payBill,
    composio,
    activeWorkspace,
  } = useBorga();
  // Helper to set LLM and sync to all agents automatically
  const setLlmAndSyncToAgents = (patch: Partial<{ providerId: string; model: string; online: boolean; latency: number }>) => {
    const newLlm = { ...llm, ...patch };
    setLlm(newLlm);
    // Sync to all agents that don't have a custom model override
    agents.forEach((agent) => {
      // If agent.model is empty or matches the old llm.model, update it
      if (!agent.model || agent.model === llm.model) {
        updateAgent(agent.id, { model: newLlm.model });
      }
    });
  };
  const catalog = llmCatalog && llmCatalog.length ? llmCatalog : LLM_PROVIDERS;
  const [now, setNow] = useState<Date | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: '', objective: '', owner: '', due: '' });
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set());

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Probe which LLM providers have server-side API keys.
  useEffect(() => {
    fetch('/api/borga/probe')
      .then((r) => r.json())
      .then((d: { providers?: { id: string; configured: boolean }[] }) => {
        const ids = new Set((d.providers ?? []).filter((p) => p.configured).map((p) => p.id));
        setConfiguredProviders(ids);
        // Auto-select the first configured provider if the current one is unconfigured.
        if (ids.size > 0 && !ids.has(llm.providerId)) {
          const first = [...ids][0];
          const p = catalog.find((x) => x.id === first);
          if (p) setLlmAndSyncToAgents({ providerId: p.id, model: p.models[0].id, online: true, latency: 120 });
        }
      })
      .catch(() => {/* probe is best-effort */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = tasks.filter((t) => t.status === 'done').length;
  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const topTasks = sortTasks(tasks.filter((t) => t.status !== 'done')).slice(0, 4);

  const stats = [
    { label: 'Active agents', value: String(activeAgents), sub: `${agents.length} total`, trend: +0, spark: [2, 3, 2, 4, 3, 4, 5] },
    { label: 'Tasks in motion', value: String(tasks.filter((t) => t.status !== 'done').length), sub: `${done} completed`, trend: +12, spark: [3, 4, 3, 5, 6, 5, 7] },
    { label: 'Revenue (Sep MTD)', value: fmtMoney(finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0)), sub: 'new + expansion', trend: +4.6, spark: [2, 3, 3, 4, 5, 5, 6] },
    { label: 'Brain sync', value: '100%', sub: 'agents linked', trend: +0, spark: [5, 5, 5, 5, 5, 5, 5] },
  ];

  // ---- Attention items ----
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const atRiskGoals = goals.filter((g) => g.status === 'at-risk' || g.status === 'behind');
  const offConnections = connections.filter((c) => c.status === 'off' || c.status === 'error');
  const p0Tasks = sortTasks(tasks.filter((t) => t.status !== 'done' && t.priority === 'P0'));
  const attention = [
    ...p0Tasks.map((t) => ({ id: `at-${t.id}`, tone: 'danger' as const, icon: 'task', text: `P0 task needs you: ${t.title}` })),
    ...pendingApprovals.map((a) => ({ id: `ap-${a.id}`, tone: 'warn' as const, icon: 'approval', text: `Approval required: ${a.title}` })),
    ...atRiskGoals.map((g) => ({ id: `ag-${g.id}`, tone: 'warn' as const, icon: 'goal', text: `Goal ${g.title} is ${g.status}` })),
    ...offConnections.map((c) => ({ id: `cn-${c.id}`, tone: 'info' as const, icon: 'connect', text: `${c.label} is disconnected` })),
  ].slice(0, 6);

  // ---- Finance summary ----
  const revenue = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const expense = finance.filter((f) => f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const invoicesOut = finance.filter((f) => f.kind === 'invoice' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const net = revenue - expense;

  const submitGoal = () => {
    if (!goalForm.title.trim()) return;
    const g: Goal = {
      id: `g-${Date.now()}`,
      title: goalForm.title.trim(),
      objective: goalForm.objective.trim() || goalForm.title.trim(),
      kpis: 'Custom KPI set',
      owner: goalForm.owner.trim() || 'Borga',
      due: goalForm.due.trim() || '…',
      status: 'on-track',
      progress: 0,
    };
    addGoal(g);
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'system', message: `New goal created: ${g.title}.` });
    setGoalForm({ title: '', objective: '', owner: '', due: '' });
    setGoalOpen(false);
  };

  /** Executes a held autonomous-mode action once its approval is granted (payment release or outbound send). */
  const executeApprovedAction = async (a: NonNullable<ReturnType<typeof approvals.find>>) => {
    if (a.pendingPayment?.kind === 'bill') {
      const { targetId, method, paidOnIso, externalRef } = a.pendingPayment;
      payBill(targetId, method, paidOnIso, externalRef);
      log({ agentId: 'a-finance', agentName: 'Sage', actor: 'agent', kind: 'task', message: `Approved payment released: ${a.title}.` });
    }
    if (a.pendingSend) {
      try {
        const res = await fetch('/api/borga/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({
            action: 'execute',
            appName: 'GMAIL_SEND_EMAIL',
            entityId: 'workspace-inbox',
            apiKey: composio.apiKey,
            params: { recipient_email: a.pendingSend.to, subject: a.pendingSend.subject, body: a.pendingSend.body },
          }),
        });
        const d = (await res.json()) as { ok?: boolean };
        log({
          agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'sync',
          message: d.ok ? `Approved send delivered to ${a.pendingSend.to}: ${a.title}.` : `Approved send to ${a.pendingSend.to} failed to deliver — resend manually from the record.`,
        });
      } catch {
        log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'system', kind: 'system', message: `Approved send to ${a.pendingSend.to} could not be delivered — resend manually from the record.` });
      }
    }
    if (a.pendingComposio) {
      const { app, action, parameters, entityId } = a.pendingComposio;
      try {
        const res = await fetch('/api/borga/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'execute', appName: action, entityId, apiKey: composio.apiKey, params: parameters }),
        });
        const d = (await res.json()) as { ok?: boolean };
        log({
          agentId: 'a1', agentName: 'Borga', actor: 'agent', kind: 'sync',
          message: d.ok ? `Approved autonomous action executed: ${action} on ${app}.` : `Approved action "${action}" on ${app} failed to execute — retry manually.`,
        });
      } catch {
        log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Approved action "${action}" on ${app} could not be executed — retry manually.` });
      }
    }
  };

  const actOnApproval = (id: string, status: 'approved' | 'rejected') => {
    const a = approvals.find((x) => x.id === id);
    setApproval(id, status);
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'system', message: `Approval ${status === 'approved' ? 'approved' : 'rejected'}: ${a?.title ?? ''}.` });
    if (a && status === 'approved' && (a.pendingPayment || a.pendingSend || a.pendingComposio)) void executeApprovedAction(a);
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
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-3">
            <BrainCircuit className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm font-medium">Shared brain</p>
              <p className="text-xs text-muted-foreground">All agents linked &amp; collaborating</p>
            </div>
          </div>
        </div>
      </Card>

      {/* KPI stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              {s.trend > 0 && (
                <Badge className="gap-1 bg-emerald-500/10 text-emerald-600">
                  <TrendingUp className="h-3 w-3" /> +{s.trend}%
                </Badge>
              )}
              {s.trend < 0 && (
                <Badge className="gap-1 bg-rose-500/10 text-rose-600">
                  <TrendingDown className="h-3 w-3" /> {s.trend}%
                </Badge>
              )}
            </div>
            <p className="mt-2 text-2xl font-semibold">{s.value}</p>
            <div className="mt-1 flex items-end justify-between">
              <p className="text-xs text-muted-foreground">{s.sub}</p>
              <Sparkline points={s.spark} stroke="var(--chart-2)" width={64} height={22} />
            </div>
          </Card>
        ))}
      </div>

      {/* Quick access */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { detail: { page: 'ai', tab: 'agents' }, label: 'Agents', icon: Users },
          { detail: { page: 'communications', tab: 'calls' }, label: 'Calls', icon: Phone },
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
              let label = ok ? 'API key configured' : 'No key — add in .env';
              let color = ok ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-amber-500/10 text-amber-600 ring-amber-500/30';
              let dot = ok ? 'bg-emerald-500' : 'bg-amber-500';
              if (active === 'llm-demo') { label = 'Demo mode — no key needed'; color = 'bg-sky-500/10 text-sky-600 ring-sky-500/30'; dot = 'bg-sky-500'; }
              if (active === 'llm-ollama' && ok) { label = 'Ollama running locally'; }
              if (active === 'llm-ollama' && !ok) { label = 'Ollama offline — run: ollama serve'; }
              return (
                <span className={`flex items-center gap-1.5 rounded-full px-2 py-1 font-medium ring-1 ${color}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                  {label}
                </span>
              );
            })() : (
              <span className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground ring-1 ring-border">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                Checking—
              </span>
            )}
            {llm.latency > 0 && <Badge variant="secondary">{llm.latency}ms</Badge>}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Provider</label>
            <select
              value={llm.providerId}
              onChange={(e) => {
                const p = catalog.find((x) => x.id === e.target.value) ?? catalog[0];
                const online = configuredProviders.has(p.id);
                setLlmAndSyncToAgents({ providerId: p.id, model: p.models[0].id, online, latency: online ? 120 : 0 });
              }}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>{configuredProviders.has(p.id) ? `✓ ${p.label}` : p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Model</label>
            <select
              value={llm.model}
              onChange={(e) => setLlmAndSyncToAgents({ model: e.target.value })}
              className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {catalog.find((x) => x.id === llm.providerId)?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.tier === 'free' ? '🟢 ' : m.tier === 'credits' ? '🟡 ' : '💳 '}{m.label}{m.contextK ? ` — ${m.contextK}k` : ''}
                </option>
              ))}
            </select>
          </div>
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
            <SectionTitle title="Finance" sub="September snapshot" />
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
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setGoalOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New goal
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {goals.map((g) => (
              <div key={g.id} className="group">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', GOAL_STATUS_STYLE[g.status])}>
                      {g.status.replace('-', ' ')}
                    </span>
                    {g.title}
                  </span>
                  <button onClick={() => deleteGoal(g.id)} className="text-muted-foreground opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Progress value={g.progress} className="h-2" />
                <p className="mt-0.5 text-[11px] text-muted-foreground">{g.owner} — due {g.due}</p>
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
              <div key={a.id} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', APPROVAL_LABEL[a.category] ? 'bg-primary/10 text-primary ring-primary/30' : '')}>
                    {APPROVAL_LABEL[a.category]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{a.submittedBy} — {a.createdAt}</span>
                </div>
                <p className="mt-2 text-sm font-medium">{a.title}</p>
                {a.amount > 0 && <p className="text-xs font-semibold text-primary">{fmtMoney(a.amount)}</p>}
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.description}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => actOnApproval(a.id, 'approved')}>
                    <Check className="h-3.5 w-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => actOnApproval(a.id, 'rejected')}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              </div>
            ))}
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

      {/* New goal dialog */}
      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create a new goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Goal title</label>
              <Input value={goalForm.title} onChange={(e) => setGoalForm((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. 30% faster quote-to-close" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Objective / outcome</label>
              <Input value={goalForm.objective} onChange={(e) => setGoalForm((s) => ({ ...s, objective: e.target.value }))} placeholder="What success looks like" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Owner agent</label>
                <select
                  value={goalForm.owner}
                  onChange={(e) => setGoalForm((s) => ({ ...s, owner: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select agent—</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Due date</label>
                <input
                  type="date"
                  value={goalForm.due}
                  onChange={(e) => setGoalForm((s) => ({ ...s, due: e.target.value }))}
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [color-scheme:light] dark:[color-scheme:dark]"
                />
              </div>
            </div>
            <Button className="w-full" onClick={submitGoal}>
              <Target className="h-4 w-4" /> Create goal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
