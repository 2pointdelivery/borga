import type { InsightInput, SupportSummary } from './insights';
import { computeCashRunway, deriveBusinessInsights } from './insights';
import { kpiAttainment, kpiMeasured } from './data';
import { totalOnHand } from './inventory';

/**
 * Ask-the-engine layer: the owner types a plain-language question and gets an
 * answer computed from the same live business data as the advisory engine.
 * Pure (no I/O, no LLM) so answers are instant, offline-capable and always
 * backed by the numbers shown — keyword intents route to the right slice,
 * anything else gets a briefing or an honest pointer to what it can answer.
 */

export interface AdvisorContext extends InsightInput {
  workspaceName: string;
  money: (n: number) => string;
  nowMs: number;
}

export interface HowToStep {
  step: number;
  title: string;
  detail: string;
  link?: { page: string; tab?: string; sectionId?: string };
  ctaLabel?: string;
}

export interface HowToGuide {
  id: string;
  title: string;
  summary: string;
  page: string;
  tab?: string;
  keywords: string[];
  steps: HowToStep[];
}

export interface AdvisorAnswer {
  text: string;
  link?: { page: string; tab?: string; sectionId?: string };
  guideTitle?: string;
  steps?: HowToStep[];
}

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

function cashAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const { cash, monthlyBurn, months } = computeCashRunway(ctx.finance, ctx.bankAccounts);
  if (monthlyBurn <= 0) {
    return { text: `Cash on hand is ${ctx.money(cash)} with no recorded burn — nothing is spending yet.`, link: { page: 'finance', tab: 'banking' } };
  }
  const run = Number.isFinite(months) ? `≈ ${months.toFixed(1)} months of runway` : 'unlimited runway';
  return {
    text: `Cash ${ctx.money(cash)} against ~${ctx.money(monthlyBurn)}/mo burn — ${run}. ${months < 6 ? 'Under 6 months: accelerate collections and defer non-critical spend this week.' : 'Reserve policy looks fine.'}`,
    link: { page: 'finance', tab: 'banking' },
  };
}

function receivablesAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const live = ctx.invoices.filter((i) => !i.voidedAt && i.status !== 'draft' && i.status !== 'paid');
  if (!live.length) return { text: 'No open invoices — nothing to collect.', link: { page: 'sales', tab: 'invoices' } };
  const overdue = live.filter((i) => i.status === 'overdue');
  const total = live.reduce((s, i) => s + i.amount, 0);
  const worst = [...live].sort((a, b) => b.amount - a.amount)[0];
  return {
    text: `${ctx.money(total)} open across ${live.length} invoices. ${overdue.length ? `${overdue.length} overdue worth ${ctx.money(overdue.reduce((s, i) => s + i.amount, 0))} — largest is ${worst.number} (${worst.client}, ${ctx.money(worst.amount)}). Start dunning with the oldest.` : 'None overdue — AR is clean.'}`,
    link: { page: 'sales', tab: 'invoices' },
  };
}

function payablesAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const open = ctx.bills.filter((b) => !b.voidedAt && b.status !== 'paid');
  if (!open.length) return { text: 'No open vendor bills.', link: { page: 'finance', tab: 'vendors' } };
  const total = open.reduce((s, b) => s + b.amount, 0);
  const byVendor = new Map<string, number>();
  open.forEach((b) => byVendor.set(b.vendorName, (byVendor.get(b.vendorName) ?? 0) + b.amount));
  const [top, topAmt] = [...byVendor.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    text: `${ctx.money(total)} committed across ${open.length} open bills. Largest exposure is ${top} at ${ctx.money(topAmt)}. Schedule payments to protect the cash window.`,
    link: { page: 'finance', tab: 'vendors' },
  };
}

function pipelineAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const active = ctx.leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost');
  if (!active.length) return { text: 'Pipeline is empty — no open deals. Capture leads to restart it.', link: { page: 'sales', tab: 'pipeline' } };
  const weights: Record<string, number> = { new: 0.1, qualified: 0.3, proposal: 0.6 };
  const forecast = active.reduce((s, l) => s + l.value * (weights[l.stage] ?? 0.2), 0);
  const won = ctx.leads.filter((l) => l.stage === 'won').reduce((s, l) => s + l.value, 0);
  const stalled = active.filter((l) => l.stage === 'proposal').length;
  return {
    text: `${active.length} open deals, weighted forecast ${ctx.money(forecast)}, ${ctx.money(won)} closed-won. ${stalled ? `${stalled} sitting at proposal — push those with tailored follow-ups before month end.` : 'Nothing stalled at proposal.'}`,
    link: { page: 'sales', tab: 'pipeline' },
  };
}

function goalsAnswer(ctx: AdvisorContext): AdvisorAnswer {
  if (!ctx.goals.length) return { text: 'No company goals set yet — create one on the Command Center to track outcomes.', link: { page: 'overview', tab: 'command' } };
  const off = ctx.goals.filter((g) => g.status === 'at-risk' || g.status === 'behind');
  if (!off.length) return { text: `All ${ctx.goals.length} goals on track.`, link: { page: 'overview', tab: 'command' } };
  return {
    text: `${off.length} of ${ctx.goals.length} goals off track: ${off.map((g) => `${g.title} (${g.progress}%)`).join('; ')}. Re-plan resourcing or scope for the laggards this sprint.`,
    link: { page: 'overview', tab: 'command' },
  };
}

function supportAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const s: SupportSummary | undefined = ctx.support;
  if (!s) return { text: 'Could not load ticket data right now — open the desk directly.', link: { page: 'support', tab: 'tickets' } };
  if (s.active === 0 && s.breached === 0 && s.atRisk === 0) return { text: 'Support queue is empty.', link: { page: 'support', tab: 'tickets' } };
  const risk = s.breached + s.atRisk;
  return {
    text: `${s.active} active tickets. ${risk ? `${risk} need SLA attention (${s.breached} breached, ${s.atRisk} at risk). ` : 'None at SLA risk. '}${s.unassigned ? `${s.unassigned} unassigned — assign owners first, it is usually the fastest win.` : ''}${s.compliance !== null ? ` Compliance on resolved: ${s.compliance}%.` : ''}`,
    link: { page: 'support', tab: 'tickets' },
  };
}

function projectsAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const projects = ctx.projects ?? [];
  if (!projects.length) return { text: 'No projects tracked yet — create one to follow budget vs spend.', link: { page: 'projects' } };
  const spendOf = (id: string) => ctx.finance.filter((f) => f.projectId === id && f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const over = projects
    .filter((p) => p.status !== 'cancelled' && p.budgetAmount > 0 && spendOf(p.id) > p.budgetAmount)
    .map((p) => ({ p, pct: Math.round((spendOf(p.id) / p.budgetAmount) * 100) }))
    .sort((a, b) => b.pct - a.pct);
  const activeCount = projects.filter((p) => p.status === 'active').length;
  return {
    text: `${projects.length} projects (${activeCount} active). ${over.length ? `Over budget: ${over.map((o) => `${o.p.name} at ${o.pct}%`).join('; ')}. Freeze discretionary spend and re-scope.` : 'None over budget.'}`,
    link: { page: 'projects' },
  };
}

function stockAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const items = (ctx.inventoryItems ?? []).filter((i) => i.active && i.trackStock);
  if (!items.length) return { text: 'No stock-tracked products — nothing to watch.', link: { page: 'inventory', tab: 'stock' } };
  const out = items.filter((i) => totalOnHand(ctx.stockMovements ?? [], i.id) <= 0);
  if (!out.length) return { text: `All ${items.length} tracked products in stock.`, link: { page: 'inventory', tab: 'stock' } };
  return {
    text: `${out.length} out of stock: ${out.slice(0, 3).map((i) => i.name).join(', ')}${out.length > 3 ? ` +${out.length - 3} more` : ''}. Reorder first — every day without them is lost revenue.`,
    link: { page: 'inventory', tab: 'stock' },
  };
}

function marketingAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const live = (ctx.ads ?? []).filter((a) => a.status === 'active');
  if (!live.length) return { text: 'No active campaigns.', link: { page: 'marketing', tab: 'advertising' } };
  const spend = live.reduce((s, a) => s + a.spent, 0);
  const conv = live.reduce((s, a) => s + a.conversions, 0);
  const dry = live.filter((a) => a.spent > 0 && a.conversions === 0);
  if (dry.length) {
    return {
      text: `${ctx.money(spend)} active spend, ${conv} conversions — but ${dry.map((a) => a.name).join(', ')} spent ${ctx.money(dry.reduce((s, a) => s + a.spent, 0))} with zero conversions. Pause the dry ones and move budget to converters.`,
      link: { page: 'marketing', tab: 'advertising' },
    };
  }
  return {
    text: `${ctx.money(spend)} active spend driving ${conv} conversions (${spend ? ((conv / spend) * 1000).toFixed(1) : '0'} per $1k).`,
    link: { page: 'marketing', tab: 'advertising' },
  };
}

function teamAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const active = ctx.employees.filter((e) => e.status !== 'offboarded');
  const payroll = ctx.finance.filter((f) => /payroll|salary|contractor/i.test(f.label) && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const revenue = ctx.finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const ratio = revenue > 0 ? ` People cost is ${Math.round((payroll / revenue) * 100)}% of recorded revenue${payroll / revenue > 0.6 ? ' — review contractor utilisation before adding headcount' : ''}.` : '';
  return { text: `${active.length} people on the team.${ratio}`, link: { page: 'hr', tab: 'directory' } };
}

function moneyAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const rev = ctx.finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const exp = ctx.finance.filter((f) => f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const net = rev - exp;
  const margin = rev > 0 ? ` (${Math.round(((rev - exp) / rev) * 100)}% margin)` : '';
  return {
    text: `Booked revenue ${ctx.money(rev)}, expenses ${ctx.money(exp)}, net ${net < 0 ? '−' : ''}${ctx.money(Math.abs(net))}${margin}.`,
    link: { page: 'finance', tab: 'ledger' },
  };
}

function customersAnswer(ctx: AdvisorContext): AdvisorAnswer {
  if (!ctx.customers.length) return { text: 'No customer accounts yet.', link: { page: 'sales', tab: 'customers' } };
  const prospects = ctx.customers.filter((c) => c.status === 'prospect').length;
  return {
    text: `${ctx.customers.length} customer accounts${prospects ? ` (${prospects} still prospects — convert them)` : ''}.`,
    link: { page: 'sales', tab: 'customers' },
  };
}

function briefAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const top = deriveBusinessInsights(ctx).filter((i) => i.severity === 'critical' || i.severity === 'watch').slice(0, 3);
  if (!top.length) return { text: `All clear at ${ctx.workspaceName} — no critical or watch items across any module.` };
  return {
    text: `Top priorities at ${ctx.workspaceName}: ${top.map((t, n) => `${n + 1}. ${t.title} — ${t.action}`).join(' ')}`,
    link: top[0].link,
  };
}

function commsAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const waiting = (ctx.chats ?? []).filter((c) => {
    const last = c.messages[c.messages.length - 1];
    return last && last.role === 'client';
  });
  const failed = (ctx.calls ?? []).filter((c) => c.status === 'failed');
  if (!waiting.length && !failed.length) return { text: 'Comms are clear — no thread waiting on a reply and no failed calls.', link: { page: 'communications', tab: 'inbox' } };
  const parts: string[] = [];
  if (waiting.length) parts.push(`${waiting.length} thread${waiting.length === 1 ? '' : 's'} waiting on a reply (${waiting.slice(0, 3).map((c) => c.clientName || c.leadId).join(', ')})`);
  if (failed.length) parts.push(`${failed.length} call${failed.length === 1 ? '' : 's'} failed to connect`);
  return { text: `${parts.join('; ')}. Reply oldest-first — response time wins deals.`, link: { page: 'communications', tab: 'inbox' } };
}

function peopleOpsAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const pending = (ctx.leaveRequests ?? []).filter((l) => l.status === 'pending');
  const onboarding = ctx.employees.filter((e) => e.status === 'onboarding');
  if (!pending.length && !onboarding.length) return { text: 'People ops are quiet — no pending leave and nobody stuck onboarding.', link: { page: 'hr', tab: 'directory' } };
  const parts: string[] = [];
  if (pending.length) parts.push(`${pending.length} leave request${pending.length === 1 ? '' : 's'} awaiting a decision`);
  if (onboarding.length) parts.push(`${onboarding.length} still onboarding`);
  return { text: `${parts.join('; ')}. Decide the leave queue so rosters can be planned.`, link: { page: 'hr', tab: 'timeoff' } };
}

function fundraisingAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const open = (ctx.fundraising ?? []).filter((o) => o.stage !== 'won' && o.stage !== 'rejected');
  if (!open.length) {
    const won = (ctx.fundraising ?? []).filter((o) => o.stage === 'won').length;
    return { text: won ? `${won} funding win${won === 1 ? '' : 's'} banked and nothing open — refill the pipeline.` : 'No funding opportunities tracked — add programs to start the pipeline.', link: { page: 'company', tab: 'fundraising' } };
  }
  const urgent = open.filter((o) => o.deadline && o.deadline <= new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const hot = open.filter((o) => o.matchScore >= 80 && o.stage === 'identified');
  return {
    text: `${open.length} open opportunit${open.length === 1 ? 'y' : 'ies'}.${urgent.length ? ` ${urgent.map((o) => `${o.program} due ${o.deadline}`).join('; ')} — push these first.` : ''}${hot.length ? ` ${hot.length} high-fit not started.` : ''}`,
    link: { page: 'company', tab: 'fundraising' },
  };
}

function knowledgeAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const open = ctx.kbOpenQuestions ?? 0;
  const count = (ctx.knowledge ?? []).length;
  if (!open && count >= 5) return { text: `Knowledge base holds ${count} entries with no open gaps — agents answer from facts.`, link: { page: 'company', tab: 'knowledge' } };
  return { text: `${count} knowledge entr${count === 1 ? 'y' : 'ies'}${open ? ` and ${open} open question${open === 1 ? '' : 's'} agents cannot answer` : ''}. Fill the gaps so agents stop guessing.`, link: { page: 'company', tab: 'knowledge' } };
}

function automationAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const r = ctx.runsSummary;
  if (!r) return { text: 'Queue data is not loaded — open Runs & Queue for the live picture.', link: { page: 'ai', tab: 'runs' } };
  const parts: string[] = [];
  if (r.queued) parts.push(`${r.queued} queued`);
  if (r.running) parts.push(`${r.running} running`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (!parts.length) return { text: `Queue is empty${r.scheduledActive ? ` with ${r.scheduledActive} scheduled task${r.scheduledActive === 1 ? '' : 's'} active` : ''}.`, link: { page: 'ai', tab: 'runs' } };
  return { text: `Run queue: ${parts.join(' · ')}. ${r.failed ? 'Retry the failed runs from Runs & Queue.' : 'Workers are draining it.'}`, link: { page: 'ai', tab: 'runs' } };
}

function bankingAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const unmatched = ctx.bankTxns.filter((t) => t.status === 'unmatched').length;
  const behind: string[] = [];
  for (const t of ctx.revenueTracks ?? []) {
    for (const line of t.lines) {
      const target = line.targets.reduce((s, v) => s + v, 0);
      const actual = line.actuals.reduce((s, v) => s + v, 0);
      if (target > 0 && actual < target) behind.push(line.name);
    }
  }
  if (!unmatched && !behind.length) return { text: 'Banking is reconciled and every revenue line meets target.', link: { page: 'finance', tab: 'banking' } };
  const parts: string[] = [];
  if (unmatched) parts.push(`${unmatched} bank lines unmatched`);
  if (behind.length) parts.push(`${behind.length} revenue lines behind (${behind.slice(0, 3).join(', ')})`);
  return { text: `${parts.join('; ')}. Match the bank lines, then chase the gap lines.`, link: { page: 'finance', tab: unmatched ? 'banking' : 'revenue' } };
}

function complianceAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const open = (ctx.filings?.records ?? []).filter((r) => r.status === 'preparing' || r.status === 'review');
  if (!open.length) return { text: 'No open filings — the compliance calendar is clear.', link: { page: 'finance', tab: 'filing' } };
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((r) => r.dueOverride && r.dueOverride < today);
  return { text: `${open.length} filings open${overdue.length ? `, ${overdue.length} overdue (${overdue.slice(0, 3).map((r) => r.key).join(', ')}) — file these first, penalties compound` : ''}.`, link: { page: 'finance', tab: 'filing' } };
}

function socialAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const scheduled = (ctx.posts ?? []).filter((p) => p.status === 'scheduled');
  const drafts = (ctx.posts ?? []).filter((p) => p.status === 'draft');
  if (!scheduled.length && !drafts.length) return { text: 'No social posts in flight.', link: { page: 'marketing', tab: 'social' } };
  return { text: `${scheduled.length} scheduled, ${drafts.length} drafts. Review the queue and ship the ready ones.`, link: { page: 'marketing', tab: 'social' } };
}

function integrationsAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const off = (ctx.webhooks ?? []).filter((w) => !w.active);
  const err = (ctx.mcpServers ?? []).filter((m) => m.status === 'error');
  if (!off.length && !err.length) return { text: 'All webhooks on and every MCP server healthy.', link: { page: 'developers', tab: 'webhooks' } };
  const parts: string[] = [];
  if (off.length) parts.push(`${off.length} webhooks off`);
  if (err.length) parts.push(`${err.map((m) => m.name).join(', ')} in error`);
  return { text: `${parts.join('; ')}. Re-enable or repair them so events keep flowing.`, link: { page: 'developers', tab: 'webhooks' } };
}

function kpiAnswer(ctx: AdvisorContext): AdvisorAnswer {
  let measured = 0;
  const below: string[] = [];
  for (const g of ctx.kpiGroups ?? []) {
    for (const k of g.kpis) {
      if (!kpiMeasured(k)) continue;
      measured++;
      const att = kpiAttainment(k);
      if (att !== null && att < 70) below.push(`${k.label} (${att}%)`);
    }
  }
  if (!measured) return { text: 'No KPIs measured yet — live values fill in as the modules accumulate activity.', link: { page: 'overview', tab: 'kpis' } };
  if (!below.length) return { text: `All ${measured} measured KPIs at 70%+ of target.`, link: { page: 'overview', tab: 'kpis' } };
  return { text: `${below.length} of ${measured} measured KPIs below 70%: ${below.slice(0, 3).join('; ')}. Give the worst one an owner and a deadline.`, link: { page: 'overview', tab: 'kpis' } };
}

