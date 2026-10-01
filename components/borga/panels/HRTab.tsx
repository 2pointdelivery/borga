'use client';

import { useState } from 'react';
import {
  Plus,
  Users,
  UserPlus,
  CalendarDays,
  Gauge,
  Trash2,
  Pencil,
  Check,
  X,
  Download,
  Search,
  Banknote,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
  EMPLOYEE_STATUS_STYLE,
  LEAVE_KIND_LABEL,
  computeLeaveBalance,
  type Employee,
  type EmploymentType,
  type LeaveKind,
  type LeaveRequest,
} from '@/lib/borga/data';
import { fmtMoney, fmtMoneyFull } from '@/lib/borga/currencies';
import { useBorga } from '@/lib/borga/store';
import { AgentAvatar, SectionTitle } from '../bits';
import { DateInput, Field } from '../form-widgets';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<EmploymentType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
};

interface EmployeeFormState {
  name: string;
  role: string;
  department: string;
  email: string;
  employmentType: EmploymentType;
  salary: string;
  location: string;
  manager: string;
}

const EMPTY_FORM: EmployeeFormState = {
  name: '', role: '', department: '', email: '',
  employmentType: 'full-time', salary: '', location: '', manager: '',
};

/** Shared add/edit employee dialog used by the directory. */
function EmployeeDialog({
  open, onOpenChange, editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Employee | null;
}) {
  const { addEmployee, updateEmployee, log, activeWorkspace } = useBorga();
  const [form, setForm] = useState<EmployeeFormState>(EMPTY_FORM);
  const [primedFor, setPrimedFor] = useState<Employee | null>(null);

  // Sync form when opened for a specific employee (or blank for a new hire).
  if (open && primedFor !== editing) {
    setPrimedFor(editing);
    setForm(
      editing
        ? {
            name: editing.name, role: editing.role, department: editing.department,
            email: editing.email, employmentType: editing.employmentType,
            salary: String(editing.salary), location: editing.location, manager: editing.manager ?? '',
          }
        : EMPTY_FORM,
    );
  }

  const currency = activeWorkspace()?.currency ?? 'USD';

  const submit = () => {
    if (!form.name.trim() || !form.role.trim()) return;
    if (editing) {
      updateEmployee(editing.id, {
        name: form.name.trim(),
        role: form.role.trim(),
        department: form.department.trim() || editing.department,
        email: form.email.trim(),
        employmentType: form.employmentType,
        salary: Number(form.salary) || editing.salary,
        location: form.location.trim(),
        manager: form.manager.trim() || undefined,
      });
      log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Employee record updated: ${form.name.trim()}.` });
    } else {
      addEmployee({
        id: `emp-${Date.now()}`,
        name: form.name.trim(),
        role: form.role.trim(),
        department: form.department.trim() || 'General',
        email: form.email.trim(),
        employmentType: form.employmentType,
        status: 'onboarding',
        salary: Number(form.salary) || 0,
        location: form.location.trim() || 'Remote',
        startedAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
        performance: 75,
        manager: form.manager.trim() || undefined,
      });
      log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `New hire added to HR records: ${form.name.trim()} — ${form.role.trim()}.` });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : 'Add employee'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Cooper" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Role</label>
              <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Product Designer" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Department</label>
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Design" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={form.employmentType} onValueChange={(v) => setForm({ ...form, employmentType: v as EmploymentType })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full-time">Full-time</SelectItem>
                  <SelectItem value="part-time">Part-time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Salary ({currency})</label>
              <Input type="number" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} placeholder="90000" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Location</label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Remote" className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reports to (optional)</label>
            <Input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} placeholder="Manager name" className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!form.name.trim() || !form.role.trim()}>
            {editing ? 'Save changes' : 'Add to directory'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Directory ───────────────────────────────────────────────────────────────

export function HRDirectoryTab() {
  const { employees, deleteEmployee, runPayroll, log, activeWorkspace } = useBorga();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const currency = activeWorkspace()?.currency ?? 'USD';
  const active = employees.filter((e) => e.status === 'active');
  const payroll = employees.filter((e) => e.status !== 'offboarded').reduce((s, e) => s + e.salary, 0);
  const departments = [...new Set(employees.map((e) => e.department))];

  const filtered = employees.filter((e) => {
    if (deptFilter !== 'all' && e.department !== deptFilter) return false;
    if (query && !`${e.name} ${e.role} ${e.department} ${e.location} ${e.email}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const exportCsv = () => {
    const rows = [
      ['name', 'role', 'department', 'email', 'type', 'status', 'salary', 'location', 'performance'],
      ...filtered.map((e) => [e.name, e.role, e.department, e.email, e.employmentType, e.status, String(e.salary), e.location, String(e.performance)]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `directory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'sync', message: `${filtered.length} directory records exported.` });
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Employee directory" sub={`${active.length} active of ${employees.length} — annual payroll ≈ ${fmtMoney(payroll, currency)}`} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={active.length === 0}
            title={`Books ${active.length} employees × monthly salary to the ledger and journal`}
            onClick={() => {
              const label = new Date().toLocaleDateString([], { month: 'long', year: 'numeric' });
              const total = Math.round(active.reduce((s, e) => s + e.salary / 12, 0));
              if (window.confirm(`Run payroll for ${label}? ${active.length} employees — total ${fmtMoneyFull(total, currency)} will post to the ledger and journal.`)) {
                runPayroll(label);
              }
            }}
          >
            <Banknote className="h-4 w-4" /> Run payroll
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add employee
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people…" className="pl-8" />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} shown</span>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Employee</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Department</th>
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Location</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Salary</th>
              <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Performance</th>
              <th className="w-16 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <AgentAvatar name={e.name} color="#6366f1" size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{e.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{e.role}</p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{e.department}</td>
                <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">{e.location}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', EMPLOYEE_STATUS_STYLE[e.status])}>
                    {e.status.replace('-', ' ')}
                  </span>
                </td>
                <td className="hidden px-4 py-2.5 text-right font-mono text-xs sm:table-cell">
                  {fmtMoney(e.salary, currency)}
                  <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{TYPE_LABEL[e.employmentType]}</span>
                </td>
                <td className="hidden px-4 py-2.5 xl:table-cell">
                  <div className="flex items-center gap-2">
                    <Progress value={e.performance} className="h-1.5 w-16" />
                    <span className="text-[11px] text-muted-foreground">{e.performance}%</span>
                  </div>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <button onClick={() => { setEditing(e); setDialogOpen(true); }} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => { deleteEmployee(e.id); log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `${e.name} removed from the directory.` }); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">{filtered.length === 0 && employees.length > 0 ? 'No people match the filters.' : 'No employees yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <EmployeeDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  );
}

// ─── Time Off ────────────────────────────────────────────────────────────────

export function HRTimeOffTab() {
  const { leaveRequests, setLeaveStatus, deleteLeaveRequest, addLeaveRequest, employees, log } = useBorga();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    employeeId: string;
    kind: LeaveKind;
    from: string;
    to: string;
    days: string;
    reason: string;
  }>({ employeeId: '', kind: 'vacation', from: '', to: '', days: '', reason: '' });

  const pending = leaveRequests.filter((l) => l.status === 'pending');
  const balances = new Map(employees.map((e) => [e.id, computeLeaveBalance(e, leaveRequests)]));
  const insufficient = (l: LeaveRequest) => l.kind !== 'unpaid' && (balances.get(l.employeeId)?.remaining ?? 0) < l.days;

  const submit = () => {
    const emp = employees.find((e) => e.id === form.employeeId);
    const name = emp?.name ?? form.employeeId.trim();
    if (!name || !form.from.trim()) return;
    addLeaveRequest({
      id: `lv-${Date.now()}`,
      employeeId: form.employeeId || `custom-${Date.now()}`,
      employeeName: name,
      kind: form.kind,
      from: form.from.trim(),
      to: form.to.trim() || form.from.trim(),
      days: Number(form.days) || 1,
      reason: form.reason.trim(),
      status: 'pending',
    });
    log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Leave request filed for ${name}: ${LEAVE_KIND_LABEL[form.kind]} (${form.from.trim()}).` });
    setForm({ employeeId: '', kind: 'vacation', from: '', to: '', days: '', reason: '' });
    setOpen(false);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Time off" sub={`${pending.length} request${pending.length === 1 ? '' : 's'} awaiting review`} />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> File request
        </Button>
      </div>

      <Card className="p-4">
        <div className="space-y-2.5">
          {leaveRequests.map((l) => (
            <div key={l.id} className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">{l.employeeName}</p>
                <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {LEAVE_KIND_LABEL[l.kind]}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{l.from} → {l.to} — {l.days}d — {l.reason}</p>
              {balances.has(l.employeeId) && (
                <p className={cn('mt-1 text-[10px] font-medium', insufficient(l) ? 'text-destructive' : 'text-muted-foreground')}>
                  Balance: {balances.get(l.employeeId)!.remaining}d remaining{insufficient(l) ? ' — insufficient for this request' : ''}
                </p>
              )}
              {l.status === 'pending' ? (
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" className="h-7 flex-1 gap-1" disabled={insufficient(l)} title={insufficient(l) ? 'Insufficient leave balance' : undefined} onClick={() => setLeaveStatus(l.id, 'approved')}>
                    <Check className="h-3 w-3" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 flex-1 gap-1" onClick={() => setLeaveStatus(l.id, 'rejected')}>
                    <X className="h-3 w-3" /> Reject
                  </Button>
                </div>
              ) : (
                <div className="mt-2 flex items-center justify-between">
                  <span className={cn(
                    'text-[10px] font-semibold capitalize',
                    l.status === 'approved' ? 'text-emerald-600' : 'text-rose-500',
                  )}>
                    {l.status}
                  </span>
                  <button onClick={() => deleteLeaveRequest(l.id)} className="text-[10px] text-muted-foreground hover:text-destructive">
                    remove
                  </button>
                </div>
              )}
            </div>
          ))}
          {leaveRequests.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">No leave requests.</p>
          )}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>File a leave request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Employee</label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Kind</label>
            <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as LeaveKind })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(LEAVE_KIND_LABEL) as LeaveKind[]).map((k) => (
                      <SelectItem key={k} value={k}>{LEAVE_KIND_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field label="From">
                <DateInput value={form.from} onChange={(v) => setForm({ ...form, from: v })} />
              </Field>
              <Field label="To">
                <DateInput value={form.to} onChange={(v) => setForm({ ...form, to: v })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Days">
                <Input type="number" min={1} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="1" />
              </Field>
              <Field label="Reason" className="col-span-2">
                <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Family trip" />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={!form.employeeId || !form.from.trim()}>Submit request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Teams ───────────────────────────────────────────────────────────────────

export function HRTeamsTab() {
  const { employees, log } = useBorga();

  const departments = [...new Set(employees.map((e) => e.department))];
  const avgPerf = employees.length
    ? Math.round(employees.reduce((s, e) => s + e.performance, 0) / employees.length)
    : 0;

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Teams & structure" sub={`${departments.length} departments — company average performance ${avgPerf}%`} />
        <Badge>
          <Users className="mr-1 h-3 w-3" /> {employees.filter((e) => e.status === 'active').length} active
        </Badge>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Users className="h-3.5 w-3.5" /> Total people</p>
          <p className="mt-1 text-xl font-semibold">{employees.length}</p>
        </Card>
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><UserPlus className="h-3.5 w-3.5" /> Onboarding</p>
          <p className="mt-1 text-xl font-semibold">{employees.filter((e) => e.status === 'onboarding').length}</p>
        </Card>
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> On leave today</p>
          <p className="mt-1 text-xl font-semibold">{employees.filter((e) => e.status === 'on-leave').length}</p>
        </Card>
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Gauge className="h-3.5 w-3.5" /> Avg. performance</p>
          <p className="mt-1 text-xl font-semibold">{avgPerf}%</p>
          <Progress value={avgPerf} className="mt-2 h-1.5" />
        </Card>
      </div>

      {/* Department cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {departments.map((d) => {
          const members = employees.filter((e) => e.department === d);
          const perf = members.length
            ? Math.round(members.reduce((s, e) => s + e.performance, 0) / members.length)
            : 0;
          void log;
          return (
            <Card key={d} className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{d}</p>
                <Badge variant="secondary" className="text-[10px]">{members.length} people</Badge>
              </div>
              <Progress value={perf} className="mt-3 h-1.5" />
              <p className="mt-1 text-[11px] text-muted-foreground">Avg. performance {perf}%</p>
              <div className="mt-3 space-y-2">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2.5">
                    <AgentAvatar name={m.name} color="#6366f1" size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{m.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{m.role}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ring-1', EMPLOYEE_STATUS_STYLE[m.status])}>
                      {m.status.replace('-', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
