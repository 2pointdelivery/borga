// Cross-module business intelligence engine.
// Scans every module (finance, AR/AP, sales pipeline, HR, banking, journal,
// goals, vendors, customers, projects, delivery tasks, support desk, inventory,
// marketing) and derives insights that feed the AI agents' context so they
// continuously learn how the business is actually performing.
import type {
  FinanceEntry, Invoice, Bill, Vendor, Customer, Lead, Goal,
  JournalEntry, BankTxn, BankAccount, Employee, AgentMemory,
  KnowledgeEntry, KnowledgeCategoryId, Project, Task, AdCampaign,
  ChatThread, CallRecord, LeaveRequest, FundingOpportunity,
  KpiGroup, RevenueTrack, Budget, Webhook, McpServer, SocialPost,
} from './data';
import { kpiMeasured, kpiAttainment } from './data';
import type { FilingsState } from './filing-catalog';
import type { InventoryItem, StockMovement } from './inventory';
import { totalOnHand } from './inventory';

export type InsightSeverity = 'positive' | 'info' | 'watch' | 'critical';

export interface BusinessInsight {
  id: string;
  area: 'cashflow' | 'receivables' | 'payables' | 'sales' | 'hr' | 'accounting' | 'goals' | 'vendors' | 'projects' | 'support' | 'inventory' | 'marketing'
    | 'communications' | 'automation' | 'company' | 'banking' | 'compliance' | 'kpis' | 'integrations';
  severity: InsightSeverity;
  title: string;
  detail: string;
  metric?: string;
  action: string;
  agentId: string;
  /** Where the owner can act on it — the advisory widget turns this into an "Open" button. */
  link?: { page: string; tab?: string };
}

/** Precomputed support-desk roll-up (the ticket store lives behind its own API, so callers summarise it). */
export interface SupportSummary {
  active: number;
  breached: number;
  atRisk: number;
  unassigned: number;
  compliance: number | null;
}