export const ADVISOR_SUGGESTIONS = ['Morning brief', 'Cash runway?', 'Who owes us?', 'Any SLA risk?', 'Projects over budget?', 'Comms backlog?', 'Filings due?', 'KPIs on track?'];

// ── Conversational layer: every topic owns its keywords, a label and a
// ready-made prompt. The router, the live typing hints and the "tell me
// more" follow-ups all read this one table, so the chat understands
// keywords the same way everywhere. Order = routing priority.
export type AdvisorTopicId =
  | 'brief' | 'cash' | 'receivables' | 'payables' | 'pipeline' | 'goals'
  | 'support' | 'projects' | 'stock' | 'marketing' | 'team' | 'peopleops'
  | 'money' | 'customers' | 'comms' | 'fundraising' | 'knowledge'
  | 'automation' | 'banking' | 'compliance' | 'social' | 'integrations' | 'kpis';

const TOPIC_KEYWORDS: { id: AdvisorTopicId; words: string[] }[] = [
  { id: 'brief', words: ['brief', 'priorit', 'should i do', 'what to do', 'focus', 'morning', 'todo', 'action'] },
  { id: 'cash', words: ['runway', 'cash', 'burn'] },
  { id: 'receivables', words: ['owes', 'owe', 'receiv', 'invoice', 'overdue', 'collect', 'debtors', ' ar '] },
  { id: 'payables', words: ['payables', 'bill', 'vendor', 'supplier', ' ap ', 'pay '] },
  { id: 'pipeline', words: ['pipeline', 'forecast', 'deal', 'sales', 'lead', 'win', 'quota'] },
  { id: 'goals', words: ['goal', 'okr', 'objective', 'target'] },
  { id: 'support', words: ['ticket', 'sla', 'support', 'complaint'] },
  { id: 'projects', words: ['project', 'delivery', 'milestone', 'over budget', 'scope'] },
  { id: 'stock', words: ['stock', 'inventory', 'reorder', 'out of stock', 'warehouse'] },
  { id: 'marketing', words: ['ads', 'advertising', 'marketing', 'campaign', 'roas'] },
  { id: 'team', words: ['hiring', 'hire', 'headcount', 'payroll', 'team', 'hr', 'attrition', 'staff'] },
  { id: 'peopleops', words: ['leave', 'time off', 'pto', 'vacation', 'onboarding'] },
  { id: 'money', words: ['revenue', 'profit', 'margin', 'expense', 'spend', 'loss', ' pnl', 'p&l'] },
  { id: 'customers', words: ['customer', 'client', 'churn', 'account'] },
  { id: 'comms', words: ['comms', 'inbox', 'thread', 'reply', 'message', 'call ', 'calls', 'phone'] },
  { id: 'fundraising', words: ['fund', 'grant', 'raise', 'investor', 'pitch'] },
  { id: 'knowledge', words: ['knowledge', ' kb ', 'wiki', 'playbook'] },
  { id: 'automation', words: ['queue', 'worker', 'run ', 'runs', 'automat', 'schedul'] },
  { id: 'banking', words: ['bank', 'reconcil', 'unmatched', 'revenue track', 'budget'] },
  { id: 'compliance', words: ['filing', 'compliance', 'tax', 'return'] },
  { id: 'social', words: ['social', 'post ', 'posts', 'linkedin', 'content calendar'] },
  { id: 'integrations', words: ['webhook', 'integration', 'mcp', 'api key', 'connect'] },
  { id: 'kpis', words: ['kpi', 'metric', 'scorecard'] },
];

export const ADVISOR_TOPIC_META: Record<AdvisorTopicId, { label: string; prompt: string }> = {
  brief: { label: 'Priorities', prompt: 'Morning brief' },
  cash: { label: 'Cash', prompt: 'Cash runway?' },
  receivables: { label: 'Receivables', prompt: 'Who owes us?' },
  payables: { label: 'Payables', prompt: 'What do we owe vendors?' },
  pipeline: { label: 'Pipeline', prompt: 'How is the pipeline?' },
  goals: { label: 'Goals', prompt: 'Are goals on track?' },
  support: { label: 'Support', prompt: 'Any SLA risk?' },
  projects: { label: 'Projects', prompt: 'Projects over budget?' },
  stock: { label: 'Stock', prompt: 'Anything out of stock?' },
  marketing: { label: 'Marketing', prompt: 'Any dry ad spend?' },
  team: { label: 'Team', prompt: 'How is the team?' },
  peopleops: { label: 'Time off', prompt: 'Any pending leave?' },
  money: { label: 'Money', prompt: 'Revenue vs expenses?' },
  customers: { label: 'Customers', prompt: 'How are customers?' },
  comms: { label: 'Comms', prompt: 'Comms backlog?' },
  fundraising: { label: 'Funding', prompt: 'Funding deadlines?' },
  knowledge: { label: 'Knowledge', prompt: 'Knowledge gaps?' },
  automation: { label: 'Runs', prompt: 'Queue healthy?' },
  banking: { label: 'Banking', prompt: 'Bank reconciled?' },
  compliance: { label: 'Filings', prompt: 'Filings due?' },
  social: { label: 'Social', prompt: 'Social queue?' },
  integrations: { label: 'Integrations', prompt: 'Integrations healthy?' },
  kpis: { label: 'KPIs', prompt: 'KPIs on track?' },
};

/** Topics that pair well together — offered after an answer as "also ask". */
const RELATED_TOPICS: Partial<Record<AdvisorTopicId, AdvisorTopicId[]>> = {
  cash: ['receivables', 'payables', 'banking'],
  receivables: ['cash', 'customers'],
  payables: ['cash', 'banking'],
  pipeline: ['customers', 'comms'],
  comms: ['pipeline', 'support'],
  support: ['comms', 'kpis'],
  banking: ['cash', 'compliance'],
  compliance: ['banking', 'money'],
  money: ['cash', 'kpis'],
  kpis: ['goals', 'money'],
  goals: ['kpis', 'projects'],
  projects: ['goals', 'automation'],
  automation: ['projects', 'integrations'],
  fundraising: ['cash', 'knowledge'],
  team: ['peopleops', 'kpis'],
  stock: ['pipeline', 'banking'],
  marketing: ['social', 'pipeline'],
  social: ['marketing', 'customers'],
};

