import { NextResponse, type NextRequest } from 'next/server';
import {
  AGENTS,
  COMPOSIO_TOOLKITS,
  DEFAULT_COMPOSIO,
  DEFAULT_WHATSAPP,
  DEFAULT_ELEVENLABS,
  DEFAULT_SETTINGS,
  DEFAULT_MESSAGING_CHANNELS,
  INITIAL_WORKSPACES,
  INITIAL_APPROVALS,
  INITIAL_BROWSES,
  INITIAL_CHATS,
  INITIAL_CALLS,
  KNOWLEDGE_SEED,
  KNOWLEDGE_QUESTIONS,
  INITIAL_CONNECTIONS,
  INITIAL_EMPLOYEES,
  INITIAL_FINANCE,
  INITIAL_FUNDRAISING,
  INITIAL_GOALS,
  INITIAL_INVOICES,
  INITIAL_LEAVE,
  INITIAL_CUSTOMERS,
  INITIAL_CONTACTS,
  INITIAL_VENDORS,
  INITIAL_BILLS,
  INITIAL_COA,
  INITIAL_JOURNAL,
  INITIAL_BANK_ACCOUNTS,
  INITIAL_BANK_TXNS,
  INITIAL_TAX_PROFILES,
  INITIAL_BUDGETS,
  INITIAL_REVENUE_TRACKS,
  INITIAL_PROJECTS,
  INITIAL_RECONCILIATION_RULES,
  INITIAL_MCP_SERVERS,
  INITIAL_WORKFLOWS,
  INITIAL_LEADS,
  INITIAL_MEMORIES,
  INITIAL_OPS,
  INITIAL_POSTS,
  INITIAL_TASKS,
  INITIAL_MESSAGES,
  INITIAL_ADS,
  INITIAL_WEBHOOKS,
  INITIAL_KPI_GROUPS,
  INITIAL_SCHEDULED_TASKS,
  INITIAL_NOTICES,
  DEFAULT_LLM,
  LLM_PROVIDERS,
  VALUATION_CONFIG_SEED,
  type LlmProvider,
  type ValuationConfig,
  type AdCampaign,
  type Agent,
  type AgentMemory,
  type AppConnection,
  type Approval,
  type BrowseResult,
  type ChatThread,
  type CommsMessage,
  type ComposioConfig,
  type FinanceEntry,
  type ElevenLabsConfig,
  type CallRecord,
  type KnowledgeEntry,
  type KbQuestion,
  type SettingsState,
  type FundingOpportunity,
  type Goal,
  type KpiGroup,
  type Lead,
  type LlmSelection,
  type OpsState,
  type SocialPost,
  type Task,
  type Toolkit,
  type Webhook,
  type WhatsAppConfig,
  type ActivityEvent,
  type ScheduledTask,
  type AgentRun,
  type ProactiveNotice,
  type Workspace,
  type Employee,
  type LeaveRequest,
  type Invoice,
  type MessagingChannelConfig,
  type SecureThread,
  type Customer,
  type Contact,
  type Vendor,
  type Bill,
  type GlAccount,
  type JournalEntry,
  type BankAccount,
  type BankTxn,
  type Workflow,
  type BookClosure,
  type TimeEntry,
  type TeamInvite,
  type TaxProfile,
  type Budget,
  type RevenueTrack,
  type Project,
  type ReconciliationRule,
  type McpServer,
} from '@/lib/borga/data';
import { getBorgaRowsByPrefixOrThrow, setBorgaState, setBorgaStateIfVersion } from '@/lib/borga/persistence';
import type { RecurringBill, RecurringInvoice } from '@/lib/borga/recurring';
import { EMPTY_FILINGS, type FilingsState } from '@/lib/borga/filing-catalog';
import { billingInfo, paymentRequired } from '@/lib/borga/billing-server';
import { EMPTY_FIXED_ASSETS, type FixedAssetsState } from '@/lib/borga/fixed-asset-journals';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { userWorkspacesKey, userWsKey, isValidUserId, isValidWsId } from '@/lib/borga/keys';

