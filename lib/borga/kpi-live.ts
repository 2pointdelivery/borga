/**
 * KPIs measured from the company's own records. Pure (no I/O).
 *
 * A KPI is only given a live value once the data behind it exists: a company with no deals has no win rate, and showing 0% would
 * score a brand-new company as failing. Everything here is a plain count or ratio of real records; anything that needs a survey or
 * an outside system (CSAT, NPS, uptime...) is left for the person to enter.
 */
import {
  deriveKpiOverrides,
  type AdCampaign,
  type BankAccount,
  type Customer,
  type Employee,
  type FinanceEntry,
  type Goal,
  type KnowledgeEntry,
  type KpiGroup,
  type KpiOverride,
  type Lead,
  type Task,
  type Workspace,
} from './data';
import { computeSla, isDoneStatus, policyFor, type TicketSettings, type TicketSummary } from './tickets';

export interface LiveKpiState {
  finance?: FinanceEntry[];
  leads?: Lead[];
  employees?: Employee[];
  knowledge?: KnowledgeEntry[];
  ws?: Workspace | null;
  tasks?: Task[];
  ads?: AdCampaign[];
  bankAccounts?: BankAccount[];
  goals?: Goal[];
  customers?: Customer[];
  tickets?: TicketSummary[];
  ticketSettings?: TicketSettings | null;
  /** The company's own revenue target (Finance → Revenue), used as the quota the pipeline is measured against. */
  revenueTarget?: number;
  nowMs?: number;
}

type Overrides = Record<string, Record<string, KpiOverride>>;

const DAY = 86_400_000;

export function deriveLiveKpis(state: LiveKpiState): Overrides {
  const now = state.nowMs ?? Date.now();
  const out = deriveKpiOverrides({ finance: state.finance, leads: state.leads, employees: state.employees, knowledge: state.knowledge, ws: state.ws });
  const set = (dept: string, label: string, value: number, unit?: string) => {
    if (!Number.isFinite(value)) return;
    (out[dept] ??= {})[label] = { value: Math.round(value * 100) / 100, unit, live: true };
  };
  const drop = (dept: string, label: string) => { if (out[dept]) delete out[dept][label]; };

  // The base derivation reports sums even for an empty book; with nothing recorded there is nothing measured.
  const fin = state.finance ?? [];
  const leads = state.leads ?? [];
  const emps = state.employees ?? [];
  if (fin.length === 0) { drop('finance', 'Revenue'); drop('finance', 'Burn Rate'); drop('finance', 'Gross Margin'); }
  if (leads.length === 0) { drop('sales', 'Deals Closed'); drop('sales', 'Win Rate'); drop('sales', 'Avg Deal Size'); }
  if (emps.length === 0) drop('people', 'Headcount');

  // Sales / marketing
  if (leads.length > 0) {
    const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
    const pipeline = open.reduce((s, l) => s + (l.value || 0), 0);
    if ((state.revenueTarget ?? 0) > 0) set('sales', 'Pipeline Coverage', (pipeline / (state.revenueTarget as number)) * 100, '%');
    const won = leads.filter((l) => l.stage === 'won').length;
    set('marketing', 'Conv. Rate', (won / leads.length) * 100, '%');
    const recent = leads.filter((l) => l.createdAt && now - new Date(l.createdAt).getTime() <= 30 * DAY);
    if (leads.some((l) => l.createdAt)) set('marketing', 'MQLs', recent.length, '');
  }
  const ads = state.ads ?? [];
  if (ads.length > 0) {
    set('marketing', 'Reach', ads.reduce((s, a) => s + (a.impressions || 0), 0), '');
    const spent = ads.reduce((s, a) => s + (a.spent || 0), 0);
    const wonDeals = leads.filter((l) => l.stage === 'won').length;
    if (spent > 0 && wonDeals > 0) set('marketing', 'CAC', spent / wonDeals, '$');
  }

  // Finance: months of cash at the current burn
  const accounts = (state.bankAccounts ?? []).filter((a) => a.status === 'connected');
  const burn = fin.filter((f) => f.kind === 'expense').reduce((s, f) => s + f.amount, 0);
  if (accounts.length > 0 && burn > 0) set('finance', 'Runway', accounts.reduce((s, a) => s + a.balance, 0) / burn, '');

  // Support: from the ticket desk
  const tickets = state.tickets ?? [];
  if (tickets.length > 0) {
    const done = tickets.filter((t) => isDoneStatus(t.status));
    const recentDone = done.filter((t) => t.resolvedAt && now - new Date(t.resolvedAt).getTime() <= 30 * DAY);
    set('support', 'Tickets Resolved', recentDone.length, '');
    const firsts = tickets
      .filter((t) => t.firstResponseAt)
      .map((t) => (new Date(t.firstResponseAt as string).getTime() - new Date(t.createdAt).getTime()) / 60_000)
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (firsts.length) set('support', 'FRT (min)', firsts.reduce((s, n) => s + n, 0) / firsts.length, '');
    if (state.ticketSettings && done.length > 0) {
      const met = done.filter((t) => {
        const s = computeSla(t, policyFor(t, state.ticketSettings as TicketSettings), (state.ticketSettings as TicketSettings).businessHours, now);
        return s.worst === 'met' || s.worst === 'running';
      }).length;
      set('support', 'SLA Met', (met / done.length) * 100, '%');
    }
  }

  // Delivery work
  const tasks = state.tasks ?? [];
  if (tasks.length > 0) {
    const doneTasks = tasks.filter((t) => t.status === 'done').length;
    set('engineering', 'Velocity', (doneTasks / tasks.length) * 100, '%');
    set('operations', 'Backlog', tasks.filter((t) => t.status !== 'done').length, '');
  }

  // People
  if (emps.length > 0) {
    set('people', 'Attrition', (emps.filter((e) => e.status === 'offboarded').length / emps.length) * 100, '%');
  }

  // Customers
  const customers = state.customers ?? [];
  const judged = customers.filter((c) => c.status === 'active' || c.status === 'churned');
  if (judged.length > 0) {
    const churned = judged.filter((c) => c.status === 'churned').length;
    set('product', 'Churn', (churned / judged.length) * 100, '%');
    set('product', 'Retention', ((judged.length - churned) / judged.length) * 100, '%');
    set('success', 'Renewal Rate', ((judged.length - churned) / judged.length) * 100, '%');
  }

  // Strategy
  const goals = state.goals ?? [];
  if (goals.length > 0) set('strategy', 'OKR Attain', goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length, '%');

  return out;
}

