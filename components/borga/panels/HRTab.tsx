'use client';

import { useState, useMemo } from 'react';
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
  ChevronDown,
  ChevronRight,
  Network,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  formatStartedAt,
  toMonthInput,
  type Employee,
  type EmployeeStatus,
  type EmploymentType,
  type LeaveKind,
  type LeaveRequest,
} from '@/lib/borga/data';
import { fmtMoney } from '@/lib/borga/currencies';
import { EMAIL_RE } from '@/lib/borga/tickets';
import { toast } from '@/lib/toast-bus';
import { buildOrgTree, departmentTable, depthCounts, type OrgNode } from '@/lib/borga/org-chart';
import { useBorga } from '@/lib/borga/store';
import { AgentAvatar, SectionTitle } from '../bits';
import { DateInput, Field } from '../form-widgets';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<EmploymentType, string> = {
  'full-time': 'Full-time',
  'part-time': 'Part-time',
  contract: 'Contract',
};

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: 'Active',
  onboarding: 'Onboarding',
  'on-leave': 'On leave',
  offboarded: 'Offboarded',
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
  status: EmployeeStatus;
  performance: string;
  startedAt: string; // YYYY-MM month input
}

const EMPTY_FORM: EmployeeFormState = {
  name: '', role: '', department: '', email: '',
  employmentType: 'full-time', salary: '', location: '', manager: '',
  status: 'onboarding', performance: '75', startedAt: '',
};

