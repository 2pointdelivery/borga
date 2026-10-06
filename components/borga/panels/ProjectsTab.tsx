'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useState, useCallback } from 'react';
import { Plus, Trash2, ArrowLeft, CheckSquare, Receipt, GripVertical, CalendarClock, Users, X, Check, Pencil, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_STYLE,
  computeProjectActualSpend,
      type Project,
  type ProjectStatus,
  type Task,
  type TaskStatus,
  type Milestone,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { AgentAvatar, SectionTitle } from '../bits';
import { TaskEditDialog } from './TaskEditDialog';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { AccountSelect } from '../form-widgets';
import { cn } from '@/lib/utils';

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on-hold', 'completed', 'cancelled'];
const UNASSIGNED = '__none__';
const TASK_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

export function ProjectsTab({ initialProjectId }: { initialProjectId?: string } = {}) {
  const {
    projects, addProject, updateProject, deleteProject,
    tasks, addTask, updateTask,
    finance, addFinanceEntry,
    bills,
    customers, coa,
    agents, activeWorkspace, log,
  } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [selectedId, setSelectedId] = useState<string | null>(initialProjectId ?? null);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', ownerId: '', customerId: '', budgetAmount: '' });

  const [detailTab, setDetailTab] = useState('tasks');
  const [taskDraft, setTaskDraft] = useState('');
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [expenseDraft, setExpenseDraft] = useState({ label: '', amount: '', accountId: '' });
  const [incomeDraft, setIncomeDraft] = useState({ label: '', amount: '', accountId: '' });
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState({ title: '', dueDateIso: '' });
  const [addMemberId, setAddMemberId] = useState('');
  const expenseAccounts = coa.filter((a) => a.type === 'expense' || a.type === 'cost');
  const revenueAccounts = coa.filter((a) => a.type === 'revenue');

  const createProject = useCallback(() => {
    if (!form.name.trim()) return;
    const p: Project = {
      id: `proj-${Date.now()}`,
      name: form.name.trim(),
      description: form.description.trim(),
      status: 'planning',
      ownerId: form.ownerId || undefined,
      customerId: form.customerId || undefined,
      budgetAmount: Number(form.budgetAmount) || 0,
      createdAt: new Date().toISOString(),
    };
    addProject(p);
    setSelectedId(p.id);
    setCreateOpen(false);
    setForm({ name: '', description: '', ownerId: '', customerId: '', budgetAmount: '' });
    log({ agentId: 'a-pm', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Project "${p.name}" created.` });
  }, [form, addProject, log]);

  const removeProject = (p: Project) => {
    setConfirmDeleteProject(p);
  };

  const doRemoveProject = () => {
    const p = confirmDeleteProject;
    if (!p) return;
    deleteProject(p.id);
    if (selectedId === p.id) setSelectedId(null);
    log({ agentId: 'a-pm', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Project "${p.name}" deleted (linked tasks and expenses were unlinked, not removed).` });
    setConfirmDeleteProject(null);
  };

  const addProjectTask = useCallback(() => {
    if (!selected || !taskDraft.trim()) return;
    addTask({
      id: `t-${Date.now()}`,
      title: taskDraft.trim(),
      detail: '',
      priority: 'P2',
      status: 'todo',
      bucket: 'week',
      assignee: agents.find((a) => a.id === selected.ownerId)?.name ?? 'Borga',
      tags: [],
      due: 'This week',
      progress: 0,
      projectId: selected.id,
    });
    setTaskDraft('');
  }, [selected, taskDraft, addTask, agents]);

  const addProjectExpense = useCallback(() => {
    if (!selected || !expenseDraft.label.trim() || !Number(expenseDraft.amount)) return;
    const account = expenseAccounts.find((a) => a.id === expenseDraft.accountId);
    addFinanceEntry({
      id: `f-${Date.now()}`,
      label: expenseDraft.label.trim(),
      amount: Math.abs(Number(expenseDraft.amount)),
      category: account?.name ?? selected.name,
      kind: 'expense',
      dateIso: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      source: 'manual',
      projectId: selected.id,
      accountId: account?.id,
    });
    setExpenseDraft({ label: '', amount: '', accountId: '' });
  }, [selected, expenseDraft, expenseAccounts, addFinanceEntry]);

  const addProjectIncome = useCallback(() => {
    if (!selected || !incomeDraft.label.trim() || !Number(incomeDraft.amount)) return;
    const account = revenueAccounts.find((a) => a.id === incomeDraft.accountId);
    addFinanceEntry({
      id: `f-${Date.now()}`,
      label: incomeDraft.label.trim(),
      amount: Math.abs(Number(incomeDraft.amount)),
      category: account?.name ?? selected.name,
      kind: 'revenue',
      dateIso: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      source: 'manual',
      projectId: selected.id,
      accountId: account?.id,
    });
    setIncomeDraft({ label: '', amount: '', accountId: '' });
  }, [selected, incomeDraft, revenueAccounts, addFinanceEntry]);

  const addMilestone = useCallback(() => {
    if (!selected || !milestoneDraft.title.trim()) return;
    const m: Milestone = { id: `ms-${Date.now()}`, title: milestoneDraft.title.trim(), dueDateIso: milestoneDraft.dueDateIso || undefined, done: false };
    updateProject(selected.id, { milestones: [...(selected.milestones ?? []), m] });
    setMilestoneDraft({ title: '', dueDateIso: '' });
  }, [selected, milestoneDraft, updateProject]);

  const toggleMilestone = (m: Milestone) => {
    if (!selected) return;
    updateProject(selected.id, { milestones: (selected.milestones ?? []).map((x) => (x.id === m.id ? { ...x, done: !x.done } : x)) });
  };

  const doDeleteMilestone = () => {
    if (!selected || !confirmDeleteMilestone) return;
    updateProject(selected.id, { milestones: (selected.milestones ?? []).filter((x) => x.id !== confirmDeleteMilestone) });
    setConfirmDeleteMilestone(null);
  };

  const [confirmDeleteProject, setConfirmDeleteProject] = useState<Project | null>(null);
  const [confirmDeleteMilestone, setConfirmDeleteMilestone] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');

  const commitName = () => {
    if (!selected || !nameDraft.trim()) return;
    updateProject(selected.id, { name: nameDraft.trim() });
    log({ agentId: 'a-pm', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Project renamed to "${nameDraft.trim()}".` });
    setEditingName(false);
  };

  const commitDesc = () => {
    if (!selected) return;
    updateProject(selected.id, { description: descDraft.trim() });
    log({ agentId: 'a-pm', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Project "${selected.name}" description updated.` });
    setEditingDesc(false);
  };

  const addTeamMember = () => {
    if (!selected || !addMemberId) return;
    const current = selected.teamAgentIds ?? [];
    if (current.includes(addMemberId)) return;
    updateProject(selected.id, { teamAgentIds: [...current, addMemberId] });
    setAddMemberId('');
  };

  const removeTeamMember = (agentId: string) => {
    if (!selected) return;
    updateProject(selected.id, { teamAgentIds: (selected.teamAgentIds ?? []).filter((id) => id !== agentId) });
  };

  const onTaskDrop = (status: TaskStatus) => {
    if (dragTaskId) {
      updateTask(dragTaskId, { status });
      log({ agentId: 'a-pm', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Task moved to ${status.replace('-', ' ')}.` });
    }
    setDragTaskId(null);
  };

  if (selected) {
    const linkedCustomer = customers.find((c) => c.id === selected.customerId);
    const projectTasks = tasks.filter((t) => t.projectId === selected.id);
    const projectExpenses = finance.filter((f) => f.projectId === selected.id && f.kind === 'expense' && !f.voidedAt);
    const projectIncome = finance.filter((f) => f.projectId === selected.id && f.kind === 'revenue' && !f.voidedAt);
    const incomeTotal = projectIncome.reduce((s, f) => s + f.amount, 0);
    // "Certified" payments — vendor bills approved for payment or settled against
    // this project (scheduled/paid), as opposed to a bill merely recorded as unpaid.
    const projectBills = bills.filter((b) => b.projectId === selected.id);
    const certifiedPayments = projectBills.filter((b) => b.status === 'scheduled' || b.status === 'paid');
    const actual = computeProjectActualSpend(finance, selected.id);
    const pct = selected.budgetAmount > 0 ? Math.min(100, Math.round((actual / selected.budgetAmount) * 100)) : 0;
    const todo = projectTasks.filter((t) => t.status === 'todo').length;
    const inProgress = projectTasks.filter((t) => t.status === 'in-progress').length;
    const done = projectTasks.filter((t) => t.status === 'done').length;

    // ── Analytics ─────────────────────────────────────────────────────────
    const remaining = selected.budgetAmount - actual;
    const completion = projectTasks.length ? Math.round((done / projectTasks.length) * 100) : 0;
    const milestoneList = selected.milestones ?? [];
    const milestonesDone = milestoneList.filter((m) => m.done).length;
    const taskStatusData = [
      { name: 'To do', value: todo },
      { name: 'In progress', value: inProgress },
      { name: 'Done', value: done },
    ];
    const spendByCategory = Object.entries(
      projectExpenses.reduce<Record<string, number>>((acc, f) => {
        const key = f.category || 'Uncategorised';
        acc[key] = (acc[key] ?? 0) + f.amount;
        return acc;
      }, {}),
    )
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const certifiedTotal = certifiedPayments.reduce((s, b) => s + b.amount, 0);
    const unpaidTotal = projectBills.filter((b) => b.status === 'unpaid').reduce((s, b) => s + b.amount, 0);

    return (
      <div className="borga-fade-up space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="h-4 w-4" /> All projects
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeProject(selected)}>
            <Trash2 className="h-4 w-4" /> Delete project
          </Button>
        </div>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex max-w-md items-center gap-2">
                  <Input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false); }} className="h-8 text-base font-semibold" />
                  <Button size="sm" onClick={commitName} disabled={!nameDraft.trim()}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>Cancel</Button>
                </div>
              ) : (
                <div className="group flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{selected.name}</h3>
                  <Badge className={cn('text-[10px] capitalize ring-1', PROJECT_STATUS_STYLE[selected.status])}>{PROJECT_STATUS_LABEL[selected.status]}</Badge>
                  <button onClick={() => { setNameDraft(selected.name); setEditingName(true); }} className="text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100" title="Rename project">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {editingDesc ? (
                <div className="mt-1 flex max-w-xl items-start gap-2">
                  <Textarea rows={2} value={descDraft} onChange={(e) => setDescDraft(e.target.value)} placeholder="What this project is about…" className="text-sm" />
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" onClick={commitDesc}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingDesc(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="group mt-1 flex max-w-xl items-start gap-2">
                  <p className="text-sm text-muted-foreground">{selected.description || 'No description yet.'}</p>
                  <button onClick={() => { setDescDraft(selected.description ?? ''); setEditingDesc(true); }} className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-primary group-hover:opacity-100" title="Edit description">
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <Select value={selected.status} onValueChange={(v) => updateProject(selected.id, { status: v as ProjectStatus })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Budget</p>
              <Input
                type="number"
                defaultValue={selected.budgetAmount}
                className="mt-1"
                onBlur={(e) => updateProject(selected.id, { budgetAmount: Number(e.target.value) || 0 })}
              />
            </div>
            <div className="sm:col-span-2">
              <p className="text-[11px] font-medium text-muted-foreground">Actual spend vs. budget</p>
              <div className="mt-2 flex items-center gap-3">
                <Progress value={pct} className="h-2 flex-1" />
                <span className={cn('shrink-0 font-mono text-xs font-medium', actual > selected.budgetAmount && selected.budgetAmount > 0 && 'text-rose-500')}>
                  {money(actual)} / {money(selected.budgetAmount)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[11px] font-medium text-muted-foreground">Customer account</p>
            <SearchSelect
              options={[
                { value: UNASSIGNED, label: 'None — internal project' },
                ...customers.map((c) => ({ value: c.id, label: c.name, detail: c.industry })),
              ]}
              value={selected.customerId || UNASSIGNED}
              onChange={(v) => updateProject(selected.id, { customerId: v === UNASSIGNED ? undefined : v })}
              placeholder="None"
              searchPlaceholder="Search customers"
              clearable={false}
              className="mt-1 w-64"
            />
            {linkedCustomer && <p className="mt-1 text-[11px] text-muted-foreground">Rolls up under {linkedCustomer.name} on the Customers page.</p>}
          </div>
        </Card>

        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="milestones">Milestones</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            <TabsTrigger value="finances">Finances</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          {/* ── Tasks (list) ────────────────────────────────────────────────── */}
          <TabsContent value="tasks">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><CheckSquare className="h-4 w-4" /> Tasks</p>
                <p className="text-[11px] text-muted-foreground">{todo} todo · {inProgress} in progress · {done} done</p>
              </div>
              <div className="mb-3 flex gap-2">
                <Input
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  placeholder="Add a task…"
                  onKeyDown={(e) => e.key === 'Enter' && addProjectTask()}
                />
                <Button size="icon" onClick={addProjectTask}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5">
                {projectTasks.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No tasks linked yet.</p>}
                {projectTasks.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setEditTask(t)}
                    className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    <span className={cn(t.status === 'done' && 'text-muted-foreground line-through')}>{t.title}</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{t.status.replace('-', ' ')}</Badge>
                  </button>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ── Board (kanban) ──────────────────────────────────────────────── */}
          <TabsContent value="board">
            <div className="grid gap-4 md:grid-cols-3">
              {TASK_COLUMNS.map((col) => {
                const list = projectTasks.filter((t) => t.status === col.id);
                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onTaskDrop(col.id)}
                    className={cn(
                      'flex min-h-[220px] flex-col rounded-2xl border bg-muted/20 p-3 transition-colors',
                      dragTaskId && 'border-dashed border-primary bg-primary/5',
                    )}
                  >
                    <div className="mb-3 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold">{col.label}</span>
                      <Badge variant="secondary">{list.length}</Badge>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {list.map((t) => (
                        <Card
                          key={t.id}
                          draggable
                          onDragStart={() => setDragTaskId(t.id)}
                          onDragEnd={() => setDragTaskId(null)}
                          onClick={() => setEditTask(t)}
                          className={cn('cursor-grab p-3 active:cursor-grabbing', dragTaskId === t.id && 'opacity-50')}
                        >
                          <div className="flex items-start gap-2">
                            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <p className="min-w-0 flex-1 truncate text-sm">{t.title}</p>
                          </div>
                        </Card>
                      ))}
                      {list.length === 0 && <p className="py-4 text-center text-[11px] text-muted-foreground">Drop tasks here</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ── Milestones / calendar ───────────────────────────────────────── */}
          <TabsContent value="milestones">
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="h-4 w-4" /> Milestones</p>
              <div className="mb-3 flex gap-2">
                <Input
                  value={milestoneDraft.title}
                  onChange={(e) => setMilestoneDraft((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Milestone title…"
                  onKeyDown={(e) => e.key === 'Enter' && addMilestone()}
                />
                <Input
                  type="date"
                  value={milestoneDraft.dueDateIso}
                  onChange={(e) => setMilestoneDraft((f) => ({ ...f, dueDateIso: e.target.value }))}
                  className="w-40"
                />
                <Button size="icon" onClick={addMilestone}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5">
                {(selected.milestones ?? []).length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No milestones yet.</p>}
                {[...(selected.milestones ?? [])]
                  .sort((a, b) => (a.dueDateIso ?? '9999').localeCompare(b.dueDateIso ?? '9999'))
                  .map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <button onClick={() => toggleMilestone(m)} className="flex items-center gap-2 text-left">
                        <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', m.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground/40')}>
                          {m.done && <Check className="h-3 w-3" />}
                        </span>
                        <span className={cn(m.done && 'text-muted-foreground line-through')}>{m.title}</span>
                      </button>
                      <div className="flex items-center gap-2">
                        {m.dueDateIso && <span className="text-[11px] text-muted-foreground">{m.dueDateIso}</span>}
                        <button onClick={() => setConfirmDeleteMilestone(m.id)} className="text-muted-foreground hover:text-destructive" title="Delete milestone"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          </TabsContent>

          {/* ── Team ────────────────────────────────────────────────────────── */}
          <TabsContent value="team">
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4" /> Project team</p>
              <div className="mb-3 flex gap-2">
                <SearchSelect
                  options={agents.filter((a) => !(selected.teamAgentIds ?? []).includes(a.id)).map((a) => ({ value: a.id, label: a.name, detail: a.department }))}
                  value={addMemberId}
                  onChange={setAddMemberId}
                  placeholder="Add a team member…"
                  searchPlaceholder="Search agents"
                  clearable={false}
                  className="flex-1"
                />
                <Button size="icon" onClick={addTeamMember} disabled={!addMemberId}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5">
                {(selected.teamAgentIds ?? []).length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No team members added yet.</p>}
                {(selected.teamAgentIds ?? []).map((id) => {
                  const a = agents.find((x) => x.id === id);
                  if (!a) return null;
                  return (
                    <div key={id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <AgentAvatar name={a.name} color={a.avatarColor} size={24} />
                        <div>
                          <p className="font-medium leading-none">{a.name}</p>
                          <p className="text-[11px] text-muted-foreground">{a.role}</p>
                        </div>
                      </div>
                      <button onClick={() => removeTeamMember(id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          {/* ── Finances ────────────────────────────────────────────────────── */}
          <TabsContent value="finances">
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: 'Income', value: money(incomeTotal), color: 'text-emerald-600' },
                { label: 'Spend', value: money(actual), color: 'text-muted-foreground' },
                { label: 'Net', value: `${incomeTotal - actual < 0 ? '−' : ''}${money(Math.abs(incomeTotal - actual))}`, color: incomeTotal - actual < 0 ? 'text-rose-500' : 'text-emerald-600' },
              ].map((s) => (
                <Card key={s.label} className="p-3">
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  <p className={cn('mt-1 truncate font-mono text-sm font-semibold', s.color)}>{s.value}</p>
                </Card>
              ))}
            </div>
            <Card className="p-5">
              <div className="mb-4">
                <p className="text-[11px] font-medium text-muted-foreground">Actual spend vs. budget</p>
                <div className="mt-2 flex items-center gap-3">
                  <Progress value={pct} className="h-2 flex-1" />
                  <span className={cn('shrink-0 font-mono text-xs font-medium', actual > selected.budgetAmount && selected.budgetAmount > 0 && 'text-rose-500')}>
                    {money(actual)} / {money(selected.budgetAmount)}
                  </span>
                </div>
              </div>
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Receipt className="h-4 w-4" /> Linked income</p>
              <div className="mb-3 grid grid-cols-[1fr_1fr_110px_40px] gap-2">
                <Input
                  value={incomeDraft.label}
                  onChange={(e) => setIncomeDraft((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Income description…"
                />
                <AccountSelect
                  value={incomeDraft.accountId || undefined}
                  onChange={(v) => setIncomeDraft((f) => ({ ...f, accountId: v ?? '' }))}
                  placeholder="GL account"
                  types={['revenue']}
                />
                <Input
                  type="number"
                  value={incomeDraft.amount}
                  onChange={(e) => setIncomeDraft((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Amount"
                />
                <Button size="icon" onClick={addProjectIncome}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5">
                {projectIncome.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No income linked yet.</p>}
                {projectIncome.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <div>
                      <span>{f.label}</span>
                      {f.category && <span className="ml-2 text-[11px] text-muted-foreground">{f.category}</span>}
                    </div>
                    <span className="font-mono text-xs text-emerald-600">+{money(f.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="mt-4 p-5">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Receipt className="h-4 w-4" /> Linked expenses</p>
              <div className="mb-3 grid grid-cols-[1fr_1fr_110px_40px] gap-2">
                <Input
                  value={expenseDraft.label}
                  onChange={(e) => setExpenseDraft((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Expense description…"
                />
                <AccountSelect
                  value={expenseDraft.accountId || undefined}
                  onChange={(v) => setExpenseDraft((f) => ({ ...f, accountId: v ?? '' }))}
                  placeholder="GL account"
                  types={['expense', 'cost']}
                />
                <Input
                  type="number"
                  value={expenseDraft.amount}
                  onChange={(e) => setExpenseDraft((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Amount"
                />
                <Button size="icon" onClick={addProjectExpense}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5">
                {projectExpenses.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No expenses linked yet.</p>}
                {projectExpenses.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <div>
                      <span>{f.label}</span>
                      {f.category && <span className="ml-2 text-[11px] text-muted-foreground">{f.category}</span>}
                    </div>
                    <span className="font-mono text-xs">{money(f.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="mt-4 p-5">
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Check className="h-4 w-4" /> Certified project payments</p>
              <p className="mb-3 text-[11px] text-muted-foreground">Vendor bills approved for payment or settled against this project, linked to the chart of accounts.</p>
              <div className="space-y-1.5">
                {certifiedPayments.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No certified payments yet — bills become certified once scheduled or paid.</p>}
                {certifiedPayments.map((b) => {
                  const account = coa.find((a) => a.id === b.accountId);
                  return (
                    <div key={b.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{b.vendorName} — {b.number}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {account ? `${account.code} — ${account.name}` : 'No GL account linked'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-semibold capitalize ring-1',
                          b.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
                        )}>{b.status}</span>
                        <span className="font-mono text-xs">{money(b.amount)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {projectBills.some((b) => b.status === 'unpaid') && (
                <p className="mt-3 text-[11px] text-amber-600">
                  {projectBills.filter((b) => b.status === 'unpaid').length} bill(s) for this project are still unpaid and not yet certified — approve or schedule them in Finance → Vendors &amp; AP.
                </p>
              )}
            </Card>
          </TabsContent>

          {/* ── Analytics ───────────────────────────────────────────────────── */}
          <TabsContent value="analytics">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { label: 'Budget', value: money(selected.budgetAmount), icon: Receipt, color: 'text-muted-foreground' },
                { label: 'Actual spend', value: money(actual), icon: Receipt, color: 'text-sky-600' },
                { label: 'Remaining', value: money(remaining), icon: AlertTriangle, color: remaining < 0 ? 'text-rose-500' : 'text-emerald-600' },
                { label: 'Task completion', value: `${completion}%`, icon: CheckSquare, color: 'text-violet-600' },
              ].map((s) => {
                const Icon = s.icon;
                return (
                  <Card key={s.label} className="p-3">
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className={cn('h-3.5 w-3.5', s.color)} /> {s.label}</p>
                    <p className={cn('mt-1 truncate text-lg font-semibold', s.label === 'Remaining' && remaining < 0 && 'text-rose-500')}>{s.value}</p>
                  </Card>
                );
              })}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <SectionTitle title="Task status" sub={`${projectTasks.length} linked task${projectTasks.length === 1 ? '' : 's'} across three columns`} />
                {projectTasks.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">No tasks linked to this project yet.</p>
                ) : (
                  <div className="mt-4 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={taskStatusData} margin={{ left: -22, right: 4, top: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                        <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
                        <Bar dataKey="value" name="Tasks" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              <Card className="p-5">
                <SectionTitle title="Spend by category" sub={`${money(actual)} posted against this project`} />
                {spendByCategory.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">No expenses linked yet — add them on the Finances tab.</p>
                ) : (
                  <div className="mt-4 h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={spendByCategory} margin={{ left: -22, right: 4, top: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} interval={0} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                        <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => money(v)} />
                        <Bar dataKey="value" name="Spend" fill="var(--chart-3)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>

            <Card className="mt-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle title="Delivery health" sub="Milestones, payments and budget signals for this project" />
                <Badge variant="outline" className="text-[10px]">{milestonesDone}/{milestoneList.length} milestones</Badge>
              </div>
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">Tasks complete</span>
                    <span className="text-muted-foreground">{done}/{projectTasks.length}</span>
                  </div>
                  <Progress value={completion} className="h-2" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">Milestones reached</span>
                    <span className="text-muted-foreground">{milestonesDone}/{milestoneList.length}</span>
                  </div>
                  <Progress value={milestoneList.length ? (milestonesDone / milestoneList.length) * 100 : 0} className="h-2" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">Budget consumed</span>
                    <span className={cn('text-muted-foreground', actual > selected.budgetAmount && selected.budgetAmount > 0 && 'text-rose-500')}>{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Certified payments</p>
                    <p className="font-mono text-sm font-medium">{money(certifiedTotal)}</p>
                  </div>
                  <div className="rounded-lg border px-3 py-2">
                    <p className="text-[11px] text-muted-foreground">Unpaid vendor bills</p>
                    <p className={cn('font-mono text-sm font-medium', unpaidTotal > 0 && 'text-amber-600')}>{money(unpaidTotal)}</p>
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        <TaskEditDialog task={editTask} open={!!editTask} onOpenChange={(o) => !o && setEditTask(null)} />

        <ConfirmDialog
          open={!!confirmDeleteProject}
          onOpenChange={(o) => { if (!o) setConfirmDeleteProject(null); }}
          title={`Delete project "${confirmDeleteProject?.name ?? ''}"?`}
          description="The project is deleted. Linked tasks and expenses are unlinked, not removed — they stay on their boards."
          confirmLabel="Delete project"
          onConfirm={doRemoveProject}
        />

        <ConfirmDialog
          open={!!confirmDeleteMilestone}
          onOpenChange={(o) => { if (!o) setConfirmDeleteMilestone(null); }}
          title="Delete this milestone?"
          description="The milestone is removed from the project timeline."
          confirmLabel="Delete milestone"
          onConfirm={doDeleteMilestone}
        />
      </div>
    );
  }

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Projects" sub="Track delivery and spend together — every project rolls up its own budget vs. actual" />
        <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New project</Button>
      </div>

      {projects.length === 0 && (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No projects yet. Create one to start tracking tasks and spend together.
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((p) => {
          const actual = computeProjectActualSpend(finance, p.id);
          const pct = p.budgetAmount > 0 ? Math.min(100, Math.round((actual / p.budgetAmount) * 100)) : 0;
          const projectTasks = tasks.filter((t) => t.projectId === p.id);
          const owner = agents.find((a) => a.id === p.ownerId);
          return (
            <Card key={p.id} className="cursor-pointer p-4 transition-colors hover:bg-muted/30" onClick={() => setSelectedId(p.id)}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{p.name}</p>
                <Badge className={cn('shrink-0 text-[10px] capitalize ring-1', PROJECT_STATUS_STYLE[p.status])}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description || 'No description yet.'}</p>
              <div className="mt-3">
                <Progress value={pct} className="h-1.5" />
                <p className="mt-1 text-[11px] text-muted-foreground">{money(actual)} / {money(p.budgetAmount)} spent</p>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{projectTasks.length} task{projectTasks.length === 1 ? '' : 's'}</span>
                {owner && <span>{owner.name}</span>}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Project name" />
            <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What is this project about?" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Owner</p>
                <Select value={form.ownerId} onValueChange={(v) => setForm((f) => ({ ...f, ownerId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {a.department}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Budget</p>
                <Input type="number" value={form.budgetAmount} onChange={(e) => setForm((f) => ({ ...f, budgetAmount: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Customer account</p>
              <SearchSelect
                options={[
                  { value: UNASSIGNED, label: 'None — internal project' },
                  ...customers.map((c) => ({ value: c.id, label: c.name, detail: c.industry })),
                ]}
                value={form.customerId || UNASSIGNED}
                onChange={(v) => setForm((f) => ({ ...f, customerId: v === UNASSIGNED ? '' : v }))}
                placeholder="None"
                searchPlaceholder="Search customers"
                clearable={false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createProject}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
