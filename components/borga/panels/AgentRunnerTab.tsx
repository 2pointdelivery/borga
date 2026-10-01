'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Play, Pause, RefreshCw, Clock, CheckCircle2, XCircle, Zap, ChevronDown, ChevronRight,
  Trash2, Plus, ToggleLeft, ToggleRight, Bot, AlertCircle, Terminal,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { InboundEndpoint } from '../InboundEndpoint';
import type { AgentRun, AgentRunStep, ScheduledTask, ScheduleInterval } from '@/lib/borga/data';

const INTERVAL_LABEL: Record<ScheduleInterval, string> = {
  hourly: 'Every hour',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const STEP_ICON: Record<AgentRunStep['type'], React.FC<{ className?: string }>> = {
  thought: ({ className }) => <Bot className={className} />,
  tool_call: ({ className }) => <Terminal className={className} />,
  tool_result: ({ className }) => <CheckCircle2 className={className} />,
  summary: ({ className }) => <Zap className={className} />,
};

const STEP_COLOR: Record<AgentRunStep['type'], string> = {
  thought: 'text-violet-500',
  tool_call: 'text-amber-500',
  tool_result: 'text-emerald-500',
  summary: 'text-sky-500',
};

function RunSteps({ steps }: { steps: AgentRunStep[] }) {
  return (
    <div className="space-y-1.5 pt-2">
      {steps.map((step, i) => {
        const Icon = STEP_ICON[step.type];
        return (
          <div key={i} className="flex gap-2 text-xs">
            <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', STEP_COLOR[step.type])} />
            <div className="min-w-0">
              {step.tool && (
                <span className="mr-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {step.tool}
                </span>
              )}
              <span className="text-muted-foreground">{step.content.slice(0, 200)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RunCard({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = run.status === 'complete'
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : run.status === 'error'
    ? <XCircle className="h-3.5 w-3.5 text-rose-500" />
    : <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-500" />;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {statusIcon}
          <div>
            <p className="text-xs font-medium">{run.agentName}</p>
            <p className="text-[11px] text-muted-foreground">{run.goal.slice(0, 80)}{run.goal.length > 80 ? '…' : ''}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            {run.triggeredBy}
          </Badge>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-0.5 hover:bg-accent"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {run.summary && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{run.summary.slice(0, 150)}</p>
      )}
      {expanded && run.steps.length > 0 && <RunSteps steps={run.steps} />}
    </div>
  );
}

function StreamingRun({ events, goal, agentName }: { events: string[]; goal: string; agentName: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border bg-background/50 p-3 font-mono text-xs">
      <p className="mb-2 text-muted-foreground">
        <Bot className="mr-1 inline h-3 w-3" />
        {agentName}: <span className="text-foreground">{goal.slice(0, 60)}{goal.length > 60 ? '…' : ''}</span>
      </p>
      {events.map((e, i) => (
        <div key={i} className="mb-1 leading-relaxed text-muted-foreground">
          {e}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Tier 5 heartbeat controls: kill switch + quiet hours, both durable in
 * settings (config, not code). Pausing stops all proactive firing instantly;
 * chat, voice, and manual runs keep working.
 */
function HeartbeatCard() {
  const { activeWorkspaceId } = useBorga();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [quiet, setQuiet] = useState({ start: '22:00', end: '07:00' });
  const [draft, setDraft] = useState({ start: '22:00', end: '07:00' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'heartbeat', ws: activeWorkspaceId }),
    }).then((r) => r.json()).then((d: { paused?: boolean; quietHours?: { start: string; end: string } }) => {
      setPaused(d.paused ?? false);
      if (d.quietHours) {
        setQuiet(d.quietHours);
        setDraft(d.quietHours);
      }
    }).catch(() => setPaused(false));
  }, [activeWorkspaceId]);

  const togglePause = async () => {
    const next = !(paused ?? false);
    setPaused(next);
    await fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'setHeartbeat', paused: next, ws: activeWorkspaceId }),
    }).catch(() => setPaused(!next));
  };

  const saveQuiet = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'setQuietHours', start: draft.start, end: draft.end, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; quietHours?: { start: string; end: string } };
      if (d.ok && d.quietHours) setQuiet(d.quietHours);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Heartbeat</h3>
          <Badge variant="outline" className={cn('text-[10px]', paused ? 'border-rose-500/30 text-rose-600' : 'border-emerald-500/30 text-emerald-600')}>
            {paused === null ? '…' : paused ? 'Paused — kill switch on' : 'Beating — quiet by default'}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Quiet {quiet.start}–{quiet.end}</span>
          <Input value={draft.start} onChange={(e) => setDraft((s) => ({ ...s, start: e.target.value }))} className="h-7 w-16 font-mono text-xs" placeholder="22:00" />
          <Input value={draft.end} onChange={(e) => setDraft((s) => ({ ...s, end: e.target.value }))} className="h-7 w-16 font-mono text-xs" placeholder="07:00" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveQuiet} disabled={saving}>Save</Button>
          <Button size="sm" variant={paused ? 'default' : 'outline'} className="h-7 gap-1 text-xs" onClick={togglePause}>
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? 'Resume' : 'Pause all'}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Non-urgent checks wait out quiet hours and land here as held notices. Only urgent ones surface at night. Overlaps never stack.
      </p>
    </Card>
  );
}