/** First matching topic in priority order, or null when nothing matches. */
export function routeAdvisorTopic(question: string): AdvisorTopicId | null {
  const q = ` ${question.toLowerCase().trim()} `;
  if (!question.trim()) return null;
  for (const t of TOPIC_KEYWORDS) {
    if (has(q, ...t.words)) return t.id;
  }
  return null;
}

/** Every topic mentioned in free text — powers live typing hints (multi-match). */
export function detectAdvisorTopics(text: string): AdvisorTopicId[] {
  const q = ` ${text.toLowerCase().trim()} `;
  if (!text.trim()) return [];
  const out: AdvisorTopicId[] = [];
  for (const t of TOPIC_KEYWORDS) {
    if (t.id !== 'brief' && has(q, ...t.words)) out.push(t.id);
  }
  return out;
}

function topicAnswer(topic: AdvisorTopicId, ctx: AdvisorContext): AdvisorAnswer {
  switch (topic) {
    case 'brief': return briefAnswer(ctx);
    case 'cash': return cashAnswer(ctx);
    case 'receivables': return receivablesAnswer(ctx);
    case 'payables': return payablesAnswer(ctx);
    case 'pipeline': return pipelineAnswer(ctx);
    case 'goals': return goalsAnswer(ctx);
    case 'support': return supportAnswer(ctx);
    case 'projects': return projectsAnswer(ctx);
    case 'stock': return stockAnswer(ctx);
    case 'marketing': return marketingAnswer(ctx);
    case 'team': return teamAnswer(ctx);
    case 'peopleops': return peopleOpsAnswer(ctx);
    case 'money': return moneyAnswer(ctx);
    case 'customers': return customersAnswer(ctx);
    case 'comms': return commsAnswer(ctx);
    case 'fundraising': return fundraisingAnswer(ctx);
    case 'knowledge': return knowledgeAnswer(ctx);
    case 'automation': return automationAnswer(ctx);
    case 'banking': return bankingAnswer(ctx);
    case 'compliance': return complianceAnswer(ctx);
    case 'social': return socialAnswer(ctx);
    case 'integrations': return integrationsAnswer(ctx);
    case 'kpis': return kpiAnswer(ctx);
  }
}

function withRelated(topic: AdvisorTopicId, a: AdvisorAnswer): AdvisorAnswer {
  const related = RELATED_TOPICS[topic] ?? [];
  if (!related.length) return a;
  const hint = related.map((r) => `"${ADVISOR_TOPIC_META[r].prompt}"`).join(' or ');
  return { ...a, text: `${a.text} You could also ask ${hint}.` };
}

function actionAnswer(ctx: AdvisorContext): AdvisorAnswer {
  const top = deriveBusinessInsights(ctx).filter((i) => i.severity === 'critical' || i.severity === 'watch').slice(0, 3);
  if (!top.length) return { text: `Nothing needs action at ${ctx.workspaceName} — pick any module and push one improvement this week.` };
  return {
    text: `Do this next at ${ctx.workspaceName}: ${top.map((t, n) => `${n + 1}. ${t.action}`).join(' ')}`,
    link: top[0].link,
  };
}

/** What the chat remembers about the last exchange, so follow-ups resolve. */
export interface AdvisorMemory {
  topic: AdvisorTopicId | null;
}

const FOLLOWUP_MORE = ['more', 'detail', 'why', 'explain', 'deeper', 'expand'];
const FOLLOWUP_ACTION = ['what should i do', 'next step', 'do about', 'fix it', 'recommend', 'advice', 'advise'];
const FOLLOWUP_THANKS = ['thank', 'thanks', 'great', 'perfect', 'awesome', 'nice'];

// ── Step-by-Step "How-To" Workflow Guides ───────────────────────────────────────────────────────────────────────────