/** Shared add/edit employee dialog used by the directory. */
function EmployeeDialog({
  open, onOpenChange, editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Employee | null;
}) {
  const { addEmployee, updateEmployee, employees, log, activeWorkspace } = useBorga();
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
            status: editing.status, performance: String(editing.performance ?? 75),
            startedAt: toMonthInput(editing.startedAt),
          }
        : EMPTY_FORM,
    );
  }

  const currency = activeWorkspace()?.currency ?? 'USD';
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();

  const submit = () => {
    if (!form.name.trim() || !form.role.trim()) return;
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) {
      toast({ title: 'Invalid email', description: 'Use a real address like jane@company.com — or leave it blank.', variant: 'warning' });
      return;
    }
    if (email && employees.some((e) => e.id !== editing?.id && e.email.toLowerCase() === email.toLowerCase())) {
      toast({ title: 'Email already in use', description: 'Another employee already has this address.', variant: 'warning' });
      return;
    }
    const salary = Number(form.salary);
    if (form.salary.trim() && (!Number.isFinite(salary) || salary < 0)) {
      toast({ title: 'Invalid salary', description: 'Salary must be zero or more.', variant: 'warning' });
      return;
    }
    const performance = Math.max(0, Math.min(100, Number(form.performance) || 0));
    const startedAt = form.startedAt.trim()
      ? formatStartedAt(form.startedAt.trim())
      : editing?.startedAt ?? new Date().toLocaleDateString([], { month: 'short', year: 'numeric' });
    if (editing) {
      updateEmployee(editing.id, {
        name: form.name.trim(),
        role: form.role.trim(),
        department: form.department.trim() || editing.department,
        email,
        employmentType: form.employmentType,
        salary: form.salary.trim() ? salary : editing.salary,
        location: form.location.trim(),
        manager: form.manager.trim() || undefined,
        status: form.status,
        performance,
        startedAt,
      });
      log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Employee record updated: ${form.name.trim()}.` });
    } else {
      addEmployee({
        id: `emp-${Date.now()}`,
        name: form.name.trim(),
        role: form.role.trim(),
        department: form.department.trim() || 'General',
        email,
        employmentType: form.employmentType,
        status: form.status,
        salary: form.salary.trim() ? salary : 0,
        location: form.location.trim() || 'Remote',
        startedAt,
        performance,
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
              <SearchSelect
                options={departments.map((d) => ({ value: d, label: d }))}
                value={form.department}
                onChange={(v) => setForm({ ...form, department: v })}
                placeholder="Design"
                searchPlaceholder="Search departments"
                allowCustom
                className="mt-1"
              />
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
            <SearchSelect
              options={[
                { value: '', label: 'No manager' },
                ...employees
                  .filter((e) => !editing || e.id !== editing.id)
                  .map((e) => ({ value: e.name, label: e.name, detail: e.department })),
              ]}
              value={form.manager}
              onChange={(v) => setForm({ ...form, manager: v })}
              placeholder="Manager name…"
              searchPlaceholder="Search team"
              allowCustom
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as EmployeeStatus })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABEL) as EmployeeStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Start date</label>
              <Input type="month" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} className="mt-1" />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Performance</label>
              <span className="text-xs font-semibold text-primary">{Math.max(0, Math.min(100, Number(form.performance) || 0))}/100</span>
            </div>
            <input
              type="range" min={0} max={100} step={5}
              value={Math.max(0, Math.min(100, Number(form.performance) || 0))}
              onChange={(e) => setForm({ ...form, performance: e.target.value })}
              className="w-full accent-primary"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
  const { employees, deleteEmployee, payrollRuns, createPayrollBatch, releasePayrollBatch, deletePayrollBatch, log, activeWorkspace } = useBorga();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [confirmDeleteEmployee, setConfirmDeleteEmployee] = useState<Employee | null>(null);
  const [query, setQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payMonth, setPayMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<string | null>(null);
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);
  const active = employees.filter((e) => e.status === 'active');
  const payroll = employees.filter((e) => e.status !== 'offboarded').reduce((s, e) => s + e.salary, 0);
  const departments = [...new Set(employees.map((e) => e.department))];

  const monthRun = payrollRuns.find((r) => r.monthKey === payMonth) ?? null;

  const prepareBatch = () => {
    const run = createPayrollBatch(payMonth);
    if (!run) toast({ title: 'Cannot prepare batch', description: 'That month is already released, or there is nobody active to pay.', variant: 'warning' });
  };

  const releaseBatch = (id: string) => {
    if (!releasePayrollBatch(id)) toast({ title: 'Release blocked', description: 'That month was already released.', variant: 'error' });
  };

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
            title={`Prepare and release the monthly payroll batch for ${active.length} employees`}
            onClick={() => setPayrollOpen(true)}
          >
            <Banknote className="h-4 w-4" /> Payroll
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
        <SearchSelect
          options={[
            { value: 'all', label: 'All departments' },
            ...departments.map((d) => ({ value: d, label: d })),
          ]}
          value={deptFilter}
          onChange={(v) => setDeptFilter(v || 'all')}
          placeholder="All departments"
          searchPlaceholder="Search departments"
          clearable={false}
          className="w-44"
        />
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
                      onClick={() => setConfirmDeleteEmployee(e)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">{employees.length > 0 ? 'No people match the filters.' : 'No employees yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <EmployeeDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      <ConfirmDialog
        open={!!confirmDeleteEmployee}
        onOpenChange={(o) => { if (!o) setConfirmDeleteEmployee(null); }}
        title={`Remove ${confirmDeleteEmployee?.name ?? 'employee'}?`}
        description="The employee record is deleted. Leave balances and timesheet rows lose their link and cannot be restored."
        confirmLabel="Remove employee"
        onConfirm={() => {
          if (!confirmDeleteEmployee) return;
          deleteEmployee(confirmDeleteEmployee.id);
          log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `${confirmDeleteEmployee.name} removed from the directory.` });
          setConfirmDeleteEmployee(null);
        }}
      />

      <Dialog open={payrollOpen} onOpenChange={setPayrollOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payroll batches</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground">Month</label>
                <Input type="month" value={payMonth} onChange={(e) => setPayMonth(e.target.value)} className="mt-1" />
              </div>
              {!monthRun && (
                <Button size="sm" onClick={prepareBatch} disabled={active.length === 0}>
                  <Plus className="h-3.5 w-3.5" /> Prepare batch
                </Button>
              )}
            </div>

            {monthRun ? (
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{monthRun.periodLabel}</p>
                    <p className="text-[11px] text-muted-foreground">{monthRun.lines.length} people · {money(monthRun.total)}</p>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] capitalize ring-1', monthRun.status === 'released' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-amber-500/10 text-amber-600 ring-amber-500/30')}>
                    {monthRun.status}
                  </Badge>
                </div>
                {monthRun.status === 'released' ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Released{monthRun.releasedAt ? ` ${new Date(monthRun.releasedAt).toLocaleString()}` : ''} — a month is paid exactly once, so this batch is locked.
                  </p>
                ) : (
                  <>
                    <div className="mt-3 max-h-44 space-y-1 overflow-y-auto">
                      {monthRun.lines.map((l) => (
                        <div key={l.employeeId} className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm">
                          <span className="truncate">{l.name}</span>
                          <span className="font-mono text-xs">{money(l.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button className="flex-1 gap-1.5" onClick={() => setConfirmRelease(monthRun.id)}>
                        <Banknote className="h-4 w-4" /> Release {money(monthRun.total)}
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        title="Discard draft batch"
                        onClick={() => deletePayrollBatch(monthRun.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No batch for this month yet. Prepare one to review per-person amounts before releasing.
              </p>
            )}

            {payrollRuns.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">History</p>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {payrollRuns.map((r) => (
                    <div key={r.id}>
                      <button
                        onClick={() => setExpandedRun((v) => (v === r.id ? null : r.id))}
                        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted/40"
                      >
                        <span className="font-mono text-[11px] text-muted-foreground">{r.monthKey}</span>
                        <span className="min-w-0 flex-1 truncate font-medium">{r.periodLabel}</span>
                        <Badge variant="outline" className={cn('text-[10px] capitalize ring-1', r.status === 'released' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-amber-500/10 text-amber-600 ring-amber-500/30')}>
                          {r.status}
                        </Badge>
                        <span className="font-mono text-xs">{money(r.total)}</span>
                      </button>
                      {expandedRun === r.id && (
                        <div className="ml-4 mt-1 space-y-1 border-l pl-3">
                          {r.lines.map((l) => (
                            <div key={l.employeeId} className="flex items-center justify-between text-xs">
                              <span className="truncate text-muted-foreground">{l.name}</span>
                              <span className="font-mono">{money(l.amount)}</span>
                            </div>
                          ))}
                          <p className="text-[10px] text-muted-foreground">
                            {r.status === 'released' ? `Released ${r.releasedAt ? new Date(r.releasedAt).toLocaleString() : ''}` : 'Draft — not yet posted.'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRelease}
        onOpenChange={(o) => { if (!o) setConfirmRelease(null); }}
        title={`Release payroll for ${payrollRuns.find((r) => r.id === confirmRelease)?.periodLabel ?? 'this month'}?`}
        description={`${money(payrollRuns.find((r) => r.id === confirmRelease)?.total ?? 0)} posts to the ledger and journal. Released months cannot be paid twice — this cannot be undone, void the entries instead.`}
        confirmLabel="Release batch"
        onConfirm={() => {
          if (confirmRelease) releaseBatch(confirmRelease);
          setConfirmRelease(null);
        }}
      />
    </div>
  );
}

// ─── Time Off ────────────────────────────────────────────────────────────────

export function HRTimeOffTab() {
  const { leaveRequests, setLeaveStatus, deleteLeaveRequest, addLeaveRequest, employees, log } = useBorga();
  const [confirmDeleteLeave, setConfirmDeleteLeave] = useState<LeaveRequest | null>(null);
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
    if (!emp || !form.from.trim()) return;
    addLeaveRequest({
      id: `lv-${Date.now()}`,
      employeeId: emp.id,
      employeeName: emp.name,
      kind: form.kind,
      from: form.from.trim(),
      to: form.to.trim() || form.from.trim(),
      days: Number(form.days) || 1,
      reason: form.reason.trim(),
      status: 'pending',
    });
    log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Leave request filed for ${emp.name}: ${LEAVE_KIND_LABEL[form.kind]} (${form.from.trim()}).` });
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
                  <button onClick={() => setConfirmDeleteLeave(l)} className="text-[10px] text-muted-foreground hover:text-destructive">
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
              <SearchSelect
                options={employees.map((e) => ({ value: e.id, label: e.name, detail: e.department }))}
                value={form.employeeId}
                onChange={(v) => setForm({ ...form, employeeId: v })}
                placeholder="Choose…"
                searchPlaceholder="Search team"
                clearable={false}
                className="mt-1"
              />
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
                <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Family trip" />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={!form.employeeId || !form.from.trim()}>Submit request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteLeave}
        onOpenChange={(o) => { if (!o) setConfirmDeleteLeave(null); }}
        title="Remove this leave request?"
        description={confirmDeleteLeave ? `The ${LEAVE_KIND_LABEL[confirmDeleteLeave.kind]} request for ${confirmDeleteLeave.employeeName} (${confirmDeleteLeave.from} → ${confirmDeleteLeave.to}) is removed permanently.` : ''}
        confirmLabel="Remove request"
        onConfirm={() => {
          if (!confirmDeleteLeave) return;
          deleteLeaveRequest(confirmDeleteLeave.id);
          log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Leave request for ${confirmDeleteLeave.employeeName} removed.` });
          setConfirmDeleteLeave(null);
        }}
      />
    </div>
  );
}

// ─── Teams ───────────────────────────────────────────────────────────────────

export function HRTeamsTab() {
  const { employees } = useBorga();

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

// ─── Organogram ──────────────────────────────────────────────────────────────

const DEPT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];

const deptColor = (dept: string) => {
  let h = 0;
  for (const c of dept) h = ((h * 31 + (c.codePointAt(0) ?? 0)) >>> 0);
  return DEPT_COLORS[h % DEPT_COLORS.length];
};

function OrgNodeView({ node, collapsed, onToggle }: { node: OrgNode; collapsed: Set<string>; onToggle: (id: string) => void }) {
  const e = node.employee;
  const isCollapsed = collapsed.has(e.id);
  return (
    <div>
      <div className="flex items-center gap-2.5 rounded-xl border bg-muted/20 px-3 py-2">
        {node.reports.length > 0 ? (
          <button
            onClick={() => onToggle(e.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title={isCollapsed ? `Expand ${e.name}'s team` : `Collapse ${e.name}'s team`}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <AgentAvatar name={e.name} color={deptColor(e.department)} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{e.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{e.role} · {e.department}</p>
        </div>
        {node.reports.length > 0 && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">{node.reports.length} report{node.reports.length === 1 ? '' : 's'}</Badge>
        )}
        <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize ring-1', EMPLOYEE_STATUS_STYLE[e.status])}>
          {e.status.replace('-', ' ')}
        </span>
      </div>
      {!isCollapsed && node.reports.length > 0 && (
        <div className="ml-5 mt-1.5 space-y-1.5 border-l pl-3">
          {node.reports.map((r) => (
            <OrgNodeView key={r.employee.id} node={r} collapsed={collapsed} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Company organogram: reporting tree from Board level to the front line, plus a department table with heads and members. */
export function HROrgChartTab() {
  const { employees } = useBorga();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const roots = useMemo(() => buildOrgTree(employees), [employees]);
  const rows = useMemo(() => departmentTable(employees), [employees]);
  const levels = useMemo(() => depthCounts(roots), [roots]);
  const rosterCount = levels.reduce((s, n) => s + n, 0);
  const managerCount = useMemo(() => {
    let n = 0;
    const walk = (nodes: OrgNode[]) => {
      for (const node of nodes) {
        if (node.reports.length) n++;
        walk(node.reports);
      }
    };
    walk(roots);
    return n;
  }, [roots]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Organogram" sub="Board to front line — built from each person's manager. People with no manager sit at the top, so add board members with no manager to start from the Board." />
        <Badge>
          <Network className="mr-1 h-3 w-3" /> {rosterCount} on chart · {levels.length} level{levels.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {roots.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No people on the chart yet{employees.length ? ' — everyone here is offboarded.' : ". Add employees in the Directory, then set each person's manager to grow the tree."}
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold">Reporting tree</p>
            <div className="max-w-2xl space-y-1.5">
              {roots.map((r) => (
                <OrgNodeView key={r.employee.id} node={r} collapsed={collapsed} onToggle={toggle} />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {managerCount} manager{managerCount === 1 ? '' : 's'} · offboarded people are out of the chart · set managers in the Directory to reshape the tree.
            </p>
          </Card>

          <Card className="overflow-hidden">
            <p className="border-b px-5 py-3 text-sm font-semibold">Departments — heads and members</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/20 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2 font-medium">Department</th>
                    <th className="px-4 py-2 font-medium">Head</th>
                    <th className="px-4 py-2 font-medium">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name} className="border-b align-top last:border-0">
                      <td className="px-5 py-3">
                        <p className="font-semibold">{row.name}</p>
                        <p className="text-[11px] text-muted-foreground">{row.members.length} member{row.members.length === 1 ? '' : 's'}</p>
                      </td>
                      <td className="px-4 py-3">
                        {row.head ? (
                          <div className="flex items-center gap-2">
                            <AgentAvatar name={row.head.name} color={deptColor(row.name)} size={24} />
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">{row.head.name}</p>
                              <p className="truncate text-[11px] text-muted-foreground">{row.head.role}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          {row.members.map((m) => (
                            <span key={m.id} className="flex items-center gap-1.5 text-xs">
                              <AgentAvatar name={m.name} color={deptColor(row.name)} size={20} />
                              <span className="font-medium">{m.name}</span>
                              <span className="text-muted-foreground">{m.role}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
