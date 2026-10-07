import { kpiAttainment, kpiMeasured, type Bill, type Employee, type Invoice, type KpiGroup, type Lead, type Project, type Task } from './data';

/**
 * The company health score. Pure (no I/O) so every rule is unit-tested.
 *
 * The score is built from the areas of the business that actually have data. An area with nothing to measure is left out and the
 * weights of the rest are scaled up to fill its place, so a company is never marked down for something it does not do (no ads, no
 * support desk, no staff records yet), and a brand-new company shows "not enough data" instead of a misleading zero.
 */

export interface HealthTicketCounts {
  /** Tickets not yet resolved. */
  unresolved: number;
  /** Of those, how many are past their SLA. */
  breached: number;
  /** All tickets ever (to know whether the Support Desk is in use). */
  total: number;
}

export interface HealthInput {
  finance: Array<{ kind: string; amount: number; voidedAt?: string }>;
  invoices: Invoice[];
  bills: Bill[];
  leads: Lead[];
  tasks: Task[];
  projects: Array<Pick<Project, 'id' | 'budgetAmount'> & { actualSpend?: number }>;
  employees: Employee[];
  ads: Array<{ spent: number; conversions: number }>;
  kpiGroups: KpiGroup[];
  tickets?: HealthTicketCounts | null;
  nowMs?: number;
}

export type HealthDimensionId = 'profitability' | 'collections' | 'sales' | 'delivery' | 'kpis' | 'support' | 'people' | 'marketing';

export interface HealthDimension {
  id: HealthDimensionId;
  name: string;
  weight: number;
  /** 0 to 100, or null when there is nothing to measure yet. */
  score: number | null;
  /** One line saying what the number is based on (or what is missing). */
  detail: string;
  /** Where to go to improve it. */
  link: { page: string; tab?: string };
}

export type HealthBand = 'strong' | 'healthy' | 'attention' | 'risk' | 'unknown';

export interface HealthResult {
  /** 0 to 100, or null when fewer than two areas can be measured. */
  score: number | null;
  band: HealthBand;
  label: string;
  dimensions: HealthDimension[];
  measured: number;
  /** The measured area pulling the score down most, if any is below 65. */
  weakest: HealthDimension | null;
}

const WEIGHTS: Record<HealthDimensionId, number> = { profitability: 25, collections: 20, sales: 15, delivery: 15, kpis: 15, support: 10, people: 10, marketing: 5 };
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const pct = (n: number) => `${Math.round(n)}%`;
const DAY = 86_400_000;