export const HOW_TO_GUIDES: readonly HowToGuide[] = [
  {
    id: 'quote-to-cash',
    title: 'Send a Quote & Convert to Invoice + Project',
    summary: 'Price a deal for a customer, email the quote, and convert it in one click when they accept.',
    page: 'sales',
    tab: 'quotes',
    keywords: ['quote', 'estimate', 'proposal', 'convert quote', 'quote to invoice', 'send quote'],
    steps: [
      {
        step: 1,
        title: 'Capture or pick the lead in Sales Pipeline',
        detail: 'Open Sales → Pipeline and click the Quote icon on an open deal (or go straight to Sales → Quotes).',
        link: { page: 'sales', tab: 'pipeline' },
        ctaLabel: 'Open Pipeline',
      },
      {
        step: 2,
        title: 'Draft the quote with line items & expiry',
        detail: 'Click "+ New quote", pick the customer, add catalog or custom lines, and set a 30-day "Good until" date.',
        link: { page: 'sales', tab: 'quotes' },
        ctaLabel: 'Open Quotes',
      },
      {
        step: 3,
        title: 'Email the quote to the customer',
        detail: 'Click the green Send icon on the quote row to open the HTML email preview and deliver it to the customer.',
        link: { page: 'sales', tab: 'quotes' },
        ctaLabel: 'Email Quote',
      },
      {
        step: 4,
        title: 'Accept & convert to Invoice + Project',
        detail: 'When the customer says yes, click the green Check icon on the sent quote to auto-create the Invoice and delivery Project.',
        link: { page: 'sales', tab: 'invoices' },
        ctaLabel: 'View Invoices',
      },
    ],
  },
  {
    id: 'send-invoice',
    title: 'Create, Email & Record Payment on an Invoice',
    summary: 'Bill a customer, send a formatted HTML invoice, and post the payment to the ledger.',
    page: 'sales',
    tab: 'invoices',
    keywords: ['invoice', 'send invoice', 'email invoice', 'bill customer', 'record payment', 'get paid'],
    steps: [
      {
        step: 1,
        title: 'Create the invoice in Sales → Invoicing',
        detail: 'Click "+ New invoice", choose the customer, add line items and tax profiles, and set the due date.',
        link: { page: 'sales', tab: 'invoices' },
        ctaLabel: 'Open Invoicing',
      },
      {
        step: 2,
        title: 'Email the formatted invoice',
        detail: 'Click the Mail icon on the invoice row to send a clean HTML + plain-text invoice via SMTP or Gmail.',
        link: { page: 'sales', tab: 'invoices' },
        ctaLabel: 'Send Invoice',
      },
      {
        step: 3,
        title: 'Post payment when paid',
        detail: 'Click the Dollar icon on the row to record the payment method and date — Borga posts the revenue & AR journal automatically.',
        link: { page: 'finance', tab: 'ledger' },
        ctaLabel: 'Check Ledger',
      },
    ],
  },
  {
    id: 'whatsapp-connect',
    title: 'Connect WhatsApp via QR Code or WhatsApp Web',
    summary: 'Link your WhatsApp session, scan a lead QR code, or launch WhatsApp Web for pipeline leads.',
    page: 'sales',
    tab: 'pipeline',
    keywords: ['whatsapp', 'qr code', 'scan qr', 'whatsapp web', 'message lead', 'chat lead'],
    steps: [
      {
        step: 1,
        title: 'Open the WhatsApp workspace in Sales Pipeline',
        detail: 'Go to Sales → Pipeline and click the "WhatsApp" button in the top toolbar (or the WhatsApp icon on any lead row).',
        link: { page: 'sales', tab: 'pipeline' },
        ctaLabel: 'Open Pipeline',
      },
      {
        step: 2,
        title: 'Scan QR & Link Device',
        detail: 'Switch to the "Scan QR & Link" tab inside the modal to scan the ISO QR code or link your WhatsApp number.',
        link: { page: 'sales', tab: 'pipeline' },
        ctaLabel: 'Scan QR',
      },
      {
        step: 3,
        title: 'Launch WhatsApp Web or reply in CRM Threads',
        detail: 'Use the "WhatsApp Web" tab to launch a pre-filled chat in a docked window while logging every message to the lead thread.',
        link: { page: 'sales', tab: 'pipeline' },
        ctaLabel: 'Open Pipeline',
      },
    ],
  },
  {
    id: 'email-smtp-setup',
    title: 'Configure Outgoing Email (SMTP) & Test Delivery',
    summary: 'Connect your company mail server or Gmail so invoices, quotes, ticket replies, and digests deliver.',
    page: 'integrations',
    tab: 'connections',
    keywords: ['smtp', 'email setup', 'configure email', 'mail server', 'gmail', 'send email', 'maildog'],
    steps: [
      {
        step: 1,
        title: 'Enter SMTP credentials in Integrations → Connections',
        detail: 'Open Integrations → Connections, locate the SMTP card, and enter your host, port (587 or 465), username, password, and From address.',
        link: { page: 'integrations', tab: 'connections', sectionId: 'config-provider-smtp' },
        ctaLabel: 'Configure SMTP',
      },
      {
        step: 2,
        title: 'Save & test the connection',
        detail: 'Click "Save" then "Test" on the SMTP card (or send a test email under Integrations → Connected Apps).',
        link: { page: 'integrations', tab: 'connected', sectionId: 'config-email-section' },
        ctaLabel: 'Test Email',
      },
      {
        step: 3,
        title: 'Enable company email updates & digests',
        detail: 'Go to Settings → Email updates to choose recipients and turn on daily/weekly financial digests.',
        link: { page: 'settings', sectionId: 'config-email-updates' },
        ctaLabel: 'Email Updates',
      },
    ],
  },
  {
    id: 'build-knowledge-website',
    title: 'Build the Knowledge Base from Your Website URL',
    summary: 'Scan your public website to extract company facts, services, and pricing, then teach the AI agent fleet.',
    page: 'company',
    tab: 'knowledge',
    keywords: ['website', 'url', 'knowledge base', 'crawl', 'scan website', 'import website', 'teach fleet', 'train agents'],
    steps: [
      {
        step: 1,
        title: 'Open Company → Knowledge Base',
        detail: 'Navigate to Company → Knowledge Base and click "Build from Website URL" in the header.',
        link: { page: 'company', tab: 'knowledge' },
        ctaLabel: 'Open Knowledge Base',
      },
      {
        step: 2,
        title: 'Scan your domain & preview extracted facts',
        detail: 'Enter your company domain (e.g. yourcompany.com) and click "Scan Website". Borga reads your home, about, services, and pricing pages.',
        link: { page: 'company', tab: 'knowledge' },
        ctaLabel: 'Scan Website',
      },
      {
        step: 3,
        title: 'Approve facts & Teach Fleet',
        detail: 'Review or edit the extracted entries, keep the accurate ones checked, and click "Import & Teach Fleet" so all agents learn them immediately.',
        link: { page: 'company', tab: 'knowledge' },
        ctaLabel: 'Teach Fleet',
      },
    ],
  },
  {
    id: 'launch-paid-ads',
    title: 'Launch a Multi-Platform Paid Ad Campaign',
    summary: 'Select multiple ad networks (Google, Meta, LinkedIn, TikTok, X), allocate budget, and track ROAS.',
    page: 'marketing',
    tab: 'advertising',
    keywords: ['paid campaign', 'launch ad', 'google ads', 'meta ads', 'multi-platform', 'roas', 'advertising'],
    steps: [
      {
        step: 1,
        title: 'Open Marketing → Advertising',
        detail: 'Click "+ New campaign" in the top right of the Advertising tab.',
        link: { page: 'marketing', tab: 'advertising' },
        ctaLabel: 'Open Advertising',
      },
      {
        step: 2,
        title: 'Multi-select ad platforms & budget mode',
        detail: 'Toggle one or more platforms (Google, Meta, LinkedIn, etc.) and choose whether the budget is "Per platform" or "Split total evenly".',
        link: { page: 'marketing', tab: 'advertising' },
        ctaLabel: 'New Campaign',
      },
      {
        step: 3,
        title: 'Draft ad copy & launch',
        detail: 'Fill in the headline, body copy, and destination link, then click "Launch" to track spend, conversions, and ROAS per platform.',
        link: { page: 'marketing', tab: 'advertising' },
        ctaLabel: 'Track ROAS',
      },
    ],
  },
  {
    id: 'purchase-order-3way',
    title: 'Order Stock with a Purchase Order & 3-Way Match',
    summary: 'Email a Purchase Order to a supplier, receive goods into a warehouse, and auto-draft the vendor bill.',
    page: 'inventory',
    tab: 'orders',
    keywords: ['purchase order', 'po', 'order stock', 'receive stock', 'supplier', '3-way match', 'procurement'],
    steps: [
      {
        step: 1,
        title: 'Create a Purchase Order in Inventory → Purchase Orders',
        detail: 'Click "+ New purchase order", pick a supplier, add catalog items and quantities, and save the draft.',
        link: { page: 'inventory', tab: 'orders' },
        ctaLabel: 'Open Purchase Orders',
      },
      {
        step: 2,
        title: 'Email the PO to your supplier',
        detail: 'Click the green Send icon on the PO row to email the formatted Purchase Order and mark it "ordered".',
        link: { page: 'inventory', tab: 'orders' },
        ctaLabel: 'Email PO',
      },
      {
        step: 3,
        title: 'Receive goods & convert to Vendor Bill',
        detail: 'Expand the PO row when boxes arrive, enter received quantities, then click the Bill icon to create the matched Vendor Bill.',
        link: { page: 'finance', tab: 'vendors' },
        ctaLabel: 'Open Vendors & AP',
      },
    ],
  },
  {
    id: 'bank-reconciliation',
    title: 'Import Bank Statements & Reconcile Transactions',
    summary: 'Upload a CSV/PDF bank statement or connect a live feed, then match bank lines to invoices and bills.',
    page: 'finance',
    tab: 'banking',
    keywords: ['reconcile', 'bank statement', 'csv import', 'pdf statement', 'match transaction', 'banking'],
    steps: [
      {
        step: 1,
        title: 'Add or select a bank account in Finance → Banking',
        detail: 'Create your checking/savings account or select an existing account card.',
        link: { page: 'finance', tab: 'banking' },
        ctaLabel: 'Open Banking',
      },
      {
        step: 2,
        title: 'Import CSV or PDF statement',
        detail: 'Click "Import CSV" or "Import PDF" to parse statement lines automatically with duplicate protection.',
        link: { page: 'finance', tab: 'banking' },
        ctaLabel: 'Import Statement',
      },
      {
        step: 3,
        title: 'Accept auto-matches or book to GL',
        detail: 'Review suggested invoice/bill matches and click "Match" or "Book to ledger" until Unmatched Lines reaches 0.',
        link: { page: 'finance', tab: 'banking' },
        ctaLabel: 'Reconcile Lines',
      },
    ],
  },
  {
    id: 'run-payroll',
    title: 'Run Monthly Payroll & Post Balanced GL Journals',
    summary: 'Calculate gross pay, statutory taxes, and net pay for your team, then release payroll once per month.',
    page: 'hr',
    tab: 'payroll',
    keywords: ['run payroll', 'pay team', 'salary', 'payslip', 'payroll journal', 'paye', 'ssnit', 'fica'],
    steps: [
      {
        step: 1,
        title: 'Verify employees in HR → Directory',
        detail: 'Ensure active team members have their compensation, role, and tax jurisdiction set.',
        link: { page: 'hr', tab: 'directory' },
        ctaLabel: 'Open Directory',
      },
      {
        step: 2,
        title: 'Review the monthly batch in HR → Payroll',
        detail: 'Check gross-to-net calculations, employee deductions, and employer statutory contributions.',
        link: { page: 'hr', tab: 'payroll' },
        ctaLabel: 'Open Payroll',
      },
      {
        step: 3,
        title: 'Release payroll & post to Accounting',
        detail: 'Confirm and release the month — Borga locks the snapshot and posts balanced salary/tax journals to your Chart of Accounts.',
        link: { page: 'finance', tab: 'accounting' },
        ctaLabel: 'Check Journals',
      },
    ],
  },
  {
    id: 'hire-shared-advisor',
    title: 'Hire an Accountant, PM or Agency in Shared Services',
    summary: 'Book a discovery call or purchase a package, and grant module-scoped access ($0 seat cost).',
    page: 'services',
    tab: 'marketplace',
    keywords: ['shared services', 'hire advisor', 'accountant', 'bookkeeper', 'agency', 'cfo', 'module access'],
    steps: [
      {
        step: 1,
        title: 'Browse vetted professionals in Shared Services',
        detail: 'Open Shared Services from the main sidebar and filter by Accounting, Project Management, Sales, or Marketing.',
        link: { page: 'services', tab: 'marketplace' },
        ctaLabel: 'Open Marketplace',
      },
      {
        step: 2,
        title: 'Book a call or purchase a fixed-price package',
        detail: 'Pick an available time slot for a discovery call, or buy an upfront package directly.',
        link: { page: 'services', tab: 'marketplace' },
        ctaLabel: 'Browse Advisors',
      },
      {
        step: 3,
        title: 'Grant module-scoped workspace access',
        detail: 'Choose which tabs the advisor can access (e.g. Finance only). External advisors never add a $2/month seat to your bill.',
        link: { page: 'services', tab: 'engagements' },
        ctaLabel: 'Manage Access',
      },
    ],
  },
  {
    id: 'support-sla-mailbox',
    title: 'Set Up Support Desk SLAs & Email-to-Ticket',
    summary: 'Track customer issues with response/resolution SLA timers and reply directly by email.',
    page: 'support',
    tab: 'tickets',
    keywords: ['support ticket', 'helpdesk', 'sla timer', 'mailbox', 'customer support', 'reply ticket'],
    steps: [
      {
        step: 1,
        title: 'Configure SLA targets & mailbox in Support → SLA & Mailbox',
        detail: 'Set first-response and resolution targets by priority (P0–P3) and copy your inbound ticket bridge address.',
        link: { page: 'support', tab: 'settings' },
        ctaLabel: 'SLA & Mailbox',
      },
      {
        step: 2,
        title: 'Triage & assign tickets in Support → Tickets',
        detail: 'Filter by Breached or At-Risk SLAs, assign an owner, and post public replies (emailed to the requester) or internal notes.',
        link: { page: 'support', tab: 'tickets' },
        ctaLabel: 'Open Support Desk',
      },
    ],
  },
  {
    id: 'close-books',
    title: 'Close the Books & Export Financial Statements',
    summary: 'Complete the month-end checklist, post depreciation/FX entries, and lock the accounting period.',
    page: 'finance',
    tab: 'closure',
    keywords: ['close books', 'month end', 'book closure', 'trial balance', 'financial statements', 'p&l', 'balance sheet'],
    steps: [
      {
        step: 1,
        title: 'Review the outstanding checklist in Finance → Book Closure',
        detail: 'Check unposted journals, unreconciled bank lines, fixed-asset depreciation, and AR/AP tie-outs.',
        link: { page: 'finance', tab: 'closure' },
        ctaLabel: 'Open Book Closure',
      },
      {
        step: 2,
        title: 'Sign off & lock the period',
        detail: 'Close the period so historical entries cannot be altered without an explicit reopen audit trail.',
        link: { page: 'finance', tab: 'closure' },
        ctaLabel: 'Lock Period',
      },
      {
        step: 3,
        title: 'Export P&L, Balance Sheet & Cash Flow',
        detail: 'Open Finance → Reports to inspect, share, or schedule automated email delivery of your statements.',
        link: { page: 'finance', tab: 'reports' },
        ctaLabel: 'Open Reports',
      },
    ],
  },
];

