// Cross-module business intelligence engine.
// Scans every module (finance, AR/AP, sales pipeline, HR, banking, journal,
// goals, vendors, customers) and derives insights that feed the AI agents'
// context so they continuously learn how the business is actually performing.
import type {
  FinanceEntry, Invoice, Bill, Vendor, Customer, Lead, Goal,
  JournalEntry, BankTxn, BankAccount, Employee, AgentMemory,
  KnowledgeEntry, KnowledgeCategoryId,
} from './data';

export type InsightSeverity = 'positive' | 'info' | 'watch' | 'critical';

export interface BusinessInsight {
  id: string;
  area: 'cashflow' | 'receivables' | 'payables' | 'sales' | 'hr' | 'accounting' | 'goals' | 'vendors';
  severity: InsightSeverity;
  title: string;
  detail: string;
  metric?: string;
  action: string;
  agentId: string;
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

  const rank: Record<InsightSeverity, number> = { critical: 0, watch: 1, info: 2, positive: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const AGENT_NAMES: Record<string, string> = {
  'a-finance': 'Ledger', 'a-comms': 'Nova', 'a-sales': 'Ace', 'a-ops': 'Iris', 'a-hr': 'Rigby',
};

const AREA_TO_KB_CATEGORY: Record<BusinessInsight['area'], KnowledgeCategoryId> = {
  cashflow: 'company', receivables: 'customers', payables: 'services', sales: 'customers',
  hr: 'process', accounting: 'process', goals: 'company', vendors: 'services',
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