export const runtime = 'nodejs';

// Entities that live inside a workspace scope vs the global registry.
export const WORKSPACE_ENTITIES = [
  'agents', 'goals', 'approvals', 'finance', 'toolkits', 'connections', 'ops', 'composio',
  'messages', 'ads', 'webhooks', 'kpis', 'llm', 'llmCatalog', 'valuation', 'fundraising', 'browses', 'whatsapp', 'chats',
  'elevenlabs', 'calls', 'knowledge', 'kbquestions', 'settings', 'tasks', 'posts', 'leads',
  'activity', 'memories', 'scheduledTasks', 'agentRuns', 'notices',
  'employees', 'leave', 'invoices', 'messagingChannels', 'secureChats',
  'customers', 'contacts', 'vendors', 'bills', 'coa', 'journals', 'bankAccounts', 'bankTxns',
  'workflows', 'closures', 'timeEntries', 'invites', 'taxProfiles', 'budgets', 'revenueTracks', 'projects', 'reconciliationRules',
  'mcpServers', 'recurringInvoices', 'recurringBills', 'filings', 'fixedAssets',
] as const;

const GLOBAL_ENTITIES = ['workspaces'] as const;

const ALLOWED_ENTITIES = new Set<string>([...WORKSPACE_ENTITIES, ...GLOBAL_ENTITIES]);

const DEFAULT_STATE = {
  agents: AGENTS,
  goals: INITIAL_GOALS,
  approvals: INITIAL_APPROVALS,
  finance: INITIAL_FINANCE,
  toolkits: COMPOSIO_TOOLKITS,
  connections: INITIAL_CONNECTIONS,
  ops: INITIAL_OPS,
  composio: DEFAULT_COMPOSIO,
  messages: INITIAL_MESSAGES,
  ads: INITIAL_ADS,
  webhooks: INITIAL_WEBHOOKS,
  kpis: INITIAL_KPI_GROUPS,
  llm: DEFAULT_LLM,
  llmCatalog: LLM_PROVIDERS,
  valuation: VALUATION_CONFIG_SEED,
  fundraising: INITIAL_FUNDRAISING,
  browses: INITIAL_BROWSES,
  whatsapp: DEFAULT_WHATSAPP,
  chats: INITIAL_CHATS,
  elevenlabs: DEFAULT_ELEVENLABS,
  calls: INITIAL_CALLS,
  knowledge: KNOWLEDGE_SEED,
  kbquestions: KNOWLEDGE_QUESTIONS,
  settings: DEFAULT_SETTINGS,
  tasks: INITIAL_TASKS,
  posts: INITIAL_POSTS,
  leads: INITIAL_LEADS,
  activity: [],
  memories: INITIAL_MEMORIES,
  scheduledTasks: INITIAL_SCHEDULED_TASKS,
  agentRuns: [],
  employees: INITIAL_EMPLOYEES,
  leave: INITIAL_LEAVE,
  invoices: INITIAL_INVOICES,
  messagingChannels: DEFAULT_MESSAGING_CHANNELS,
  secureChats: [] as SecureThread[],
  customers: INITIAL_CUSTOMERS,
  contacts: INITIAL_CONTACTS,
  vendors: INITIAL_VENDORS,
  bills: INITIAL_BILLS,
  coa: INITIAL_COA,
  journals: INITIAL_JOURNAL,
  bankAccounts: INITIAL_BANK_ACCOUNTS,
  bankTxns: INITIAL_BANK_TXNS,
  workflows: INITIAL_WORKFLOWS,
  closures: [],
  timeEntries: [],
  invites: [],
  taxProfiles: INITIAL_TAX_PROFILES,
  budgets: INITIAL_BUDGETS,
  revenueTracks: INITIAL_REVENUE_TRACKS,
  projects: INITIAL_PROJECTS,
  reconciliationRules: INITIAL_RECONCILIATION_RULES,
  mcpServers: INITIAL_MCP_SERVERS,
  recurringInvoices: [] as RecurringInvoice[],
  recurringBills: [] as RecurringBill[],
  filings: EMPTY_FILINGS,
  fixedAssets: EMPTY_FIXED_ASSETS,
  notices: INITIAL_NOTICES,
};