const HOW_TO_INTENT_WORDS = [
  'how to',
  'how do i',
  'how can i',
  'steps to',
  'guide',
  'walk me through',
  'walkthrough',
  'where do i',
  'where can i',
  'help me',
  'teach me',
  'set up',
  'setup',
  'configure',
  'create a',
  'send a',
  'import a',
];

export function isHowToQuestion(question: string): boolean {
  const q = question.toLowerCase().trim();
  return HOW_TO_INTENT_WORDS.some((w) => q.includes(w));
}

export function matchHowToGuide(question: string): HowToGuide | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;
  let best: { guide: HowToGuide; score: number } | null = null;
  for (const g of HOW_TO_GUIDES) {
    let score = 0;
    for (const kw of g.keywords) {
      if (q.includes(kw.toLowerCase())) {
        score += kw.includes(' ') ? 3 : 2;
      }
    }
    if (q.includes(g.page.toLowerCase())) score += 1;
    if (g.tab && q.includes(g.tab.toLowerCase())) score += 1;
    if (score > 0 && (!best || score > best.score)) {
      best = { guide: g, score };
    }
  }
  return best ? best.guide : null;
}

export function guidesForPage(page: string, tab?: string): HowToGuide[] {
  const exactTab = HOW_TO_GUIDES.filter((g) => g.page === page && (!tab || g.tab === tab));
  const samePage = HOW_TO_GUIDES.filter((g) => g.page === page && !exactTab.includes(g));
  const rest = HOW_TO_GUIDES.filter((g) => g.page !== page);
  return [...exactTab, ...samePage, ...rest];
}