export interface InsightInput {
  finance: FinanceEntry[];
  invoices: Invoice[];
  bills: Bill[];
  vendors: Vendor[];
  customers: Customer[];
  leads: Lead[];
  goals: Goal[];
  journals: JournalEntry[];
  bankTxns: BankTxn[];
  bankAccounts: BankAccount[];
  employees: Employee[];
  projects?: Project[];
  tasks?: Task[];
  ads?: AdCampaign[];
  inventoryItems?: InventoryItem[];
  stockMovements?: StockMovement[];
  support?: SupportSummary;
  // ── Full-menu coverage (all optional so older callers keep working) ──
  /** Comms: threads waiting on a reply + recent call outcomes. */
  chats?: ChatThread[];
  calls?: CallRecord[];
  /** HR: leave requests awaiting a decision. */
  leaveRequests?: LeaveRequest[];
  /** Company: open funding opportunities + knowledge-base depth. */
  fundraising?: FundingOpportunity[];
  knowledge?: KnowledgeEntry[];
  kbOpenQuestions?: number;
  /** AI platform: live run-queue health (queued/running/failed) + scheduler. */
  runsSummary?: { queued?: number; running?: number; failed?: number; scheduledActive?: number };
  /** Finance ops: unmatched bank lines, revenue-vs-target, budgets, filings. */
  revenueTracks?: RevenueTrack[];
  budgets?: Budget[];
  filings?: FilingsState;
  /** Marketing: scheduled/draft social posts waiting to go out. */
  posts?: SocialPost[];
  /** Developers/integrations: webhooks + MCP servers needing attention. */
  webhooks?: Webhook[];
  mcpServers?: McpServer[];
  /** Overview: measured KPIs and their attainment. */
  kpiGroups?: KpiGroup[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Shared runway math — kept out of component bodies so render stays pure. */
export function computeCashRunway(
  finance: Pick<FinanceEntry, 'kind' | 'amount' | 'dateIso' | 'voidedAt'>[],
  bankAccounts: { balance: number }[],
): { cash: number; monthlyBurn: number; months: number } {
  const cash = bankAccounts.reduce((s, b) => s + b.balance, 0);
  const cut = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const burn = finance
    .filter((f) => f.kind === 'expense' && !f.voidedAt && (!f.dateIso || f.dateIso >= cut))
    .reduce((s, f) => s + f.amount, 0) / 3;
  return { cash, monthlyBurn: burn, months: burn > 0 ? cash / burn : Infinity };
}

export function deriveBusinessInsights(input: InsightInput): BusinessInsight[] {
  const out: BusinessInsight[] = [];
  const { finance, invoices, bills, vendors, leads, goals, journals, bankAccounts, employees } = input;
  const now = Date.now();

  // ── Cashflow ──────────────────────────────────────────────────────────────
  const cash = bankAccounts.reduce((s, b) => s + b.balance, 0);
  const monthlyBurn = (() => {
    const cut = new Date(now - 90 * 86400000).toISOString().slice(0, 10);
    const exp = finance.filter((f) => f.kind === 'expense' && !f.voidedAt && (!f.dateIso || f.dateIso >= cut));
    const rev = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt && (!f.dateIso || f.dateIso >= cut));
    const burn = exp.reduce((s, f) => s + f.amount, 0) / 3;
    const inflow = rev.reduce((s, f) => s + f.amount, 0) / 3;
    return { burn, net: inflow - burn };
  })();
  if (monthlyBurn.burn > 0 && cash > 0) {
    const runway = cash / (monthlyBurn.burn - Math.max(0, monthlyBurn.net));
    out.push({
      id: 'in-cash-runway',
      area: 'cashflow',
      severity: runway < 6 ? 'critical' : runway < 12 ? 'watch' : 'positive',
      title: `Cash runway ≈ ${runway.toFixed(1)} months`,
      detail: `Average cash ${money(cash)} against ~${money(monthlyBurn.burn)}/mo burn (net ${monthlyBurn.net >= 0 ? '+' : ''}${money(monthlyBurn.net)}/mo).`,
      metric: `${runway.toFixed(1)} mo`,
      action: runway < 6 ? 'Accelerate collections and defer non-critical spend this week.' : 'Maintain reserve policy; consider deploying surplus into growth.',
      agentId: 'a-finance',
    });
  }

  // ── Receivables aging ────────────────────────────────────────────────────
  const liveInv = invoices.filter((i) => !i.voidedAt && i.status !== 'draft' && i.status !== 'paid');
  const overdue = liveInv.filter((i) => i.status === 'overdue');
  const arTotal = liveInv.reduce((s, i) => s + i.amount, 0);
  if (overdue.length) {
    const worst = [...overdue].sort((a, b) => b.amount - a.amount)[0];
    out.push({
      id: 'in-ar-aging',
      area: 'receivables',
      severity: overdue.some((i) => i.status === 'overdue') ? 'watch' : 'info',
      title: `${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'} worth ${money(overdue.reduce((s, i) => s + i.amount, 0))}`,
      detail: `Largest exposure: ${worst.number} — ${worst.client} at ${money(worst.amount)}. Total open AR ${money(arTotal)}.`,
      metric: money(overdue.reduce((s, i) => s + i.amount, 0)),
      action: 'Launch a structured dunning sequence starting with the oldest invoices.',
      agentId: 'a-comms',
    });
  }

  // ── Payables / vendor concentration ──────────────────────────────────────
  const openBills = bills.filter((b) => !b.voidedAt && b.status !== 'paid');
  if (openBills.length) {
    const byVendor = new Map<string, number>();
    openBills.forEach((b) => byVendor.set(b.vendorName, (byVendor.get(b.vendorName) ?? 0) + b.amount));
    const top = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0];
    const apTotal = openBills.reduce((s, b) => s + b.amount, 0);
    const concentration = apTotal ? top[1] / apTotal : 0;
    out.push({
      id: 'in-ap-exposure',
      area: 'payables',
      severity: concentration > 0.5 ? 'watch' : 'info',
      title: `AP commitment ${money(apTotal)} across ${byVendor.size} vendor${byVendor.size === 1 ? '' : 's'}`,
      detail: `${top[0]} holds ${Math.round(concentration * 100)}% of outstanding payables (${money(top[1])}).`,
      metric: `${Math.round(concentration * 100)}% concentration`,
      action: concentration > 0.5 ? 'Negotiate terms with the dominant vendor to reduce single-party risk.' : 'Schedule payments to preserve the cash runway window.',
      agentId: 'a-finance',
    });
  }

  // ── Sales pipeline ───────────────────────────────────────────────────────
  const activeLeads = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
  if (activeLeads.length) {
    const weights: Record<string, number> = { new: 0.1, qualified: 0.3, proposal: 0.6 };
    const forecast = activeLeads.reduce((s, l) => s + l.value * (weights[l.stage] ?? 0.2), 0);
    const stalled = activeLeads.filter((l) => l.stage === 'proposal').length;
    out.push({
      id: 'in-pipeline',
      area: 'sales',
      severity: stalled > 2 ? 'watch' : 'info',
      title: `Weighted pipeline forecast ${money(forecast)}`,
      detail: `${activeLeads.length} active opportunities; ${stalled} sitting at proposal stage.`,
      metric: money(forecast),
      action: stalled ? 'Push proposal-stage deals with tailored follow-ups before month end.' : 'Keep nurturing early-stage leads; qualification rate is healthy.',
      agentId: 'a-sales',
    });
  }

