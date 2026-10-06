'use client';
import { fmtMoney } from '@/lib/borga/currencies';

import { useMemo } from 'react';
import {
  TrendingUp,
  Users,
  DollarSign,
  Megaphone,
  HandCoins,
  Target,
  FolderKanban,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useBorga } from '@/lib/borga/store';
import { agentStatusNow } from '@/lib/borga/agent-status';
import { computeProjectActualSpend, PROJECT_STATUS_LABEL, type ProjectStatus } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

export function AnalyticsTab() {
  const {
    leads, finance, ads, posts, employees, fundraising, agents,
    messages, calls, projects, tasks, bills, activeWorkspace,
  } = useBorga();
  const agentBusy = useBorga((s) => s.agentBusy);

  const revenue = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const expenses = finance.filter((f) => f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const pipelineValue = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').reduce((s, l) => s + l.value, 0);
  const wonValue = leads.filter((l) => l.stage === 'won').reduce((s, l) => s + l.value, 0);
  const adSpend = ads.reduce((s, a) => s + a.spent, 0);
  const adConversions = ads.reduce((s, a) => s + a.conversions, 0);
  const headcount = employees.filter((e) => e.status !== 'offboarded').length;
  const fundsRaised = fundraising.filter((f) => f.stage === 'won').length;

  // Project delivery — derived entirely from the live projects, their linked
  // tasks/expenses and vendor bills. No fabricated progress or timeline data.
  const projectStats = useMemo(() => {
    const spendOf = (id: string) => computeProjectActualSpend(finance, id);
    const projectTasks = tasks.filter((t) => t.projectId);
    const doneTasks = projectTasks.filter((t) => t.status === 'done').length;
    const portfolioBudget = projects.reduce((s, p) => s + p.budgetAmount, 0);
    const portfolioActual = projects.reduce((s, p) => s + spendOf(p.id), 0);
    const byStatus = (['planning', 'active', 'on-hold', 'completed', 'cancelled'] as ProjectStatus[])
      .map((s) => ({ status: s, label: PROJECT_STATUS_LABEL[s], count: projects.filter((p) => p.status === s).length }))
      .filter((s) => s.count > 0);
    const spendByProject = projects
      .map((p) => ({ name: p.name, budget: p.budgetAmount, actual: spendOf(p.id) }))
      .sort((a, b) => b.actual - a.actual)
      .slice(0, 6);
    const overBudget = projects.filter((p) => p.budgetAmount > 0 && spendOf(p.id) > p.budgetAmount);
    const certified = bills
      .filter((b) => b.projectId && (b.status === 'scheduled' || b.status === 'paid'))
      .reduce((s, b) => s + b.amount, 0);
    return {
      portfolioBudget, portfolioActual, spendByProject, byStatus, overBudget, certified,
      taskCount: projectTasks.length,
      doneTasks,
      taskCompletion: projectTasks.length ? Math.round((doneTasks / projectTasks.length) * 100) : 0,
      active: projects.filter((p) => p.status === 'active').length,
      completed: projects.filter((p) => p.status === 'completed').length,
    };
  }, [projects, tasks, finance, bills]);

  const funnel = useMemo(() => {
    const stages = ['new', 'qualified', 'proposal', 'won'] as const;
    return stages.map((s) => ({
      stage: s.charAt(0).toUpperCase() + s.slice(1),
      count: leads.filter((l) => l.stage === s).length,
      value: leads.filter((l) => l.stage === s).reduce((sum, l) => sum + l.value, 0),
    }));
  }, [leads]);

  const engagement = useMemo(
    () =>
      posts.map((p) => ({
        name: p.channel,
        score: p.engagement.likes + p.engagement.comments * 2 + p.engagement.shares * 3,
      })),
    [posts],
  );

  // The four real inputs behind the health score, each already 0-1 normalized —
  // exposed as their own chart below instead of a fabricated weekly time series
  // (this app doesn't persist historical snapshots to plot a real trend yet).
  const healthDimensions = useMemo(() => {
    const margin = revenue ? (revenue - expenses) / revenue : 0;
    const winRate = leads.length ? leads.filter((l) => l.stage === 'won').length / leads.length : 0;
    const roas = adSpend ? adConversions / (adSpend / 1000) : 0;
    const perf = employees.length
      ? employees.reduce((s, e) => s + e.performance, 0) / (employees.length * 100)
      : 0;
    return [
      { name: 'Margin', score: Math.round(Math.max(0, Math.min(100, margin * 100))) },
      { name: 'Win rate', score: Math.round(winRate * 100) },
      { name: 'Conversions / $1k', score: Math.round(Math.min(1, roas / 5) * 100) },
      { name: 'Team perf.', score: Math.round(perf * 100) },
    ];
  }, [revenue, expenses, leads, adSpend, adConversions, employees]);

  const healthScore = useMemo(() => {
    const [margin, winRate, roas, perf] = healthDimensions.map((d) => d.score / 100);
    return Math.round(Math.min(100, margin * 40 + winRate * 25 + roas * 15 + perf * 20));
  }, [healthDimensions]);

  const money = (n: number) => fmtMoney(n, activeWorkspace()?.currency ?? 'USD');

  const cards: Array<{ label: string; value: string; sub?: string; icon: typeof DollarSign; color: string }> = [
    { label: 'Revenue to date', value: money(revenue), icon: DollarSign, color: 'text-emerald-600' },
    { label: 'Open pipeline', value: money(pipelineValue), icon: Target, color: 'text-sky-600' },
    { label: 'Ad spend', value: money(adSpend), sub: `${adConversions} conversions`, icon: Megaphone, color: 'text-violet-600' },
    { label: 'Headcount', value: String(headcount), icon: Users, color: 'text-amber-600' },
    { label: 'Active projects', value: String(projectStats.active), sub: `${projects.length} total`, icon: FolderKanban, color: 'text-rose-600' },
    { label: 'Funding wins', value: String(fundsRaised), icon: HandCoins, color: 'text-teal-600' },
    { label: 'Messages & calls', value: String(messages.length + calls.length), icon: TrendingUp, color: 'text-indigo-600' },
  ];

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Analytics" sub={`Cross-module intelligence for ${activeWorkspace()?.name ?? 'the workspace'}`} />
        <Badge className={cn(healthScore >= 70 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
          Company health {healthScore}/100
        </Badge>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Icon className={cn('h-3.5 w-3.5', c.color)} /> {c.label}
              </p>
              <p className="mt-1 truncate text-lg font-semibold">{c.value}</p>
              {c.sub && <p className="truncate text-[10px] text-muted-foreground">{c.sub}</p>}
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Momentum */}
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <SectionTitle title="Company momentum" sub="What's driving the health score right now, by dimension" />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={healthDimensions} margin={{ left: -18, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${v}%`, 'Score']} />
                <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                  {healthDimensions.map((d) => (
                    <Cell key={d.name} fill={d.score >= 70 ? 'var(--chart-2)' : d.score >= 40 ? 'var(--chart-3)' : 'var(--chart-1)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Health gauge */}
        <Card className="flex flex-col items-center justify-center p-5">
          <SectionTitle title="Health score" sub="Weighted across four dimensions" />
          <div className="relative mt-2 h-44 w-44">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="70%"
                outerRadius="100%"
                data={[{ name: 'score', value: healthScore, fill: healthScore >= 70 ? '#059669' : '#d97706' }]}
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={12} background={{ fill: 'var(--muted)' }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-3xl font-bold">{healthScore}</span>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">Weights — Margin 40% · Win rate 25% · Conversions 15% · People 20%</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Funnel */}
        <Card className="p-5">
          <SectionTitle title="Sales funnel" sub={`${money(wonValue)} closed-won to date`} />
          <div className="mt-4 space-y-3">
            {funnel.map((f, i) => {
              const max = Math.max(...funnel.map((x) => x.count), 1);
              return (
                <div key={f.stage}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">{f.stage}</span>
                    <span className="text-muted-foreground">{f.count} deals — {money(f.value)}</span>
                  </div>
                  <Progress value={(f.count / max) * 100} className="h-2" style={{ opacity: 1 - i * 0.15 }} />
                </div>
              );
            })}
          </div>
        </Card>

        {/* Engagement by channel */}
        <Card className="p-5">
          <SectionTitle title="Content engagement" sub="Weighted likes + comments + shares per channel" />
          <div className="mt-4 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="22%"
                outerRadius="98%"
                data={engagement.map((e, i) => ({
                  ...e,
                  fill: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'][i % 5],
                }))}
                startAngle={180}
                endAngle={-180}
              >
                <PolarAngleAxis type="number" domain={[0, Math.max(...engagement.map((e) => e.score), 10)]} tick={false} />
                <RadialBar dataKey="score" cornerRadius={6} background={{ fill: 'var(--muted)' }} legendType="none" />
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {engagement.map((e, i) => (
              <span key={e.name} className="flex items-center gap-1 capitalize">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'][i % 5] }}
                />
                {e.name}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Project delivery analytics */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="Project delivery" sub={`${projects.length} project${projects.length === 1 ? '' : 's'} — ${money(projectStats.portfolioActual)} of ${money(projectStats.portfolioBudget)} budget spent`} />
          <Badge className={cn(projectStats.taskCompletion >= 70 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
            {projectStats.taskCompletion}% tasks complete
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Active', value: String(projectStats.active), icon: FolderKanban, color: 'text-emerald-600' },
            { label: 'Completed', value: String(projectStats.completed), icon: CheckSquare, color: 'text-violet-600' },
            { label: 'Tasks done', value: `${projectStats.doneTasks}/${projectStats.taskCount}`, icon: CheckSquare, color: 'text-sky-600' },
            { label: 'Over budget', value: String(projectStats.overBudget.length), icon: AlertTriangle, color: projectStats.overBudget.length ? 'text-rose-600' : 'text-muted-foreground' },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="p-3">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className={cn('h-3.5 w-3.5', s.color)} /> {s.label}</p>
                <p className="mt-1 text-lg font-semibold">{s.value}</p>
              </Card>
            );
          })}
        </div>

        {projects.length === 0 ? (
          <p className="mt-4 py-6 text-center text-xs text-muted-foreground">No projects yet — create one on the Projects page to see delivery analytics here.</p>
        ) : (
          <>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={projectStats.spendByProject} margin={{ left: -18, right: 4, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} interval={0} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => money(v)} />
                  <Bar dataKey="budget" name="Budget" fill="var(--chart-4)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="actual" name="Actual" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: 'var(--chart-4)' }} />Budget</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: 'var(--chart-2)' }} />Actual spend</span>
              <span>Certified project payments {money(projectStats.certified)}</span>
              {projectStats.overBudget.length > 0 && (
                <span className="text-rose-500">Over budget: {projectStats.overBudget.map((p) => p.name).join(', ')}</span>
              )}
            </div>
          </>
        )}
      </Card>

      {/* AI insight footer */}
      <Card className="border-dashed p-4">
        <p className="text-xs font-semibold text-primary">Borga&apos;s read</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pipeline is {pipelineValue >= revenue ? 'outpacing' : 'trailing'} booked revenue at {money(pipelineValue)} open.
          Marketing converted {adConversions} paid conversions on {money(adSpend)} spend, while the fleet runs{' '}
          {agents.filter((a) => agentStatusNow(a, agentBusy) === 'active').length}/{agents.length} agents working.
          {(revenue - expenses) > 0
            ? ` Net cash position is positive at ${money(revenue - expenses)}.`
            : ' Watch burn — expenses exceed booked revenue this period.'}
        </p>
      </Card>
    </div>
  );
}
