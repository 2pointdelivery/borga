'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useState, useCallback } from 'react';
import { Plus, Trash2, ArrowLeft, CheckSquare, Receipt, LayoutGrid, GripVertical, CalendarClock, Users, X, Check } from 'lucide-react';
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
import { cn } from '@/lib/utils';

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on-hold', 'completed', 'cancelled'];
const UNASSIGNED = '__none__';
const NO_ACCOUNT = '__none__';
const TASK_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

export function ProjectsTab({ initialProjectId }: { initialProjectId?: string } = {}) {
  const {
    projects, addProject, updateProject, deleteProject,
    tasks, addTask, updateTask, deleteTask,
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
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState({ title: '', dueDateIso: '' });
  const [addMemberId, setAddMemberId] = useState('');
  const expenseAccounts = coa.filter((a) => a.type === 'expense' || a.type === 'cost');

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
    deleteProject(p.id);
    if (selectedId === p.id) setSelectedId(null);
    log({ agentId: 'a-pm', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Project "${p.name}" deleted (linked tasks and expenses were unlinked, not removed).` });
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
      due: '…',
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

  const deleteMilestone = (id: string) => {
    if (!selected) return;
    updateProject(selected.id, { milestones: (selected.milestones ?? []).filter((x) => x.id !== id) });
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
    const projectExpenses = finance.filter((f) => f.projectId === selected.id);
    // "Certified" payments — vendor bills approved for payment or settled against
    // this project (scheduled/paid), as opposed to a bill merely recorded as unpaid.
    const projectBills = bills.filter((b) => b.projectId === selected.id);
    const certifiedPayments = projectBills.filter((b) => b.status === 'scheduled' || b.status === 'paid');
    const actual = computeProjectActualSpend(finance, selected.id);
    const pct = selected.budgetAmount > 0 ? Math.min(100, Math.round((actual / selected.budgetAmount) * 100)) : 0;
    const todo = projectTasks.filter((t) => t.status === 'todo').length;
    const inProgress = projectTasks.filter((t) => t.status === 'in-progress').length;
    const done = projectTasks.filter((t) => t.status === 'done').length;

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
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <Badge className={cn('text-[10px] capitalize ring-1', PROJECT_STATUS_STYLE[selected.status])}>{PROJECT_STATUS_LABEL[selected.status]}</Badge>
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{selected.description || 'No description yet.'}</p>
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
            <Select
              value={selected.customerId || UNASSIGNED}
              onValueChange={(v) => updateProject(selected.id, { customerId: v === UNASSIGNED ? undefined : v })}
            >
              <SelectTrigger className="mt-1 w-64"><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>None — internal project</SelectItem>
                {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
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
                        <button onClick={() => deleteMilestone(m.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
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
                <Select value={addMemberId} onValueChange={setAddMemberId}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Add a team member…" /></SelectTrigger>
                  <SelectContent>
                    {agents.filter((a) => !(selected.teamAgentIds ?? []).includes(a.id)).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} — {a.role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Receipt className="h-4 w-4" /> Linked expenses</p>
              <div className="mb-3 grid grid-cols-[1fr_1fr_110px_40px] gap-2">
                <Input
                  value={expenseDraft.label}
                  onChange={(e) => setExpenseDraft((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Expense description…"
                />
                <Select value={expenseDraft.accountId || NO_ACCOUNT} onValueChange={(v) => setExpenseDraft((f) => ({ ...f, accountId: v === NO_ACCOUNT ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="GL account" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
                    {expenseAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
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
        </Tabs>

        <TaskEditDialog task={editTask} open={!!editTask} onOpenChange={(o) => !o && setEditTask(null)} />
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
              <Select value={form.customerId || UNASSIGNED} onValueChange={(v) => setForm((f) => ({ ...f, customerId: v === UNASSIGNED ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>None — internal project</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
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