  // ── Accounting hygiene ───────────────────────────────────────────────────
  const drafts = journals.filter((j) => j.status === 'draft').length;
  const unbalanced = journals.filter((j) => j.status === 'draft' && Math.abs(j.lines.reduce((s, l) => s + l.debit - l.credit, 0)) > 0.005);
  const voidedCount = journals.filter((j) => j.status === 'voided').length;
  if (drafts || voidedCount) {
    out.push({
      id: 'in-books-hygiene',
      area: 'accounting',
      severity: unbalanced.length ? 'watch' : 'info',
      title: `${drafts} draft entr${drafts === 1 ? 'y' : 'ies'}, ${unbalanced.length} unbalanced, ${voidedCount} voided`,
      detail: unbalanced.length
        ? `Unbalanced drafts block period close: ${unbalanced.slice(0, 2).map((j) => `"${j.memo}"`).join(', ')}.`
        : 'Journal integrity maintained — posted entries are balanced and voids carry reversals.',
      action: unbalanced.length ? 'Balance and post draft entries before the next close.' : 'No action needed.',
      agentId: 'a-finance',
    });
  }

  // ── Goals at risk ────────────────────────────────────────────────────────
  const atRisk = goals.filter((g) => g.status === 'at-risk' || g.status === 'behind');
  if (atRisk.length) {
    out.push({
      id: 'in-goals',
      area: 'goals',
      severity: atRisk.some((g) => g.status === 'behind') ? 'critical' : 'watch',
      title: `${atRisk.length} company goal${atRisk.length === 1 ? '' : 's'} off track`,
      detail: atRisk.map((g) => `${g.title} (${g.progress}%)`).join('; ') + '.',
      action: 'Re-plan resourcing or scope for the lagging objectives this sprint.',
      agentId: 'a-ops',
    });
  }