/** Resolve the authenticated user id from the session cookie. */
async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const ws = isValidWsId(wsParam) ? wsParam : null;

  // Single bulk fetch — one DB query instead of dozens of parallel ones.
  // The ping write runs concurrently to stamp the sentinel key.
  // A database error must not look like "no data": that would be shown as seed data and
  // then saved back over the user's real records. Fail with 503 and let the client hold writes.
  const all: Record<string, unknown> = {};
  // Version of each stored entity, keyed by entity name. The dashboard saves with the version it last read (see POST).
  const versions: Record<string, number> = {};
  let pinged: boolean;
  try {
    const prefix = ws ? userWsKey(userId, ws, '') : userWorkspacesKey(userId);
    const [rows, ok] = await Promise.all([getBorgaRowsByPrefixOrThrow(prefix), setBorgaState('borga_ping', Date.now())]);
    pinged = ok;
    for (const [k, r] of Object.entries(rows)) {
      all[k] = r.value;
      if (ws) versions[k.slice(prefix.length)] = r.version;
      else if (k === prefix) versions.workspaces = r.version;
    }
  } catch {
    return NextResponse.json({ error: 'database_unavailable', workspaces: [], persisted: false }, { status: 503 });
  }

  const rawGet = <T>(key: string): T | null => (all[key] as T | undefined) ?? null;

  // Per-user workspace registry is always returned unprefixed under its key.
  const workspaces = rawGet<Workspace[]>(userWorkspacesKey(userId)) ?? [];

  if (!ws) {
    return NextResponse.json({
      workspaces: workspaces.length ? workspaces : INITIAL_WORKSPACES,
      persisted: pinged === true,
      versions,
    });
  }

  const get = <T>(entity: string): T | null => rawGet<T>(userWsKey(userId, ws, entity));

  // what this company is charged and whether it may be used: the dashboard shows the paywall from this
  const billing = await billingInfo(userId, ws, { sync: false }).catch(() => null);

  return NextResponse.json({
    workspace: ws,
    workspaces,
    versions,
    billing,
    agents: get<Agent[]>('agents') ?? DEFAULT_STATE.agents,
    goals: get<Goal[]>('goals') ?? DEFAULT_STATE.goals,
    approvals: get<Approval[]>('approvals') ?? DEFAULT_STATE.approvals,
    finance: get<FinanceEntry[]>('finance') ?? DEFAULT_STATE.finance,
    // Always use the full static catalog; overlay installed/connection state from DB.
    toolkits: (() => {
      const dbToolkits = get<Toolkit[]>('toolkits') ?? [];
      const statusById = new Map(dbToolkits.map((t) => [t.id, { installed: t.installed, installedAt: t.installedAt }]));
      return COMPOSIO_TOOLKITS.map((t) => ({ ...t, ...statusById.get(t.id) }));
    })(),
    connections: get<AppConnection[]>('connections') ?? DEFAULT_STATE.connections,
    ops: get<OpsState>('ops') ?? DEFAULT_STATE.ops,
    composio: get<ComposioConfig>('composio') ?? DEFAULT_STATE.composio,
    messages: get<CommsMessage[]>('messages') ?? DEFAULT_STATE.messages,
    ads: get<AdCampaign[]>('ads') ?? DEFAULT_STATE.ads,
    webhooks: get<Webhook[]>('webhooks') ?? DEFAULT_STATE.webhooks,
    kpis: get<KpiGroup[]>('kpis') ?? DEFAULT_STATE.kpis,
    llm: get<LlmSelection>('llm') ?? DEFAULT_STATE.llm,
    llmCatalog: get<LlmProvider[]>('llmCatalog') ?? DEFAULT_STATE.llmCatalog,
    valuation: get<ValuationConfig>('valuation') ?? DEFAULT_STATE.valuation,
    fundraising: get<FundingOpportunity[]>('fundraising') ?? DEFAULT_STATE.fundraising,
    browses: get<BrowseResult[]>('browses') ?? DEFAULT_STATE.browses,
    whatsapp: get<WhatsAppConfig>('whatsapp') ?? DEFAULT_STATE.whatsapp,
    chats: get<ChatThread[]>('chats') ?? DEFAULT_STATE.chats,
    elevenlabs: get<ElevenLabsConfig>('elevenlabs') ?? DEFAULT_STATE.elevenlabs,
    calls: get<CallRecord[]>('calls') ?? DEFAULT_STATE.calls,
    knowledge: get<KnowledgeEntry[]>('knowledge') ?? DEFAULT_STATE.knowledge,
    kbquestions: get<KbQuestion[]>('kbquestions') ?? DEFAULT_STATE.kbquestions,
    settings: get<SettingsState>('settings') ?? DEFAULT_STATE.settings,
    tasks: get<Task[]>('tasks') ?? DEFAULT_STATE.tasks,
    posts: get<SocialPost[]>('posts') ?? DEFAULT_STATE.posts,
    leads: get<Lead[]>('leads') ?? DEFAULT_STATE.leads,
    activity: get<ActivityEvent[]>('activity') ?? DEFAULT_STATE.activity,
    memories: get<AgentMemory[]>('memories') ?? DEFAULT_STATE.memories,
    scheduledTasks: get<ScheduledTask[]>('scheduledTasks') ?? DEFAULT_STATE.scheduledTasks,
    agentRuns: get<AgentRun[]>('agentRuns') ?? DEFAULT_STATE.agentRuns,
    notices: get<ProactiveNotice[]>('notices') ?? DEFAULT_STATE.notices,
    employees: get<Employee[]>('employees') ?? DEFAULT_STATE.employees,
    leave: get<LeaveRequest[]>('leave') ?? DEFAULT_STATE.leave,
    invoices: get<Invoice[]>('invoices') ?? DEFAULT_STATE.invoices,
    messagingChannels: get<MessagingChannelConfig[]>('messagingChannels') ?? DEFAULT_STATE.messagingChannels,
    secureChats: get<SecureThread[]>('secureChats') ?? DEFAULT_STATE.secureChats,
    customers: get<Customer[]>('customers') ?? DEFAULT_STATE.customers,
    contacts: get<Contact[]>('contacts') ?? DEFAULT_STATE.contacts,
    vendors: get<Vendor[]>('vendors') ?? DEFAULT_STATE.vendors,
    bills: get<Bill[]>('bills') ?? DEFAULT_STATE.bills,
    coa: get<GlAccount[]>('coa') ?? DEFAULT_STATE.coa,
    journals: get<JournalEntry[]>('journals') ?? DEFAULT_STATE.journals,
    bankAccounts: get<BankAccount[]>('bankAccounts') ?? DEFAULT_STATE.bankAccounts,
    bankTxns: get<BankTxn[]>('bankTxns') ?? DEFAULT_STATE.bankTxns,
    workflows: get<Workflow[]>('workflows') ?? DEFAULT_STATE.workflows,
    closures: get<BookClosure[]>('closures') ?? DEFAULT_STATE.closures,
    timeEntries: get<TimeEntry[]>('timeEntries') ?? DEFAULT_STATE.timeEntries,
    invites: get<TeamInvite[]>('invites') ?? DEFAULT_STATE.invites,
    taxProfiles: get<TaxProfile[]>('taxProfiles') ?? DEFAULT_STATE.taxProfiles,
    budgets: get<Budget[]>('budgets') ?? DEFAULT_STATE.budgets,
    revenueTracks: get<RevenueTrack[]>('revenueTracks') ?? DEFAULT_STATE.revenueTracks,
    projects: get<Project[]>('projects') ?? DEFAULT_STATE.projects,
    reconciliationRules: get<ReconciliationRule[]>('reconciliationRules') ?? DEFAULT_STATE.reconciliationRules,
    mcpServers: get<McpServer[]>('mcpServers') ?? DEFAULT_STATE.mcpServers,
    recurringInvoices: get<RecurringInvoice[]>('recurringInvoices') ?? DEFAULT_STATE.recurringInvoices,
    recurringBills: get<RecurringBill[]>('recurringBills') ?? DEFAULT_STATE.recurringBills,
    filings: get<FilingsState>('filings') ?? DEFAULT_STATE.filings,
    fixedAssets: get<FixedAssetsState>('fixedAssets') ?? DEFAULT_STATE.fixedAssets,
  });
}