/** Tier 5 held inbox: catch-up-on-return, every item dismissible. */
function NoticesInbox({ notices, onDismiss, onClear }: { notices: { id: string; title: string; body: string; severity: string; createdAt: string }[]; onDismiss: (id: string) => void; onClear: () => void }) {
  if (!notices.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">While you were away <Badge variant="secondary" className="ml-1">{notices.length}</Badge></h3>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>Dismiss all</Button>
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {notices.slice(0, 20).map((n) => (
          <div key={n.id} className="flex items-start gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{n.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{n.body}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => onDismiss(n.id)}>Dismiss</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AgentRunnerTab() {
  const {
    agents, scheduledTasks, addScheduledTask, updateScheduledTask, deleteScheduledTask,
    toggleScheduledTask, agentRuns, addAgentRun, log, activeWorkspaceId, activeWorkspace, llm, llmCatalog,
    notices, dismissNotice, clearNotices,
  } = useBorga();

  // Run form
  const [selectedAgentId, setSelectedAgentId] = useState('a-borga');
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [streamEvents, setStreamEvents] = useState<string[]>([]);
  const [lastRunAgent, setLastRunAgent] = useState('Borga');

  // New scheduled task form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAgentId, setNewAgentId] = useState('a-borga');
  const [newGoal, setNewGoal] = useState('');
  const [newInterval, setNewInterval] = useState<ScheduleInterval>('daily');
  const [creating, setCreating] = useState(false);

  // Scheduler tick on mount + every 60s
  const lastTickRef = useRef(0);
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      if (now - lastTickRef.current < 55000) return;
      lastTickRef.current = now;
      try {
        const r = await fetch('/api/borga/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'tick', ws: activeWorkspaceId }),
        });
        const d = await r.json() as { triggered?: string[] };
        if (d.triggered && d.triggered.length > 0) {
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Scheduler fired ${d.triggered.length} task(s) autonomously.` });
        }
      } catch {
        // Tick is best-effort
      }
    };
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
     
  }, [log, activeWorkspaceId]);

  async function runAgent() {
    if (!goal.trim() || running) return;
    setRunning(true);
    setStreamEvents([]);
    const agent = agents.find((a) => a.id === selectedAgentId);
    setLastRunAgent(agent?.name ?? 'Agent');

    try {
      const res = await fetch('/api/borga/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ agentId: selectedAgentId, goal: goal.trim(), stream: true, ws: activeWorkspaceId, companyName: activeWorkspace()?.name }),
      });
      if (!res.ok || !res.body) {
        setStreamEvents(['Connection failed. Check server logs.']);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedSteps: AgentRunStep[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as Record<string, unknown>;
            const type = evt.type as string;

            if (type === 'thought') {
              setStreamEvents((p) => [...p, `💭 ${String(evt.content ?? '').slice(0, 120)}`]);
              collectedSteps.push({ type: 'thought', content: String(evt.content ?? ''), at: new Date().toISOString() });
            } else if (type === 'tool_call') {
              setStreamEvents((p) => [...p, `🔧 ${String(evt.tool)}: ${JSON.stringify(evt.params ?? {}).slice(0, 80)}`]);
              collectedSteps.push({ type: 'tool_call', content: `Calling ${evt.tool}`, tool: String(evt.tool), params: evt.params as Record<string, unknown>, at: new Date().toISOString() });
            } else if (type === 'tool_result') {
              const ok = evt.ok as boolean;
              setStreamEvents((p) => [...p, `${ok ? '✓' : '✗'} ${String(evt.tool)} → ${JSON.stringify(evt.data ?? evt.error ?? '').slice(0, 100)}`]);
              collectedSteps.push({ type: 'tool_result', content: String(evt.data ?? evt.error ?? ''), tool: String(evt.tool), result: evt.data, at: new Date().toISOString() });
            } else if (type === 'summary') {
              setStreamEvents((p) => [...p, `⚡ ${String(evt.content ?? '').slice(0, 200)}`]);
              collectedSteps.push({ type: 'summary', content: String(evt.content ?? ''), at: new Date().toISOString() });
            } else if (type === 'complete') {
              setStreamEvents((p) => [...p, `✅ Done — ${evt.steps ?? 0} step(s) completed`]);
              const newRun: AgentRun = {
                id: String(evt.runId ?? `run-${Date.now()}`),
                agentId: selectedAgentId,
                agentName: agent?.name ?? 'Agent',
                goal: goal.trim(),
                status: 'complete',
                steps: collectedSteps,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                summary: String(evt.summary ?? ''),
                triggeredBy: 'user',
              };
              addAgentRun(newRun);
            } else if (type === 'error') {
              setStreamEvents((p) => [...p, `❌ Error: ${String(evt.error ?? '')}`]);
            }
          } catch {
            // Malformed SSE line
          }
        }
      }
    } finally {
      setRunning(false);
    }
  }

  async function triggerScheduled(id: string) {
    const t = scheduledTasks.find((x) => x.id === id);
    if (!t) return;
    log({ agentId: t.agentId, agentName: t.agentId, actor: 'user', kind: 'task', message: `Manually triggered scheduled task: "${t.name}"` });
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'trigger', id, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; run?: { summary?: string }; taskId?: string };
      if (d.ok) {
        updateScheduledTask(id, { lastRun: new Date().toISOString(), runCount: (t.runCount ?? 0) + 1, lastResult: d.run?.summary ?? 'Completed' });
      }
    } catch {
      // Best-effort
    }
  }

  async function createScheduledTask() {
    if (!newName.trim() || !newGoal.trim() || creating) return;
    setCreating(true);
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'create', name: newName, agentId: newAgentId, goal: newGoal, interval: newInterval , ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; task?: ScheduledTask };
      if (d.ok && d.task) {
        addScheduledTask(d.task);
        setNewName(''); setNewGoal(''); setNewInterval('daily');
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: string) {
    deleteScheduledTask(id);
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'delete', id, ws: activeWorkspaceId }),
    }).catch(() => null);
  }

  const agentOptions = agents.slice(0, 20);

  // Real readout of what will actually power the run — mirrors the exact
  // resolution order the server uses (per-agent model override, else the
  // global selection), so there's no surprise between what's shown and what runs.
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const effectiveModelId = selectedAgent?.model || llm.model;
  const effectiveProvider = (llmCatalog ?? []).find((p) => p.models.some((m) => m.id === effectiveModelId));
  const effectiveModelLabel = effectiveProvider?.models.find((m) => m.id === effectiveModelId)?.label ?? effectiveModelId;
  const isDemoModel = effectiveModelId === 'demo' || effectiveProvider?.id === 'llm-demo';

  return (
    <div className="space-y-8">
      <SectionTitle
        title="Autonomous Agent Runner"
        sub="Run agents with real goals against live data — they plan, use tools, and take actual actions."
      />

      <HeartbeatCard />
      <NoticesInbox notices={notices} onDismiss={dismissNotice} onClear={clearNotices} />

      {/* Manual Run */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Run an Agent</h3>
        </div>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-48 shrink-0">
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent>
                  {agentOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Enter a goal — the agent will plan, reason, and take real actions to complete it…"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="min-h-[72px] flex-1 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAgent();
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Agent reads your KB, tasks, leads, and memories — then executes real actions. Ctrl+Enter to run.
            </p>
            <Badge
              variant="outline"
              className={cn('shrink-0 gap-1 font-mono text-[10px]', isDemoModel && 'border-amber-500/30 text-amber-600')}
              title={isDemoModel ? 'No LLM connected — runs on the deterministic structured planner instead of a model' : `Runs on ${effectiveProvider?.label ?? effectiveProvider?.id ?? effectiveModelId}`}
            >
              <Bot className="h-3 w-3" /> {isDemoModel ? 'No model — structured planner' : effectiveModelLabel}
            </Badge>
            <Button size="sm" onClick={runAgent} disabled={running || !goal.trim()} className="gap-1.5">
              {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {running ? 'Running…' : 'Run Agent'}
            </Button>
          </div>
        </div>
        {(running || streamEvents.length > 0) && (
          <div className="mt-4">
            <StreamingRun events={streamEvents} goal={goal} agentName={lastRunAgent} />
          </div>
        )}
      </Card>

      {/* Scheduled Tasks */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Scheduled Tasks</h3>
            <Badge variant="secondary">{scheduledTasks.filter((t) => t.enabled).length} active</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-3 p-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <Input
                  placeholder="Task name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-8 flex-1 text-sm"
                />
                <div className="w-36 shrink-0">
                  <Select value={newAgentId} onValueChange={setNewAgentId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {agentOptions.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28 shrink-0">
                  <Select value={newInterval} onValueChange={(v) => setNewInterval(v as ScheduleInterval)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(INTERVAL_LABEL) as [ScheduleInterval, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea
                placeholder="Goal — what should the agent do when this task fires?"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                className="min-h-[60px] resize-none text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={createScheduledTask} disabled={creating || !newName.trim() || !newGoal.trim()}>
                  {creating ? <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  Save Task
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          {scheduledTasks.map((task) => {
            const agent = agents.find((a) => a.id === task.agentId);
            return (
              <div key={task.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <button
                  onClick={() => toggleScheduledTask(task.id)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  title={task.enabled ? 'Disable' : 'Enable'}
                >
                  {task.enabled
                    ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                    : <ToggleLeft className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{task.name}</p>
                    <Badge variant="outline" className="text-[10px]">{INTERVAL_LABEL[task.interval]}</Badge>
                    {agent && (
                      <span className="text-[10px] text-muted-foreground">→ {agent.name}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{task.goal.slice(0, 100)}{task.goal.length > 100 ? '…' : ''}</p>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                    {task.lastRun && <span>Last run: {new Date(task.lastRun).toLocaleString()}</span>}
                    {task.runCount > 0 && <span>{task.runCount} run{task.runCount !== 1 ? 's' : ''}</span>}
                    {task.lastResult && <span className="truncate max-w-[240px]">{task.lastResult}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => triggerScheduled(task.id)}
                    title="Trigger now"
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-500"
                    onClick={() => deleteTask(task.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
          {scheduledTasks.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              No scheduled tasks yet. Click New to create one.
            </div>
          )}
        </div>
      </div>

      {/* Recent Runs */}
      {agentRuns.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Recent Runs</h3>
            <Badge variant="secondary">{agentRuns.length}</Badge>
          </div>
          <div className="space-y-2">
            {agentRuns.slice(0, 15).map((run) => (
              <RunCard key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}

      {/* Inbound Webhooks */}
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Inbound Webhook Endpoint</h3>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          External services can trigger agents by POSTing to this endpoint. The agent is selected automatically based on the event type.
        </p>
        <InboundEndpoint />
        <p className="mt-2 text-xs text-muted-foreground">
          Supported sources: github, stripe, hubspot, booking events. Add a secret for HMAC-SHA256 signature verification.
        </p>
      </Card>
    </div>
  );
}