  // ── People cost ratio ────────────────────────────────────────────────────
  const payroll = finance.filter((f) => /payroll|salary|contractor/i.test(f.label) && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const revenueTotal = finance.filter((f) => (f.kind === 'revenue') && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  if (payroll > 0 && revenueTotal > 0 && employees.length) {
    const ratio = payroll / revenueTotal;
    out.push({
      id: 'in-payroll-ratio',
      area: 'hr',
      severity: ratio > 0.6 ? 'watch' : 'positive',
      title: `People cost is ${Math.round(ratio * 100)}% of recorded revenue`,
      detail: `${employees.length} employees; cumulative payroll-linked entries ${money(payroll)} vs revenue ${money(revenueTotal)}.`,
      metric: `${Math.round(ratio * 100)}%`,
      action: ratio > 0.6 ? 'Review contractor utilisation before adding headcount.' : 'Healthy ratio — headcount growth is self-funding.',
      agentId: 'a-hr',
    });
  }

  // ── Vendor risk roll-up ──────────────────────────────────────────────────
  const riskyVendors = vendors.filter((v) => {
    const vb = bills.filter((b) => b.vendorId === v.id && !b.voidedAt);
    const total = vb.reduce((s, b) => s + b.amount, 0);
    if (!total) return false;
    const unpaidShare = vb.filter((b) => b.status === 'unpaid').reduce((s, b) => s + b.amount, 0) / total;
    return unpaidShare >= 0.25;
  });
  if (riskyVendors.length) {
    out.push({
      id: 'in-vendor-risk',
      area: 'vendors',
      severity: 'watch',
      title: `${riskyVendors.length} vendor${riskyVendors.length === 1 ? '' : 's'} showing payment-pattern risk`,
      detail: `${riskyVendors.slice(0, 3).map((v) => v.name).join(', ')} have ≥25% unpaid bill share.`,
      action: 'Renegotiate terms or prepay the highest-risk vendor to protect supply.',
      agentId: 'a-finance',
    });
  }

  // ── Project delivery ───────────────────────────────────────────────────
  const projects = input.projects ?? [];
  const tasks = input.tasks ?? [];
  if (projects.length) {
    const liveProjects = projects.filter((p) => p.status !== 'cancelled');
    const spendOf = (id: string) =>
      finance.filter((f) => f.projectId === id && f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
    const over = liveProjects
      .filter((p) => p.budgetAmount > 0 && spendOf(p.id) > p.budgetAmount)
      .map((p) => ({ p, pct: Math.round((spendOf(p.id) / p.budgetAmount) * 100) }))
      .sort((a, b) => b.pct - a.pct);
    if (over.length) {
      const worst = over[0];
      out.push({
        id: 'in-project-budget',
        area: 'projects',
        severity: worst.pct >= 120 ? 'critical' : 'watch',
        title: `${over.length} project${over.length === 1 ? '' : 's'} over budget`,
        detail: `${worst.p.name} is at ${worst.pct}% of budget (${money(spendOf(worst.p.id))} vs ${money(worst.p.budgetAmount)}).` + (over[1] ? ` Also over: ${over.slice(1, 3).map((o) => o.p.name).join(', ')}.` : ''),
        metric: `${worst.pct}%`,
        action: 'Freeze discretionary spend on the over-budget projects and re-scope or re-budget them.',
        agentId: 'a-pm',
        link: { page: 'projects' },
      });
    }
    const stalled = liveProjects.filter((p) => {
      if (p.status !== 'active') return false;
      const pt = tasks.filter((t) => t.projectId === p.id);
      return pt.length >= 3 && pt.every((t) => t.status !== 'done');
    });
    if (stalled.length) {
      const openCount = (id: string) => tasks.filter((t) => t.projectId === id && t.status !== 'done').length;
      out.push({
        id: 'in-project-stalled',
        area: 'projects',
        severity: 'watch',
        title: `${stalled.length} active project${stalled.length === 1 ? '' : 's'} with no completed tasks`,
        detail: stalled.slice(0, 3).map((p) => `${p.name} (${openCount(p.id)} open)`).join('; ') + '.',
        action: 'Break the next milestone into completable tasks and assign owners this week.',
        agentId: 'a-pm',
        link: { page: 'projects' },
      });
    }
  }

  // ── Support desk ────────────────────────────────────────────────────────
  const support = input.support;
  if (support && (support.active > 0 || support.breached > 0 || support.atRisk > 0)) {
    const risk = support.breached + support.atRisk;
    out.push({
      id: 'in-support-risk',
      area: 'support',
      severity: support.breached > 0 ? 'critical' : risk > 0 || support.unassigned > 0 ? 'watch' : 'positive',
      title: risk > 0
        ? `${risk} ticket${risk === 1 ? '' : 's'} need${risk === 1 ? 's' : ''} SLA attention`
        : `${support.active} active tickets, none at SLA risk`,
      detail: `${support.breached} breached · ${support.atRisk} at risk · ${support.unassigned} unassigned` + (support.compliance !== null ? ` · ${support.compliance}% SLA compliance on resolved.` : '.'),
      metric: support.compliance !== null ? `${support.compliance}% compliance` : `${support.active} active`,
      action: support.unassigned > 0 ? 'Assign owners to the unassigned tickets first — that is usually the fastest win.' : 'Work the breached queue oldest-first, then clear the at-risk list.',
      agentId: 'a-support',
      link: { page: 'support', tab: 'tickets' },
    });
  }

  // ── Inventory stockouts ─────────────────────────────────────────────────
  const inventoryItems = input.inventoryItems ?? [];
  const stockMovements = input.stockMovements ?? [];
  if (inventoryItems.length) {
    const stocked = inventoryItems.filter((i) => i.active && i.trackStock);
    const stockouts = stocked.filter((i) => totalOnHand(stockMovements, i.id) <= 0);
    const low = stocked.filter((i) => {
      const on = totalOnHand(stockMovements, i.id);
      return on > 0 && on <= i.reorderPoint;
    });
    if (stockouts.length) {
      out.push({
        id: 'in-stockout',
        area: 'inventory',
        severity: stockouts.length >= 5 ? 'critical' : 'watch',
        title: `${stockouts.length} product${stockouts.length === 1 ? '' : 's'} out of stock`,
        detail: `${stockouts.slice(0, 3).map((i) => i.name).join(', ')}${stockouts.length > 3 ? ` +${stockouts.length - 3} more` : ''} cannot be sold right now.` + (low.length ? ` ${low.length} more at/below reorder point.` : ''),
        metric: `${stockouts.length} stockouts`,
        action: 'Reorder the stockouts first — every day without them is lost revenue.',
        agentId: 'a-ops',
        link: { page: 'inventory', tab: 'stock' },
      });
    } else if (low.length) {
      out.push({
        id: 'in-reorder',
        area: 'inventory',
        severity: 'info',
        title: `${low.length} product${low.length === 1 ? '' : 's'} at/below reorder point`,
        detail: `${low.slice(0, 3).map((i) => i.name).join(', ')}${low.length > 3 ? ` +${low.length - 3} more` : ''} will stock out if sales continue.`,
        action: 'Raise purchase orders before the next sales cycle.',
        agentId: 'a-ops',
        link: { page: 'inventory', tab: 'stock' },
      });
    }
  }

  // ── Marketing efficiency ────────────────────────────────────────────────
  const ads = input.ads ?? [];
  const liveAds = ads.filter((a) => a.status === 'active');
  if (liveAds.length) {
    const spend = liveAds.reduce((s, a) => s + a.spent, 0);
    const conv = liveAds.reduce((s, a) => s + a.conversions, 0);
    const dry = liveAds.filter((a) => a.spent > 0 && a.conversions === 0);
    if (dry.length) {
      out.push({
        id: 'in-ads-dry',
        area: 'marketing',
        severity: 'watch',
        title: `${dry.length} active campaign${dry.length === 1 ? '' : 's'} spending with zero conversions`,
        detail: `${dry.slice(0, 3).map((a) => `${a.name} (${money(a.spent)} spent)`).join('; ')}.`,
        metric: `${money(dry.reduce((s, a) => s + a.spent, 0))} dry spend`,
        action: 'Pause the dry campaigns and move their budget into the converting ones.',
        agentId: 'a-paidmedia',
        link: { page: 'marketing', tab: 'advertising' },
      });
    } else if (spend > 0) {
      const per1k = (conv / spend) * 1000;
      out.push({
        id: 'in-ads-efficiency',
        area: 'marketing',
        severity: per1k < 1 ? 'watch' : 'positive',
        title: `Paid media converts ${per1k.toFixed(1)} per $1k spend`,
        detail: `${money(spend)} active spend driving ${conv} conversions.`,
        metric: `${per1k.toFixed(1)} / $1k`,
        action: per1k < 1 ? 'Kill the weakest half of campaigns and retest creative on the rest.' : 'Scale the winners gradually — hold creative refresh cadence.',
        agentId: 'a-paidmedia',
        link: { page: 'marketing', tab: 'advertising' },
      });
    }
  }

  // ── Communications: threads waiting on a reply ───────────────────────
  const chats = input.chats ?? [];
  if (chats.length) {
    const waiting = chats.filter((c) => {
      const last = c.messages[c.messages.length - 1];
      return last && last.role === 'client';
    });
    if (waiting.length) {
      out.push({
        id: 'in-comms-waiting',
        area: 'communications',
        severity: waiting.length >= 3 ? 'watch' : 'info',
        title: `${waiting.length} conversation${waiting.length === 1 ? '' : 's'} waiting on a reply`,
        detail: `${waiting.slice(0, 3).map((c) => c.clientName || c.leadId).join(', ')}${waiting.length > 3 ? ` +${waiting.length - 3} more` : ''} sent the last message.`,
        metric: `${waiting.length} waiting`,
        action: 'Reply to the oldest waiting thread first — response time wins deals.',
        agentId: 'a-comms',
        link: { page: 'communications', tab: 'inbox' },
      });
    }
  }
  const calls = input.calls ?? [];
  if (calls.length) {
    const failed = calls.filter((c) => c.status === 'failed');
    if (failed.length) {
      out.push({
        id: 'in-calls-failed',
        area: 'communications',
        severity: failed.length >= 3 ? 'watch' : 'info',
        title: `${failed.length} call${failed.length === 1 ? '' : 's'} failed to connect`,
        detail: `${failed.slice(0, 3).map((c) => c.leadName || c.contact).join(', ')}${failed.length > 3 ? ` +${failed.length - 3} more` : ''} never connected.`,
        action: 'Retry the failed calls or follow up on another channel.',
        agentId: 'a-comms',
        link: { page: 'communications', tab: 'calls' },
      });
    }
  }

  // ── HR operations: leave queue + onboarding ────────────────────────────
  const leaveRequests = input.leaveRequests ?? [];
  const pendingLeave = leaveRequests.filter((l) => l.status === 'pending');
  if (pendingLeave.length) {
    out.push({
      id: 'in-leave-pending',
      area: 'hr',
      severity: pendingLeave.length >= 3 ? 'watch' : 'info',
      title: `${pendingLeave.length} leave request${pendingLeave.length === 1 ? '' : 's'} awaiting a decision`,
      detail: `${pendingLeave.slice(0, 3).map((l) => `${l.employeeName} (${l.days}d)`).join(', ')}${pendingLeave.length > 3 ? ` +${pendingLeave.length - 3} more` : ''}.`,
      metric: `${pendingLeave.length} pending`,
      action: 'Approve or reject the pending requests so rosters can be planned.',
      agentId: 'a-hr',
      link: { page: 'hr', tab: 'timeoff' },
    });
  }
  const onboarding = employees.filter((e) => e.status === 'onboarding');
  if (onboarding.length) {
    out.push({
      id: 'in-hr-onboarding',
      area: 'hr',
      severity: 'info',
      title: `${onboarding.length} team member${onboarding.length === 1 ? '' : 's'} still onboarding`,
      detail: `${onboarding.slice(0, 3).map((e) => e.name).join(', ')}${onboarding.length > 3 ? ` +${onboarding.length - 3} more` : ''} have not finished onboarding.`,
      action: 'Check their onboarding checklist and unblock what is pending.',
      agentId: 'a-hr',
      link: { page: 'hr', tab: 'directory' },
    });
  }

  // ── Company: fundraising deadlines + knowledge depth ───────────────────
  const fundraising = input.fundraising ?? [];
  if (fundraising.length) {
    const open = fundraising.filter((o) => o.stage !== 'won' && o.stage !== 'rejected');
    const today = new Date().toISOString().slice(0, 10);
    const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const overdue = open.filter((o) => o.deadline && o.deadline < today);
    const dueSoon = open.filter((o) => o.deadline && o.deadline >= today && o.deadline <= soon);
    if (overdue.length || dueSoon.length) {
      const list = [...overdue, ...dueSoon].slice(0, 3).map((o) => `${o.program} (${o.deadline})`).join('; ');
      out.push({
        id: 'in-fundraising-deadlines',
        area: 'company',
        severity: overdue.length ? 'critical' : 'watch',
        title: overdue.length
          ? `${overdue.length} funding deadline${overdue.length === 1 ? '' : 's'} passed with applications open`
          : `${dueSoon.length} funding deadline${dueSoon.length === 1 ? '' : 's'} within 14 days`,
        detail: `${list}${overdue.length + dueSoon.length > 3 ? ` +${overdue.length + dueSoon.length - 3} more` : ''}.`,
        metric: overdue.length ? `${overdue.length} overdue` : `${dueSoon.length} due soon`,
        action: 'Push the open applications over the line or move them to the next cycle.',
        agentId: 'a-fundraising',
        link: { page: 'company', tab: 'fundraising' },
      });
    }
    const hot = open.filter((o) => o.matchScore >= 80 && o.stage === 'identified');
    if (hot.length && !overdue.length && !dueSoon.length) {
      out.push({
        id: 'in-fundraising-hot',
        area: 'company',
        severity: 'info',
        title: `${hot.length} high-fit opportunit${hot.length === 1 ? 'y' : 'ies'} not started`,
        detail: `${hot.slice(0, 3).map((o) => `${o.program} (${o.matchScore}% fit)`).join('; ')}.`,
        action: 'Move the best fit into evaluating this week.',
        agentId: 'a-fundraising',
        link: { page: 'company', tab: 'fundraising' },
      });
    }
    const won = fundraising.filter((o) => o.stage === 'won');
    if (won.length && !overdue.length) {
      out.push({
        id: 'in-fundraising-won',
        area: 'company',
        severity: 'positive',
        title: `${won.length} funding win${won.length === 1 ? '' : 's'} on the board`,
        detail: `${won.slice(0, 3).map((o) => o.program).join(', ')} secured.`,
        action: 'Keep the pipeline full — log the win so agents cite it in outreach.',
        agentId: 'a-fundraising',
        link: { page: 'company', tab: 'fundraising' },
      });
    }
  }
  const knowledge = input.knowledge ?? [];
  const kbOpen = input.kbOpenQuestions ?? 0;
  if (kbOpen > 0) {
    out.push({
      id: 'in-knowledge-gaps',
      area: 'company',
      severity: kbOpen >= 5 ? 'watch' : 'info',
      title: `${kbOpen} knowledge question${kbOpen === 1 ? '' : 's'} agents still cannot answer`,
      detail: 'The onboarding checklist surfaced gaps nobody has filled in yet.',
      metric: `${kbOpen} open`,
      action: 'Answer the open knowledge questions so agents stop guessing.',
      agentId: 'a-borga',
      link: { page: 'company', tab: 'knowledge' },
    });
  } else if (knowledge.length > 0 && knowledge.length < 5) {
    out.push({
      id: 'in-knowledge-thin',
      area: 'company',
      severity: 'info',
      title: `Knowledge base is thin (${knowledge.length} entr${knowledge.length === 1 ? 'y' : 'ies'})`,
      detail: 'Agents answer from a handful of facts — every gap is a guess.',
      action: 'Add the top 5 facts about services, pricing and customers.',
      agentId: 'a-borga',
      link: { page: 'company', tab: 'knowledge' },
    });
  }

  // ── AI platform: run queue + scheduler health ──────────────────────────
  const runs = input.runsSummary;
  if (runs && ((runs.failed ?? 0) > 0 || (runs.queued ?? 0) >= 5)) {
    const failed = runs.failed ?? 0;
    const queued = runs.queued ?? 0;
    out.push({
      id: 'in-queue-health',
      area: 'automation',
      severity: failed >= 3 ? 'critical' : 'watch',
      title: failed > 0
        ? `${failed} agent run${failed === 1 ? '' : 's'} failed${queued >= 5 ? `, ${queued} still queued` : ''}`
        : `${queued} runs waiting in the queue`,
      detail: failed > 0
        ? 'Failed runs keep their history in one row — retry them from Runs & Queue.'
        : 'A backlog is building faster than the workers drain it.',
      metric: failed > 0 ? `${failed} failed` : `${queued} queued`,
      action: failed > 0 ? 'Retry the failed runs or fix the goal that keeps failing.' : 'Add workers or cancel stale queued runs.',
      agentId: 'a-borga',
      link: { page: 'ai', tab: 'runs' },
    });
  }
  if (runs && (runs.scheduledActive ?? -1) === 0) {
    out.push({
      id: 'in-scheduler-idle',
      area: 'automation',
      severity: 'info',
      title: 'No scheduled tasks active',
      detail: 'Nothing runs on its own — every agent run needs a manual trigger.',
      action: 'Schedule one recurring check so the fleet works while you sleep.',
      agentId: 'a-borga',
      link: { page: 'ai', tab: 'runs' },
    });
  }

  // ── Finance ops: banking recon, revenue tracker, budgets, filings ──────
  const unmatched = input.bankTxns.filter((t) => t.status === 'unmatched').length;
  if (unmatched > 0) {
    out.push({
      id: 'in-bank-unmatched',
      area: 'banking',
      severity: unmatched >= 10 ? 'watch' : 'info',
      title: `${unmatched} bank line${unmatched === 1 ? '' : 's'} waiting to reconcile`,
      detail: 'Unmatched lines hide the true cash position from every report.',
      metric: `${unmatched} unmatched`,
      action: 'Match the bank lines to ledger accounts in Banking.',
      agentId: 'a-finance',
      link: { page: 'finance', tab: 'banking' },
    });
  }
  const tracks = input.revenueTracks ?? [];
  if (tracks.length) {
    const behind: string[] = [];
    for (const t of tracks) {
      for (const line of t.lines) {
        const target = line.targets.reduce((s, v) => s + v, 0);
        const actual = line.actuals.reduce((s, v) => s + v, 0);
        if (target > 0 && actual < target) behind.push(`${line.name} (${Math.round((actual / target) * 100)}% of target)`);
      }
    }
    if (behind.length) {
      out.push({
        id: 'in-revenue-behind',
        area: 'banking',
        severity: behind.length >= 3 ? 'watch' : 'info',
        title: `${behind.length} revenue line${behind.length === 1 ? '' : 's'} behind target`,
        detail: `${behind.slice(0, 3).join('; ')}${behind.length > 3 ? ` +${behind.length - 3} more` : ''}.`,
        metric: `${behind.length} behind`,
        action: 'Chase the gap lines — raise actuals or reset targets you no longer believe.',
        agentId: 'a-finance',
        link: { page: 'finance', tab: 'revenue' },
      });
    }
  }
  const budgets = input.budgets ?? [];
  if (budgets.length === 0 && (finance.length > 0 || tracks.length > 0)) {
    out.push({
      id: 'in-budget-missing',
      area: 'banking',
      severity: 'info',
      title: 'No budget set — spend has nothing to compare against',
      detail: 'There is live financial activity but no active budget to hold it to.',
      action: 'Create this fiscal year’s operating budget in Budgeting.',
      agentId: 'a-finance',
      link: { page: 'finance', tab: 'budgeting' },
    });
  }
  const filings = input.filings;
  if (filings && filings.records.length) {
    const openFilings = filings.records.filter((r) => r.status === 'preparing' || r.status === 'review');
    const today = new Date().toISOString().slice(0, 10);
    const overdueFilings = openFilings.filter((r) => r.dueOverride && r.dueOverride < today);
    if (openFilings.length) {
      out.push({
        id: 'in-filings-open',
        area: 'compliance',
        severity: overdueFilings.length ? 'critical' : openFilings.length >= 3 ? 'watch' : 'info',
        title: overdueFilings.length
          ? `${overdueFilings.length} filing${overdueFilings.length === 1 ? '' : 's'} overdue`
          : `${openFilings.length} filing${openFilings.length === 1 ? '' : 's'} still open`,
        detail: overdueFilings.length
          ? `${overdueFilings.slice(0, 3).map((r) => r.key).join(', ')} passed their due date.`
          : `${openFilings.slice(0, 3).map((r) => r.key).join(', ')}${openFilings.length > 3 ? ` +${openFilings.length - 3} more` : ''} waiting to be filed.`,
        metric: overdueFilings.length ? `${overdueFilings.length} overdue` : `${openFilings.length} open`,
        action: 'File the overdue returns first — penalties compound daily.',
        agentId: 'a-finance',
        link: { page: 'finance', tab: 'filing' },
      });
    }
  }

  // ── Marketing: social queue ────────────────────────────────────────────
  const posts = input.posts ?? [];
  if (posts.length) {
    const scheduled = posts.filter((p) => p.status === 'scheduled');
    const drafts = posts.filter((p) => p.status === 'draft');
    if (scheduled.length || drafts.length >= 5) {
      out.push({
        id: 'in-social-pending',
        area: 'marketing',
        severity: scheduled.length >= 5 ? 'watch' : 'info',
        title: scheduled.length
          ? `${scheduled.length} post${scheduled.length === 1 ? '' : 's'} scheduled, ${drafts.length} draft${drafts.length === 1 ? '' : 's'} waiting`
          : `${drafts.length} draft posts piling up`,
        detail: scheduled.length
          ? `Next up: ${scheduled.slice(0, 2).map((p) => `${p.channel} — ${p.content.slice(0, 40)}`).join('; ')}.`
          : 'Drafts that never ship teach the audience nothing.',
        action: 'Review the queue and schedule the ready drafts.',
        agentId: 'a-comms',
        link: { page: 'marketing', tab: 'social' },
      });
    }
  }

  // ── Developers / integrations health ───────────────────────────────────
  const webhooks = input.webhooks ?? [];
  const mcpServers = input.mcpServers ?? [];
  const webhooksOff = webhooks.filter((w) => !w.active).length;
  const mcpErrors = mcpServers.filter((m) => m.status === 'error').length;
  if (webhooksOff > 0 || mcpErrors > 0) {
    const parts: string[] = [];
    if (webhooksOff > 0) parts.push(`${webhooksOff} webhook${webhooksOff === 1 ? '' : 's'} switched off`);
    if (mcpErrors > 0) parts.push(`${mcpErrors} MCP server${mcpErrors === 1 ? '' : 's'} in error`);
    out.push({
      id: 'in-integrations-health',
      area: 'integrations',
      severity: mcpErrors > 0 ? 'watch' : 'info',
      title: parts.join(' · ') + ' need attention',
      detail: mcpErrors > 0
        ? `${mcpServers.filter((m) => m.status === 'error').slice(0, 3).map((m) => m.name).join(', ')} reported errors on the last sync.`
        : 'Disabled webhooks stop firing — events from those sources never reach the agents.',
      action: 'Re-enable or repair the broken integrations.',
      agentId: 'a-borga',
      link: { page: 'developers', tab: 'webhooks' },
    });
  }

  // ── Overview: KPIs below target ────────────────────────────────────────
  const kpiGroups = input.kpiGroups ?? [];
  if (kpiGroups.length) {
    const below: string[] = [];
    let measured = 0;
    for (const g of kpiGroups) {
      for (const k of g.kpis) {
        if (!kpiMeasured(k)) continue;
        measured++;
        const att = kpiAttainment(k);
        if (att !== null && att < 70) below.push(`${k.label} (${att}%)`);
      }
    }
    if (below.length) {
      out.push({
        id: 'in-kpi-below',
        area: 'kpis',
        severity: below.length >= 3 ? 'watch' : 'info',
        title: `${below.length} measured KPI${below.length === 1 ? '' : 's'} below 70% of target`,
        detail: `${below.slice(0, 3).join('; ')}${below.length > 3 ? ` +${below.length - 3} more` : ''} (${measured} measured).`,
        metric: `${below.length} below`,
        action: 'Pick the worst KPI and give it one owner and one deadline this week.',
        agentId: 'a-ops',
        link: { page: 'overview', tab: 'kpis' },
      });
    }
  }

  const rank: Record<InsightSeverity, number> = { critical: 0, watch: 1, info: 2, positive: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const AGENT_NAMES: Record<string, string> = {
  'a-finance': 'Ledger', 'a-comms': 'Nova', 'a-sales': 'Ace', 'a-ops': 'Iris', 'a-hr': 'Rigby',
  'a-pm': 'Rigby', 'a-support': 'Spectra', 'a-paidmedia': 'Paige', 'a-borga': 'Borga',
  'a-fundraising': 'Nadia',
};

const AREA_TO_KB_CATEGORY: Record<BusinessInsight['area'], KnowledgeCategoryId> = {
  cashflow: 'company', receivables: 'customers', payables: 'services', sales: 'customers',
  hr: 'process', accounting: 'process', goals: 'company', vendors: 'services',
  projects: 'company', support: 'customers', inventory: 'services', marketing: 'customers',
  communications: 'customers', automation: 'process', company: 'company', banking: 'company',
  compliance: 'process', kpis: 'company', integrations: 'process',
};

/**
 * Upsert one knowledge-base entry per live business insight (keyed so re-runs
 * update in place rather than duplicating), so the KB reflects what the
 * company's own data currently shows instead of staying static.
 */
export function syncInsightsToKnowledgeBase(insights: BusinessInsight[], existing: KnowledgeEntry[]): KnowledgeEntry[] {
  const stamp = new Date().toISOString();
  const byId = new Map(existing.map((k) => [k.id, k]));
  insights.forEach((i) => {
    const id = `kb-insight-${i.id}`;
    byId.set(id, {
      id,
      category: AREA_TO_KB_CATEGORY[i.area] ?? 'process',
      title: i.title,
      answer: `${i.detail} Recommended action: ${i.action}`,
      source: 'Auto-derived from live data',
      updatedAt: stamp,
    });
  });
  return Array.from(byId.values());
}

/** Convert derived insights into durable agent memories so agents literally learn the business. */
export function insightsToMemories(insights: BusinessInsight[], workspaceName: string): AgentMemory[] {
  const stamp = new Date().toISOString();
  return insights.map((i) => ({
    id: `mem-ins-${i.id}-${Date.now().toString(36)}`,
    agentId: i.agentId,
    agentName: AGENT_NAMES[i.agentId] ?? 'Atlas',
    kind: 'observation' as const,
    content: `[${workspaceName}] ${i.title}. ${i.detail} Recommended action: ${i.action}`,
    tags: [i.area, i.severity, 'auto-derived'],
    confidence: i.severity === 'critical' ? 95 : i.severity === 'watch' ? 85 : 75,
    createdAt: stamp,
    lastAccessed: stamp,
  }));
}