export function searchHowToGuides(query: string, page?: string, tab?: string): HowToGuide[] {
  const ordered = page ? guidesForPage(page, tab) : [...HOW_TO_GUIDES];
  const q = query.toLowerCase().trim();
  if (!q) return ordered;
  return ordered.filter((g) => {
    const hay = `${g.title} ${g.summary} ${g.page} ${g.tab ?? ''} ${g.keywords.join(' ')} ${g.steps.map((s) => `${s.title} ${s.detail}`).join(' ')}`.toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
}

export function formatHowToGuideAnswer(guide: HowToGuide): AdvisorAnswer {
  return {
    text: `How to ${guide.title.charAt(0).toLowerCase() + guide.title.slice(1)}: ${guide.steps.map((s) => `${s.step}. ${s.title} — ${s.detail}`).join(' ')}`,
    link: { page: guide.page, tab: guide.tab },
    guideTitle: guide.title,
    steps: guide.steps,
  };
}

/** Route an owner question to the slice of business data or step-by-step workflow guide that answers it. */
export function answerAdvisorQuestion(question: string, ctx: AdvisorContext, memory?: AdvisorMemory): AdvisorAnswer {
  // Padded so short keywords ('ar', 'ap', 'pay') only match whole words.
  const q = ` ${question.toLowerCase().trim()} `;
  if (!question.trim()) return { text: 'Ask me about cash, invoices, pipeline, goals, tickets, projects, stock, ads, team, comms, fundraising, knowledge, runs, banking, filings, social, integrations or KPIs — or ask "how do I…" for step-by-step workflow guides.' };

  // 1. Explicit "How to / How do I" questions route to step-by-step workflow playbooks first
  if (isHowToQuestion(question)) {
    const guide = matchHowToGuide(question);
    if (guide) return formatHowToGuideAnswer(guide);
  }

  // 2. Live business data topic routing
  const topic = routeAdvisorTopic(question);
  if (topic) return withRelated(topic, topicAnswer(topic, ctx));

  // 3. Fallback to How-To guide match if a user typed a workflow name directly
  const fallbackGuide = matchHowToGuide(question);
  if (fallbackGuide) return formatHowToGuideAnswer(fallbackGuide);

  // 4. Conversational follow-ups resolve against what we just talked about.
  const last = memory?.topic;
  if (has(q, ...FOLLOWUP_THANKS)) {
    return { text: `Anytime! ${last ? `We were on ${ADVISOR_TOPIC_META[last].label.toLowerCase()} — say "tell me more" to go deeper, or ask about anything else.` : 'Ask me about anything else — cash, pipeline, tickets, KPIs…'} ` };
  }
  if (has(q, ...FOLLOWUP_ACTION)) {
    if (last && last !== 'brief') {
      const a = topicAnswer(last, ctx);
      return { text: `${a.text} My recommendation: ${actionAnswer(ctx).text}`, link: a.link };
    }
    return actionAnswer(ctx);
  }
  if (last && has(q, ...FOLLOWUP_MORE)) {
    const a = topicAnswer(last, ctx);
    return withRelated(last, { ...a, text: `Going deeper on ${ADVISOR_TOPIC_META[last].label.toLowerCase()}: ${a.text}` });
  }
  return { text: 'I answer from live numbers on cash, invoices, bills, pipeline, goals, tickets, projects, stock, ads, team, revenue, customers, comms, fundraising, knowledge, runs, banking, filings, social, integrations and KPIs — or ask "how do I…" for step-by-step guides. Try "morning brief".' };
}