/**
 * The saved KPI set with the live values written in, so every reader of the saved set (health score, advisor, agents, reports) sees
 * the same numbers the KPI page shows. `changed` says whether anything differs, so the caller saves only then.
 * A KPI that was live but whose data is gone goes back to unmeasured.
 */
export function applyLiveKpis(groups: KpiGroup[], overrides: Overrides): { groups: KpiGroup[]; changed: boolean } {
  let changed = false;
  const next = groups.map((g) => ({
    ...g,
    kpis: g.kpis.map((k) => {
      const ov = overrides[g.id]?.[k.label];
      if (ov) {
        const unit = ov.unit ?? k.unit;
        if (k.live && k.valueSet && k.value === ov.value && k.unit === unit) return k;
        changed = true;
        return { ...k, value: ov.value, unit, live: true, valueSet: true };
      }
      if (k.live) {
        changed = true;
        return { ...k, value: 0, live: false, valueSet: false };
      }
      return k;
    }),
  }));
  return { groups: changed ? next : groups, changed };
}

/** Where a KPI's number comes from, for the card: filled from records, or entered by hand. */
export const LIVE_KPI_SOURCES: Record<string, Record<string, string>> = {
  sales: { 'Pipeline Coverage': 'deals', 'Win Rate': 'deals', 'Avg Deal Size': 'won deals', 'Deals Closed': 'deals' },
  marketing: { MQLs: 'deals', 'Conv. Rate': 'deals', Reach: 'ad campaigns', CAC: 'ad spend and won deals' },
  finance: { Revenue: 'finance entries', 'Burn Rate': 'finance entries', 'Gross Margin': 'finance entries', Runway: 'connected bank balances and burn' },
  support: { 'Tickets Resolved': 'tickets', 'FRT (min)': 'tickets', 'SLA Met': 'tickets' },
  engineering: { Velocity: 'tasks' },
  operations: { Backlog: 'tasks' },
  people: { Headcount: 'employees', Attrition: 'employees' },
  product: { Churn: 'customers', Retention: 'customers' },
  success: { 'Renewal Rate': 'customers' },
  strategy: { 'OKR Attain': 'goals', Valuation: 'finance and knowledge' },
};