// One entity is saved as a whole list (invoices, journals, bank transactions...), so this is the size of
// that list. 8 MB is far below the database limit (JSON values may be as large as max_allowed_packet,
// 64 MB by default on MySQL 8.4) and still small enough that one request cannot exhaust memory.
const MAX_PAYLOAD_BYTES = 8_000_000;

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    // Refuse by the declared size first so an oversized body is never read into memory.
    if (Number(req.headers.get('content-length') ?? 0) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
    }
    const raw = await req.text();
    if (!raw || Buffer.byteLength(raw) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
    }
    const body = JSON.parse(raw) as { entity?: string; value?: unknown; ws?: unknown; baseVersion?: unknown };
    const entity = body?.entity;
    if (typeof entity !== 'string' || !ALLOWED_ENTITIES.has(entity)) {
      return NextResponse.json({ ok: false, error: 'Unknown entity' }, { status: 400 });
    }

    let key: string;
    if (entity === 'workspaces') {
      key = userWorkspacesKey(userId);
    } else {
      if (!isValidWsId(body.ws)) {
        return NextResponse.json({ ok: false, error: 'Workspace id required for this entity' }, { status: 400 });
      }
      key = userWsKey(userId, body.ws as string, entity);
      // A workspace that has not paid cannot be set up or used: nothing of its own is saved (see lib/borga/billing.ts).
      const unpaid = await paymentRequired(userId, body.ws as string);
      if (unpaid) return NextResponse.json({ ok: false, error: unpaid.error, billing: unpaid.billing }, { status: 402 });
    }

    // Optimistic save: the client says which version of this entity it last read. If the stored version has moved on (another
    // tab or device saved, or an agent changed it), nothing is written and the current copy comes back with 409, so a stale
    // tab can never silently overwrite newer data. A body without baseVersion is the older unconditional save.
    // A present but malformed baseVersion is an error, never "no check": a buggy client must not switch the protection off.
    if (body.baseVersion !== undefined && !(typeof body.baseVersion === 'number' && Number.isInteger(body.baseVersion) && body.baseVersion >= 0)) {
      return NextResponse.json({ ok: false, error: 'baseVersion must be a non-negative integer' }, { status: 400 });
    }
    const baseVersion = body.baseVersion as number | undefined;
    if (baseVersion !== undefined) {
      let r;
      try {
        r = await setBorgaStateIfVersion(key, body.value ?? null, baseVersion);
      } catch {
        return NextResponse.json({ ok: false, saved: false, error: 'database_unavailable' }, { status: 503 });
      }
      if (!r.ok) return NextResponse.json({ ok: false, saved: false, error: 'conflict', current: r.current }, { status: 409 });
      return NextResponse.json({ ok: true, saved: true, version: r.version });
    }
    const ok = await setBorgaState(key, body.value ?? null);
    if (!ok) return NextResponse.json({ ok: false, saved: false, error: 'database_unavailable' }, { status: 503 });
    return NextResponse.json({ ok: true, saved: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
}