/** A due date only when it is a real date; free text such as "This week" is not one. */
function dueMs(due: string | undefined): number | null {
  if (!due || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
  const ms = Date.parse(due.slice(0, 10) + 'T23:59:59Z');
  return Number.isFinite(ms) ? ms : null;
}

export const HEALTH_BANDS: Array<{ min: number; band: HealthBand; label: string }> = [
  { min: 80, band: 'strong', label: 'Strong' },
  { min: 65, band: 'healthy', label: 'Healthy' },
  { min: 50, band: 'attention', label: 'Needs attention' },
  { min: 0, band: 'risk', label: 'At risk' },
];

export function computeHealth(i: HealthInput): HealthResult {
  const now = i.nowMs ?? Date.now();
  const dims: HealthDimension[] = [];
  const add = (id: HealthDimensionId, name: string, score: number | null, detail: string, link: HealthDimension['link']) =>
    dims.push({ id, name, weight: WEIGHTS[id], score: score === null ? null : Math.round(clamp(score)), detail, link });

  // Profitability: margin on recorded revenue and expenses. -30% scores 0, +30% scores 100.
  {
    const revenue = i.finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
    const expenses = i.finance.filter((f) => f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
    if (revenue + expenses > 0) {
      const margin = revenue > 0 ? (revenue - expenses) / revenue : -1;
      add('profitability', 'Profitability', ((margin + 0.3) / 0.6) * 100, revenue > 0 ? `Margin ${pct(margin * 100)} on recorded revenue and expenses` : 'Expenses recorded but no revenue yet', { page: 'finance', tab: 'ledger' });
    } else add('profitability', 'Profitability', null, 'Record revenue and expenses in the Ledger', { page: 'finance', tab: 'ledger' });
  }

  // Cash and collections: how much of what customers owe, and what we owe suppliers, is overdue.
  {
    const sent = i.invoices.filter((x) => !x.voidedAt && (x.status === 'sent' || x.status === 'overdue'));
    const paid = i.invoices.filter((x) => !x.voidedAt && x.status === 'paid').length;
    const overdueInv = sent.filter((x) => (dueMs(x.due) ?? Infinity) < now);
    const owed = sent.reduce((s, x) => s + x.amount, 0);
    const owedLate = overdueInv.reduce((s, x) => s + x.amount, 0);
    const openBills = i.bills.filter((b) => b.status !== 'paid' && !(b as { voidedAt?: string }).voidedAt);
    const lateBills = openBills.filter((b) => (dueMs(b.due) ?? Infinity) < now);
    const parts: number[] = [];
    const notes: string[] = [];
    if (sent.length || paid) {
      const ratio = owed > 0 ? owedLate / owed : 0;
      parts.push((1 - ratio) * 100);
      notes.push(sent.length ? `${pct(ratio * 100)} of what customers owe is overdue (${overdueInv.length} of ${sent.length} invoices)` : 'every invoice is paid');
    }
    if (openBills.length) {
      const ratio = lateBills.length / openBills.length;
      parts.push((1 - ratio) * 100);
      notes.push(`${lateBills.length} of ${openBills.length} bills to pay are overdue`);
    }
    add('collections', 'Cash & collections', parts.length ? parts.reduce((s, n) => s + n, 0) / parts.length : null, notes.join('; ') || 'Send invoices and record bills', { page: 'sales', tab: 'invoices' });
  }

  // Sales: win rate among deals that were decided (open deals are not losses). 40% scores 100.
  {
    const won = i.leads.filter((l) => l.stage === 'won').length;
    const lost = i.leads.filter((l) => l.stage === 'lost').length;
    if (won + lost > 0) add('sales', 'Sales', (won / (won + lost) / 0.4) * 100, `Won ${won} of ${won + lost} decided deals (${pct((won / (won + lost)) * 100)})`, { page: 'sales', tab: 'pipeline' });
    else add('sales', 'Sales', null, 'Win or lose a deal in the pipeline', { page: 'sales', tab: 'pipeline' });
  }

  // Delivery: tasks finished, and open tasks past a real due date; projects over budget cost points.
  {
    if (i.tasks.length) {
      const done = i.tasks.filter((t) => t.status === 'done').length;
      const open = i.tasks.filter((t) => t.status !== 'done');
      const late = open.filter((t) => (dueMs(t.due) ?? Infinity) < now).length;
      const over = i.projects.filter((p) => p.budgetAmount > 0 && (p.actualSpend ?? 0) > p.budgetAmount).length;
      const lateShare = open.length ? late / open.length : 0;
      const score = (0.6 * (done / i.tasks.length) + 0.4 * (1 - lateShare)) * 100 - Math.min(30, over * 10);
      add('delivery', 'Delivery', score, `${done} of ${i.tasks.length} tasks done, ${late} overdue${over ? `, ${over} project${over === 1 ? '' : 's'} over budget` : ''}`, { page: 'projects' });
    } else add('delivery', 'Delivery', null, 'Add tasks to your projects', { page: 'projects' });
  }

  // KPIs: how close the measured KPIs are to their targets.
  {
    const scored = i.kpiGroups.flatMap((g) => g.kpis).filter((k) => kpiMeasured(k)).map((k) => kpiAttainment(k)).filter((n): n is number => n !== null);
    if (scored.length >= 2) add('kpis', 'KPIs', scored.reduce((s, n) => s + n, 0) / scored.length, `${scored.length} measured KPIs average ${pct(scored.reduce((s, n) => s + n, 0) / scored.length)} of target`, { page: 'overview', tab: 'kpis' });
    else add('kpis', 'KPIs', null, 'Enter values for at least two KPIs', { page: 'overview', tab: 'kpis' });
  }

  // Support: tickets past their SLA, out of those still open.
  {
    const t = i.tickets;
    if (t && t.total > 0) {
      const share = t.unresolved ? t.breached / t.unresolved : 0;
      add('support', 'Support', (1 - share) * 100, t.unresolved ? `${t.breached} of ${t.unresolved} open tickets are past their SLA` : 'No open tickets', { page: 'support', tab: 'tickets' });
    } else add('support', 'Support', null, 'No support tickets yet', { page: 'support', tab: 'tickets' });
  }

  // People: average performance rating of the team.
  {
    const staff = i.employees.filter((e) => e.status !== 'offboarded' && e.performance > 0);
    if (staff.length) add('people', 'People', staff.reduce((s, e) => s + e.performance, 0) / staff.length, `Average performance ${pct(staff.reduce((s, e) => s + e.performance, 0) / staff.length)} across ${staff.length} ${staff.length === 1 ? 'person' : 'people'}`, { page: 'hr', tab: 'directory' });
    else add('people', 'People', null, 'Add performance ratings in the HR directory', { page: 'hr', tab: 'directory' });
  }

  // Marketing: paid conversions per 1,000 of ad spend (5 or more scores 100). Only when ads are running.
  {
    const spend = i.ads.reduce((s, a) => s + a.spent, 0);
    const conversions = i.ads.reduce((s, a) => s + a.conversions, 0);
    if (spend > 0) add('marketing', 'Marketing', (conversions / (spend / 1000) / 5) * 100, `${conversions} conversions on ${Math.round(spend).toLocaleString()} of ad spend`, { page: 'marketing', tab: 'advertising' });
    else add('marketing', 'Marketing', null, 'No paid ads running', { page: 'marketing', tab: 'advertising' });
  }

  const measured = dims.filter((d) => d.score !== null);
  if (measured.length < 2) return { score: null, band: 'unknown', label: 'Not enough data yet', dimensions: dims, measured: measured.length, weakest: null };
  const weight = measured.reduce((s, d) => s + d.weight, 0);
  const score = Math.round(measured.reduce((s, d) => s + d.weight * (d.score as number), 0) / weight);
  const found = HEALTH_BANDS.find((b) => score >= b.min)!;
  const weakest = measured.filter((d) => (d.score as number) < 65).sort((a, b) => (a.score as number) - (b.score as number))[0] ?? null;
  return { score, band: found.band, label: found.label, dimensions: dims, measured: measured.length, weakest };
}
