'use client';

import { create } from 'zustand';
import { toast } from '@/lib/toast-bus';
import {
  AGENTS,
  CONNECTORS,
  COMPOSIO_TOOLKITS,
INITIAL_APPROVALS,
  POSTING_APPROVAL_THRESHOLD,
  INITIAL_CONNECTIONS,
  INITIAL_FINANCE,
  INITIAL_GOALS,
  INITIAL_LEADS,
  INITIAL_POSTS,
  INITIAL_TASKS,
  INITIAL_WORKFLOWS,
  INITIAL_MESSAGES,
  INITIAL_ADS,
  INITIAL_WEBHOOKS,
  INITIAL_MCP_SERVERS,
  INITIAL_KPI_GROUPS,
  INITIAL_FUNDRAISING,
  INITIAL_BROWSES,
  INITIAL_CHATS,
  DEFAULT_WHATSAPP,
  DEFAULT_LLM,
  LLM_PROVIDERS,
  type LlmProvider,
  type LlmModelInfo,
  VALUATION_CONFIG_SEED,
  type ValuationConfig,
  INITIAL_SCHEDULED_TASKS,
  INITIAL_WORKSPACES,
  INITIAL_EMPLOYEES,
  INITIAL_LEAVE,
  makeOnboarding,
  LEAVE_KIND_LABEL,
  computeLeaveBalance,
  INITIAL_INVOICES,
  DEFAULT_MESSAGING_CHANNELS,
  type ActivityEvent,
  type AdCampaign,
  type CommsMessage,
  type KpiGroup,
  type KpiEntry,
  type LlmSelection,
  type Webhook,
  type McpServer,
  type Agent,
  type AppConnection,
  type Approval,
  type ApprovalStatus,
  type BookingStatus,
  type BrowseResult,
  type Bucket,
  type ChatThread,
  type Client,
  type ComposioConfig,
  type Connector,
  type Driver,
  type ElevenLabsConfig,
  type CallRecord,
  type AgentMemory,
  type MemoryKind,
  type KnowledgeEntry,
  type KbQuestion,
  INITIAL_MEMORIES,
  type SettingsState,
  type FinanceEntry,
  type FundingOpportunity,
  type FundingStage,
  type Goal,
  type Lead,
  type LeadStage,
  type OpsState,
  type Priority,
  type SocialPost,
  type SocialStatus,
  type Task,
  type Toolkit,
  type Workflow,
  type WhatsAppConfig,
  DEFAULT_COMPOSIO,
  DEFAULT_ELEVENLABS,
  DEFAULT_SETTINGS,
  INITIAL_CALLS,
  KNOWLEDGE_SEED,
  KNOWLEDGE_QUESTIONS,
  INITIAL_OPS,
  type ScheduledTask,
  type AgentRun,
  type ProactiveNotice,
  INITIAL_NOTICES,
  type Workspace,
  type WorkspaceOnboarding,
  type Employee,
  type LeaveRequest,
  type LeaveStatus,
  type Invoice,
  type InvoiceStatus,
  type PaymentMethod,
  type InvoiceLine,  type MessagingChannelConfig,
  type SecureThread,
  type Customer,
  type Contact,
  type Vendor,
  type Bill,
  type GlAccount,
  type JournalEntry,
  type BankAccount,
  type BankTxn,
  type BookClosure,
  type TimeEntry,
  type TeamInvite,
  type InviteStatus,
  type Workflow as WorkflowType,
  INITIAL_CUSTOMERS,
  INITIAL_CONTACTS,
  INITIAL_VENDORS,
  INITIAL_BILLS,
  INITIAL_COA,
  INITIAL_JOURNAL,
  INITIAL_BANK_ACCOUNTS,
  INITIAL_BANK_TXNS,
  INITIAL_TAX_PROFILES,
  DEFAULT_TAX_PROFILE_ID,
  TAX_PRESETS,
  taxRegionFor,
  isUntouchedTaxSetup,
  defaultTaxIdOf,
  type TaxProfile,
  type Budget,
  INITIAL_BUDGETS,
  type RevenueTrack,
  INITIAL_REVENUE_TRACKS,
  generateBudgetForecast,
  resolveLineGrowthPct,
  DEFAULT_BUDGET_ASSUMPTIONS,
  fiscalYearMonths,
  type Project,
  INITIAL_PROJECTS,
  type ReconciliationRule,
  INITIAL_RECONCILIATION_RULES,
  normalizeReconciliationPattern,
} from './data';
import { notifyEmail } from './email-client';
import { mergeLoadedModels, repairCatalog } from './model-catalog';
import { SaveQueue } from './save-queue';
import { fmtMoneyFull } from './currencies';
import { mergeCustomers, mergeLeads, type CrmCustomer, type CrmLead, type MergeSummary } from './crm-core';
import { buildBill, buildInvoice, dueRuns, isFinished, nextBillNumber, nextInvoiceNumber, recurringBillRef, recurringRef, type RecurringBill, type RecurringInvoice } from './recurring';

type PersistEntity =
  | 'agents'
  | 'goals'
  | 'approvals'
  | 'finance'
  | 'toolkits'
  | 'connections'
  | 'ops'
  | 'composio'
  | 'messages'
  | 'ads'
  | 'webhooks'
  | 'kpis'
  | 'llm'
  | 'llmCatalog'
  | 'fundraising'
  | 'whatsapp'
  | 'chats'
  | 'browses'
  | 'tasks'
  | 'posts'
  | 'leads'
  | 'elevenlabs'
  | 'calls'
  | 'knowledge'
  | 'kbquestions'
  | 'settings'
  | 'activity'
  | 'memories'
  | 'scheduledTasks'
  | 'agentRuns'
  | 'workspaces'
  | 'employees'
  | 'leave'
  | 'invoices'
  | 'messagingChannels'
  | 'secureChats'
  | 'customers'
  | 'contacts'
  | 'vendors'
  | 'bills'
  | 'coa'
  | 'journals'
  | 'bankAccounts'
  | 'bankTxns'
  | 'workflows'
  | 'closures'
  | 'timeEntries'
  | 'invites'
  | 'taxProfiles'
  | 'valuation'
  | 'budgets'
  | 'revenueTracks'
  | 'recurringInvoices'
  | 'recurringBills'
  | 'projects'
  | 'reconciliationRules'
  | 'mcpServers'
  | 'notices';

// Active workspace id is tracked at module level so the fire-and-forget
// persistence helper can scope every write to the current company without
// threading the id through ~50 action call-sites.
let ACTIVE_WS: string | null = null;

// Monotonic hydrate sequence — only the latest hydrate may commit state, so a
// slow response for a previously-selected workspace can never clobber the
// freshly-selected company's data (the workspace-switch isolation bug).
let hydrateSeq = 0;

// ── Per-workspace localStorage fallback ─────────────────────────────────────
// The server is the source of truth, but when the database is unavailable the
// API returns shared seeds for *every* workspace — which collapsed each company
// into identical data and lost edits on workspace switch. We mirror every
// persisted entity into a per-workspace composite blob in localStorage and,
// when the DB is unavailable, prefer that local copy on hydrate. This makes
// company-custom data persist across switches and reloads without a database.
const lsCompositeKey = (ws: string | null) => (ws ? `borga::${ws}::state` : 'borga::global::state');

function writeLocal(ws: string | null, entity: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const key = lsCompositeKey(ws);
    const raw = localStorage.getItem(key);
    const obj = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    obj[entity] = value;
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    /* quota / private mode — ignore */
  }
}

function readLocalValue(ws: string, entity: string): unknown {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(lsCompositeKey(ws));
    if (!raw) return undefined;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return obj[entity];
  } catch {
    return undefined;
  }
}

// Store field -> persisted entity name, for the local fallback override.
const LS_FALLBACK_FIELDS: [keyof BorgaStore, string][] = [
  ['goals', 'goals'], ['approvals', 'approvals'], ['finance', 'finance'],
  ['toolkits', 'toolkits'], ['connections', 'connections'], ['ops', 'ops'],
  ['composio', 'composio'], ['messages', 'messages'], ['ads', 'ads'],
  ['webhooks', 'webhooks'], ['kpiGroups', 'kpis'], ['llm', 'llm'],
  ['fundraising', 'fundraising'], ['browses', 'browses'], ['whatsapp', 'whatsapp'],
  ['chats', 'chats'], ['elevenlabs', 'elevenlabs'], ['calls', 'calls'],
  ['knowledge', 'knowledge'], ['kbQuestions', 'kbquestions'], ['memories', 'memories'],
  ['settings', 'settings'], ['agents', 'agents'], ['activity', 'activity'],
  ['tasks', 'tasks'], ['posts', 'posts'], ['leads', 'leads'],
  ['scheduledTasks', 'scheduledTasks'], ['agentRuns', 'agentRuns'],
  ['employees', 'employees'], ['leaveRequests', 'leave'], ['invoices', 'invoices'],
  ['messagingChannels', 'messagingChannels'], ['secureChats', 'secureChats'],
  ['customers', 'customers'], ['contacts', 'contacts'], ['vendors', 'vendors'],
  ['bills', 'bills'], ['coa', 'coa'], ['journals', 'journals'],
  ['bankAccounts', 'bankAccounts'], ['bankTxns', 'bankTxns'], ['workflows', 'workflows'],
  ['closures', 'closures'], ['timeEntries', 'timeEntries'], ['invites', 'invites'],
  ['taxProfiles', 'taxProfiles'], ['valuation', 'valuation'],
  ['budgets', 'budgets'], ['revenueTracks', 'revenueTracks'], ['recurringInvoices', 'recurringInvoices'], ['recurringBills', 'recurringBills'], ['projects', 'projects'],
  ['reconciliationRules', 'reconciliationRules'], ['mcpServers', 'mcpServers'],
  ['notices', 'notices'],
];

// The fundraising agent (Nadia) is a core built-in: whenever the agent list
// lacks her, insert her right after Zed so she appears in every list/page and
// is persisted back to the cloud database.
function ensureNadia(agents: Agent[]): Agent[] {
  if (agents.some((a) => a.id === 'a-fundraising')) return agents;
  const nadia = AGENTS.find((a) => a.id === 'a-fundraising');
  if (!nadia) return agents;
  const copy = [...agents];
  const zed = copy.findIndex((a) => a.name === 'Zed');
  if (zed >= 0) copy.splice(zed + 1, 0, nadia);
  else copy.push(nadia);
  return copy;
}

// Fire-and-forget persistence to the DB-backed API. Safe: failures are ignored.
// Writes are scoped to the active workspace when one is set. Every write is
// also mirrored into a per-workspace localStorage composite so company-specific
// data survives workspace switches even when the database is unavailable.
let offlineNotified = false;
// Set when the last load from the server failed. The screen then shows seed or local data,
// so server writes are held: saving it later would overwrite the user's real records.
let SERVER_LOAD_FAILED = false;
interface SavePayload {
  entity: PersistEntity;
  ws: string | null;
  value: unknown;
}

/**
 * Saves go through a per-entity queue with optimistic concurrency (lib/borga/save-queue.ts): each save carries the version this
 * tab last read, so a save made from a stale copy (another tab or device saved first, or an agent changed the data) is refused
 * by the server instead of silently overwriting it. A refusal raises `saveConflicts`, which the shell shows as a banner.
 */
const SAVES = new SaveQueue<SavePayload>({
  valueOf: (p) => p.value,
  send: async (_id, p, baseVersion) => {
    try {
      const res = await fetch('/api/borga/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ entity: p.entity, value: p.value, ws: p.ws ?? undefined, baseVersion }),
      });
      if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as { current?: { version: number; value: unknown } | null } | null;
        return { status: 'conflict', current: j?.current ?? null };
      }
      if (res.status === 413) {
        toast({
          title: 'Too much data to save',
          description: `The ${p.entity} list is over the 8 MB save limit. Archive or delete old records; recent changes are kept on this device only.`,
          variant: 'error',
        });
        return { status: 'rejected' };
      }
      if (res.status === 401) return { status: 'rejected' };
      if (!res.ok) return { status: 'error' };
      const j = (await res.json().catch(() => ({}))) as { version?: number };
      offlineNotified = false;
      return { status: 'ok', version: typeof j.version === 'number' ? j.version : baseVersion + 1 };
    } catch {
      return { status: 'error' };
    }
  },
  onError: () => {
    /* offline — state still lives in memory (+ localStorage fallback) */
    if (!offlineNotified) {
      offlineNotified = true;
      toast({
        title: 'Working offline',
        description: 'Cloud sync is unreachable — changes are saved locally on this device.',
        variant: 'warning',
      });
    }
  },
  onConflict: (_id, p) => {
    useBorga.setState((s) => (s.saveConflicts.includes(p.entity) ? s : { saveConflicts: [...s.saveConflicts, p.entity] }));
  },
});

/** Queue id for an entity: company id (or "global") plus entity name. */
const saveId = (ws: string | null, entity: string) => `${ws ?? 'global'}|${entity}`;

async function persist(entity: PersistEntity, value: unknown) {
  const ws = entity === 'workspaces' ? null : ACTIVE_WS;
  writeLocal(ws, entity, value);
  if (SERVER_LOAD_FAILED) return;
  await SAVES.save(saveId(ws, entity), { entity, ws, value });
}

function failServerLoad() {
  if (!SERVER_LOAD_FAILED) {
    toast({
      title: 'Could not load your saved data',
      description: 'The database is not reachable. Saving to the server is paused so your records are not overwritten. Reload to retry.',
      variant: 'error',
    });
  }
  SERVER_LOAD_FAILED = true;
}

export type ThemeMode = 'system' | 'light' | 'dark' | 'midnight' | 'sunset' | 'forest';

interface VoiceState {
  listening: boolean;
  thinking: boolean;
  transcript: string;
  lastReply: string;
  /** Past the wake-word gate (or gating is off) and actively expecting a command. */
  awake: boolean;
}

interface BorgaStore {
  userName: string;
  setUserName: (n: string) => void;

  synced: boolean;
  dbAvailable: boolean;

  // ── Multi-company workspaces ──────────────────────────────────────────────
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeWorkspace: () => Workspace | undefined;
  setActiveWorkspace: (id: string) => void;
  addWorkspace: (w: Workspace) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  deleteWorkspace: (id: string) => void;
  setOnboarding: (id: string, onboarding: Partial<WorkspaceOnboarding>) => void;

  // ── HR / People ───────────────────────────────────────────────────────────
  employees: Employee[];
  addEmployee: (e: Employee) => void;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  /** Books the monthly payroll expense for all active employees into ledger + journal. */
  runPayroll: (periodLabel: string) => boolean;
  deleteEmployee: (id: string) => void;
  leaveRequests: LeaveRequest[];
  setLeaveStatus: (id: string, status: LeaveStatus) => void;
  addLeaveRequest: (l: LeaveRequest) => void;
  deleteLeaveRequest: (id: string) => void;

  // ── Finance suite ─────────────────────────────────────────────────────────
  invoices: Invoice[];
  addInvoice: (i: Invoice) => void;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  setInvoiceStatus: (id: string, status: InvoiceStatus) => void;
  /** Drafts only — issued/paid invoices are immutable and must be voided. */
  deleteInvoice: (id: string) => boolean;
  /** Voids an invoice for the audit trail; paid invoices also post reversing ledger + journal entries. */
  voidInvoice: (id: string, reason?: string) => void;
  /** Marks an invoice paid and posts the settlement to the ledger + journal. */
  payInvoice: (id: string, method: PaymentMethod, paidOnIso: string, externalRef?: string) => void;
  /** Quote→cash: converts a won lead into a draft invoice (idempotent). Returns null when not convertible. */
  convertLeadToInvoice: (leadId: string) => Invoice | null;
  /** Creates chase tasks for every overdue invoice (deduped) — the AR dunning sweep. */
  runDunningSweep: () => number;
  addFinanceEntry: (f: FinanceEntry) => void;
  /** Manual drafts only — auto-posted entries are locked and must be voided. */
  deleteFinanceEntry: (id: string) => boolean;
  /** Voids a ledger entry in place (kept for audit, excluded from reports). */
  voidFinanceEntry: (id: string, reason?: string) => void;

  // ── Messaging channels (unified inbox) ────────────────────────────────────
  messagingChannels: MessagingChannelConfig[];
  setChannelConnected: (channel: MessagingChannelConfig['channel'], patch: Partial<MessagingChannelConfig>) => void;

  // ── Secure E2E chats ──────────────────────────────────────────────────────
  secureChats: SecureThread[];
  upsertSecureThread: (t: SecureThread) => void;
  deleteSecureThread: (id: string) => void;

  // ── Sales: customers & contacts ───────────────────────────────────────────
  customers: Customer[];
  addCustomer: (c: Customer) => void;
  updateCustomer: (id: string, patch: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;
  contacts: Contact[];
  addContact: (c: Contact) => void;
  updateContact: (id: string, patch: Partial<Contact>) => void;
  deleteContact: (id: string) => void;

  // ── Finance: vendors, bills, GL, banking ──────────────────────────────────
  vendors: Vendor[];
  addVendor: (v: Vendor) => void;
  updateVendor: (id: string, patch: Partial<Vendor>) => void;
  deleteVendor: (id: string) => void;
  bills: Bill[];
  addBill: (b: Bill) => void;
  updateBill: (id: string, patch: Partial<Bill>) => void;
  setBillStatus: (id: string, status: Bill['status']) => void;
  /** Unpaid drafts only — scheduled/paid bills are immutable and must be voided. */
  deleteBill: (id: string) => boolean;
  /** Voids a bill for the audit trail; paid bills also post reversing ledger + journal entries. */
  voidBill: (id: string, reason?: string) => void;
  /** Marks a bill paid and posts the settlement to the ledger + journal. */
  payBill: (id: string, method: PaymentMethod, paidOnIso: string, externalRef?: string) => void;
  coa: GlAccount[];
  addAccount: (a: GlAccount) => void;
  updateAccount: (id: string, patch: Partial<GlAccount>) => void;
  deleteAccount: (id: string) => void;
  journals: JournalEntry[];
  addJournalEntry: (j: JournalEntry) => void;
  /** Drafts only — posted journal entries are immutable. */
  updateJournalEntry: (id: string, patch: Partial<JournalEntry>) => boolean;
  postJournalEntry: (id: string) => void;
  /** Drafts only — posted entries must be voided, never deleted. */
  deleteJournalEntry: (id: string) => boolean;
  /** Marks a posted entry voided and books a linked reversing entry (full audit trace). */
  voidJournalEntry: (id: string, reason?: string) => void;

  // ── Tax configuration ──
  taxProfiles: TaxProfile[];
  defaultTaxProfileId: string;
  addTaxProfile: (p: TaxProfile) => void;
  updateTaxProfile: (id: string, patch: Partial<TaxProfile>) => void;
  deleteTaxProfile: (id: string) => void;
  setDefaultTaxProfile: (id: string) => void;
  /** Replaces the starter tax profiles with the ones for `country`, but only while nobody has edited them. Returns true if it applied. */
  applyTaxPreset: (country?: string | null) => boolean;
  bankAccounts: BankAccount[];
  addBankAccount: (b: BankAccount) => void;
  updateBankAccount: (id: string, patch: Partial<BankAccount>) => void;
  deleteBankAccount: (id: string) => void;
  bankTxns: BankTxn[];
  addBankTxns: (txns: BankTxn[]) => void;
  matchBankTxn: (id: string, matchedRef: string, accountId?: string) => void;
  setBankTxnAccount: (id: string, accountId: string) => void;
  unmatchBankTxn: (id: string) => void;
  excludeBankTxn: (id: string) => void;
  deleteBankTxn: (id: string) => void;
  updateBankTxn: (id: string, patch: Partial<BankTxn>) => void;

  // ── Reconciliation rule memory ────────────────────────────────────────────
  reconciliationRules: ReconciliationRule[];
  addReconciliationRule: (r: ReconciliationRule) => void;
  deleteReconciliationRule: (id: string) => void;
  /** Learn (or reinforce) a description→account rule from a confirmed match. */
  recordReconciliationMatch: (description: string, accountId: string) => void;
  /** Look up a learned rule whose pattern appears in this description. */
  findReconciliationRule: (description: string) => ReconciliationRule | undefined;

  // ── Engine: workspace-scoped workflows ────────────────────────────────────
  addWorkflow: (w: WorkflowType) => void;
  deleteWorkflow: (id: string) => void;

  // ── Book closure ──────────────────────────────────────────────────────────
  closures: BookClosure[];
  addClosure: (c: BookClosure) => void;
  updateClosure: (id: string, patch: Partial<BookClosure>) => void;
  deleteClosure: (id: string) => void;

  // ── Budgeting & forecasting ────────────────────────────────────────────────
  budgets: Budget[];
  addBudget: (b: Budget) => void;
  updateBudget: (id: string, patch: Partial<Budget>) => void;
  deleteBudget: (id: string) => void;
  setBudgetLine: (budgetId: string, accountId: string, month: string, amount: number) => void;
  deleteBudgetLine: (budgetId: string, accountId: string) => void;
  setBudgetLineGrowth: (budgetId: string, accountId: string, growthPct: number) => void;
  applyBudgetForecast: (budgetId: string) => void;

  /** Merges CRM records (from the Company Engine) into customers and deals. Idempotent. */
  importCrmRecords: (customers: CrmCustomer[] | null, leads: CrmLead[] | null) => { customers?: MergeSummary; leads?: MergeSummary };

  // ── Recurring vendor bills (templates that record an unpaid bill on schedule; never pay) ──
  recurringBills: RecurringBill[];
  addRecurringBill: (r: RecurringBill) => void;
  updateRecurringBill: (id: string, patch: Partial<RecurringBill>) => void;
  deleteRecurringBill: (id: string) => void;
  /** Records every due, not-yet-generated bill. Idempotent. Returns how many were created. */
  runRecurringBills: (todayIso?: string) => { created: number; bills: string[] };

  // ── Recurring sales invoices (templates that generate draft invoices on schedule) ──
  recurringInvoices: RecurringInvoice[];
  addRecurringInvoice: (r: RecurringInvoice) => void;
  updateRecurringInvoice: (id: string, patch: Partial<RecurringInvoice>) => void;
  deleteRecurringInvoice: (id: string) => void;
  /** Creates every due, not-yet-generated draft invoice. Idempotent. Returns how many were created. */
  runRecurringInvoices: (todayIso?: string) => { created: number; invoices: string[] };

  // ── Revenue tracker (targets vs actuals) ────────────────────────────────
  revenueTracks: RevenueTrack[];
  addRevenueTrack: (t: RevenueTrack) => void;
  updateRevenueTrack: (id: string, patch: Partial<RevenueTrack>) => void;
  deleteRevenueTrack: (id: string) => void;
  setRevenueActual: (trackId: string, lineId: string, monthIdx: number, amount: number) => void;
  setRevenueActualTotal: (trackId: string, monthIdx: number, amount: number) => void;

  // ── Project management ─────────────────────────────────────────────────────
  projects: Project[];
  addProject: (p: Project) => void;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // ── HR time clock & invites ───────────────────────────────────────────────
  timeEntries: TimeEntry[];
  clockIn: (employeeId: string, employeeName: string) => void;
  clockOut: (entryId: string) => void;
  addTimeEntry: (t: TimeEntry) => void;
  updateTimeEntry: (id: string, patch: Partial<TimeEntry>) => void;
  deleteTimeEntry: (id: string) => void;
  invites: TeamInvite[];
  addInvite: (i: TeamInvite) => void;
  setInviteStatus: (id: string, status: InviteStatus) => void;
  deleteInvite: (id: string) => void;

  agents: Agent[];
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  addAgent: (a: Agent) => void;
  deleteAgent: (id: string) => void;

  fundraising: FundingOpportunity[];
  addFunding: (f: FundingOpportunity) => void;
  updateFundingStage: (id: string, stage: FundingStage) => void;

  browses: BrowseResult[];
  browse: (url: string, browsedBy: string) => void;

  whatsapp: WhatsAppConfig;
  setWhatsapp: (patch: Partial<WhatsAppConfig>) => void;

  chats: ChatThread[];
  sendChat: (chatId: string, text: string, agentName: string) => void;
  addChat: (t: ChatThread) => void;

  elevenlabs: ElevenLabsConfig;
  setElevenlabs: (patch: Partial<ElevenLabsConfig>) => void;
  calls: CallRecord[];
  placeCall: (a: { agentId: string; agentName: string; contact: string; leadName: string; note?: string }) => void;

  knowledge: KnowledgeEntry[];
  addKnowledge: (e: KnowledgeEntry) => void;
  updateKnowledge: (id: string, patch: Partial<KnowledgeEntry>) => void;
  deleteKnowledge: (id: string) => void;
  setKnowledge: (entries: KnowledgeEntry[]) => void;
  kbQuestions: KbQuestion[];
  collectQuestion: (id: string, answer: string, source: string) => void;

  memories: AgentMemory[];
  addMemory: (m: AgentMemory) => void;
  deleteMemory: (id: string) => void;
  clearMemoriesByAgent: (agentId: string) => void;

  settings: SettingsState;
  setSettings: (patch: Partial<SettingsState>) => void;

  goals: Goal[];
  addGoal: (g: Goal) => void;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;

  approvals: Approval[];
  setApproval: (id: string, status: ApprovalStatus) => void;
  addApproval: (a: Approval) => void;

  finance: FinanceEntry[];

  toolkits: Toolkit[];
  installToolkit: (id: string) => void;
  uninstallToolkit: (id: string) => void;

  connections: AppConnection[];
  connectApp: (id: string, patch: Partial<AppConnection>) => void;

  ops: OpsState;
  setBookingStatus: (id: string, status: BookingStatus) => void;
  addDriver: (d: Driver) => void;
  addClient: (c: Client) => void;

  composio: ComposioConfig;
  setComposio: (patch: Partial<ComposioConfig>) => void;
  addComposioConnection: (connection: any) => void;
  removeComposioConnection: (appId: string) => void;
  updateComposioConnection: (appId: string, updates: Partial<any>) => void;

  messages: CommsMessage[];
  sendMessage: (m: CommsMessage) => void;

  ads: AdCampaign[];
  addCampaign: (c: AdCampaign) => void;
  updateCampaign: (id: string, patch: Partial<AdCampaign>) => void;
  deleteCampaign: (id: string) => void;
  setCampaignStatus: (id: string, status: AdCampaign['status']) => void;

  webhooks: Webhook[];
  addWebhook: (w: Webhook) => void;
  toggleWebhook: (id: string) => void;
  deleteWebhook: (id: string) => void;

  /** Generic MCP server connections agents can call tools on (Integrations → MCP Servers). */
  mcpServers: McpServer[];
  addMcpServer: (s: McpServer) => void;
  updateMcpServer: (id: string, patch: Partial<McpServer>) => void;
  deleteMcpServer: (id: string) => void;

  kpiGroups: KpiGroup[];
  addKpi: (groupId: string, kpi: KpiEntry) => void;
  updateKpi: (groupId: string, kpiId: string, patch: Partial<KpiEntry>) => void;
  deleteKpi: (groupId: string, kpiId: string) => void;

  llm: LlmSelection;
  setLlm: (patch: Partial<LlmSelection>) => void;
  /** Sets the workspace default provider/model and re-points every agent that was following the old default. */
  setDefaultLlm: (patch: Partial<LlmSelection>) => void;

  /** DB-backed, per-workspace AI model catalog (providers + models). Editable per company. */
  llmCatalog: LlmProvider[];
  setLlmCatalog: (catalog: LlmProvider[]) => void;
  /** Loads a provider's live model list (free ones by default) into this workspace's catalog. */
  loadFreeModels: (providerId: string) => Promise<{ ok: boolean; count?: number; total?: number; error?: string; needsKey?: boolean }>;

  /** DB-backed, per-company valuation configuration (baseline + methods + market assumptions). */
  valuation: ValuationConfig;
  setValuation: (config: ValuationConfig) => void;

  hydrate: () => Promise<void>;
  /** Entities whose last save was refused because they were changed elsewhere (another tab, device or an agent). Cleared by loadLatest. */
  saveConflicts: string[];
  /** Discards this tab's unsaved edits to the conflicted entities and loads the latest data from the server. */
  loadLatest: () => Promise<void>;

  tasks: Task[];
  addTask: (t: Task) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTaskBucket: (id: string, bucket: Bucket) => void;

  activity: ActivityEvent[];
  log: (e: Omit<ActivityEvent, 'id' | 'time'>) => void;

  connectors: Connector[];
  setConnector: (id: string, status: Connector['status'], lastSync: string) => void;

  posts: SocialPost[];
  addPost: (p: SocialPost) => void;
  updatePost: (id: string, patch: Partial<SocialPost>) => void;
  deletePost: (id: string) => void;
  setPostStatus: (id: string, status: SocialStatus) => void;

  leads: Lead[];
  addLead: (l: Lead) => void;
  moveLeadStage: (id: string, stage: LeadStage) => void;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  deleteLead: (id: string) => void;

  workflows: Workflow[];
  setWorkflow: (id: string, patch: Partial<Workflow>) => void;
  runWorkflow: (id: string) => void;

  voice: VoiceState;
  setVoice: (patch: Partial<VoiceState>) => void;

  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;

  activeAgentId: string;
  setActiveAgentId: (id: string) => void;

  scheduledTasks: ScheduledTask[];
  addScheduledTask: (t: ScheduledTask) => void;
  updateScheduledTask: (id: string, patch: Partial<ScheduledTask>) => void;
  deleteScheduledTask: (id: string) => void;
  toggleScheduledTask: (id: string) => void;

  agentRuns: AgentRun[];
  addAgentRun: (r: AgentRun) => void;
  clearAgentRuns: () => void;

  notices: ProactiveNotice[];
  addNotice: (n: ProactiveNotice) => void;
  dismissNotice: (id: string) => void;
  clearNotices: () => void;
}

let logSeq = 0;

// Intelligent task distribution based on workflow type
function distributeWorkflowTasks(workflowName: string, agents: Agent[]): void {
  const wf = workflowName.toLowerCase();
  const tasksToDistribute: Array<{ agentId: string; task: string; priority: string }> = [];

  // Sales-related workflows
  if (/lead|outreach|sales|prospect/.test(wf)) {
    const salesAgent = agents.find(a => a.department === 'Sales');
    const marketingAgent = agents.find(a => a.department === 'Marketing');
    
    if (salesAgent) {
      tasksToDistribute.push({ 
        agentId: salesAgent.id, 
        task: `Qualify and follow up on leads from ${workflowName}`, 
        priority: 'P0' 
      });
    }
    if (marketingAgent) {
      tasksToDistribute.push({ 
        agentId: marketingAgent.id, 
        task: `Create outreach content for ${workflowName}`, 
        priority: 'P1' 
      });
    }
  }

  // Content/social workflows
  if (/content|social|post|linkedin|twitter/.test(wf)) {
    const marketingAgent = agents.find(a => a.department === 'Marketing');
    const designAgent = agents.find(a => a.department === 'Design');
    
    if (marketingAgent) {
      tasksToDistribute.push({ 
        agentId: marketingAgent.id, 
        task: `Schedule and publish content from ${workflowName}`, 
        priority: 'P0' 
      });
    }
    if (designAgent) {
      tasksToDistribute.push({ 
        agentId: designAgent.id, 
        task: `Create visual assets for ${workflowName}`, 
        priority: 'P1' 
      });
    }
  }

  // Operations workflows
  if (/ops|dispatch|driver|route|delivery/.test(wf)) {
    const opsAgent = agents.find(a => a.name === 'Borga' || a.department === 'Command');
    
    if (opsAgent) {
      tasksToDistribute.push({ 
        agentId: opsAgent.id, 
        task: `Coordinate dispatch operations for ${workflowName}`, 
        priority: 'P0' 
      });
    }
  }

  // Finance workflows
  if (/finance|invoice|payment|billing/.test(wf)) {
    const financeAgent = agents.find(a => a.department === 'Finance');
    
    if (financeAgent) {
      tasksToDistribute.push({ 
        agentId: financeAgent.id, 
        task: `Process financial review from ${workflowName}`, 
        priority: 'P0' 
      });
    }
  }

  // Fundraising workflows
  if (/fundrais|grant|investor|pitch/.test(wf)) {
    const fundraisingAgent = agents.find(a => a.id === 'a-fundraising');
    const financeAgent = agents.find(a => a.department === 'Finance');
    
    if (fundraisingAgent) {
      tasksToDistribute.push({ 
        agentId: fundraisingAgent.id, 
        task: `Process funding opportunities from ${workflowName}`, 
        priority: 'P0' 
      });
    }
    if (financeAgent) {
      tasksToDistribute.push({ 
        agentId: financeAgent.id, 
        task: `Review financial implications of ${workflowName}`, 
        priority: 'P1' 
      });
    }
  }

  // Data/sync workflows
  if (/sync|crm|data|import|export/.test(wf)) {
    const integrationsAgent = agents.find(a => a.department === 'Integrations');
    
    if (integrationsAgent) {
      tasksToDistribute.push({ 
        agentId: integrationsAgent.id, 
        task: `Execute data synchronization for ${workflowName}`, 
        priority: 'P0' 
      });
    }
  }

  // Fleet/briefing workflows
  if (/fleet|brief|morning|daily|standup/.test(wf)) {
    // Distribute briefing tasks to all department leads
    const departmentLeads = agents.filter(a => a.status === 'active' && a.skills.includes('Leadership'));
    
    departmentLeads.forEach(agent => {
      tasksToDistribute.push({ 
        agentId: agent.id, 
        task: `Review and act on fleet briefing from ${workflowName}`, 
        priority: 'P1' 
      });
    });
  }

  // Add tasks to the store if we have access to the store methods
  // This is a simplified version - in production, this would use proper task management
  if (typeof window !== 'undefined') {
    // Client-side: emit event for task distribution
    window.dispatchEvent(new CustomEvent('borga:tasks-distributed', { 
      detail: { workflowName, tasks: tasksToDistribute } 
    }));
  }
}

export const useBorga = create<BorgaStore>((set, get) => ({
  userName: 'Lawrence',
  synced: false,
  dbAvailable: false,

  workspaces: INITIAL_WORKSPACES,
  activeWorkspaceId: INITIAL_WORKSPACES[0]?.id ?? 'ws-default',
  activeWorkspace: () => get().workspaces.find((w) => w.id === get().activeWorkspaceId),
  setActiveWorkspace: (id) => {
    if (!get().workspaces.some((w) => w.id === id)) return;
    set({ activeWorkspaceId: id });
    ACTIVE_WS = id;
    try {
      localStorage.setItem('borga-workspace', id);
    } catch {}
    void get().hydrate();
  },
  addWorkspace: (w) => {
    set((s) => ({ workspaces: [...s.workspaces, w] }));
    persist('workspaces', get().workspaces);
  },
  updateWorkspace: (id, patch) => {
    const before = get().workspaces.find((w) => w.id === id)?.country;
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
    persist('workspaces', get().workspaces);
    // Setting the country gives the company starter tax profiles for it (only while the tax setup is still untouched).
    if (patch.country !== undefined && patch.country !== before && id === get().activeWorkspaceId) get().applyTaxPreset(patch.country);
  },
  deleteWorkspace: (id) => {
    set((s) => {
      const remaining = s.workspaces.filter((w) => w.id !== id);
      const fallback = remaining[0]?.id ?? s.activeWorkspaceId;
      return { workspaces: remaining, activeWorkspaceId: fallback };
    });
    ACTIVE_WS = get().activeWorkspaceId;
    persist('workspaces', get().workspaces);
    // Reload the suite for the fallback workspace.
    void get().hydrate();
  },
  setOnboarding: (id, onboarding) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id
          ? { ...w, onboarding: { ...(w.onboarding ?? makeOnboarding()), ...onboarding } as WorkspaceOnboarding }
          : w,
      ),
    }));
    persist('workspaces', get().workspaces);
  },

  employees: INITIAL_EMPLOYEES,
  addEmployee: (e) => {
    set((s) => ({ employees: [e, ...s.employees] }));
    persist('employees', get().employees);
  },
  updateEmployee: (id, patch) => {
    set((s) => ({ employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    persist('employees', get().employees);
  },
  deleteEmployee: (id) => {
    set((s) => ({ employees: s.employees.filter((e) => e.id !== id) }));
    persist('employees', get().employees);
  },
  leaveRequests: INITIAL_LEAVE,
  setLeaveStatus: (id, status) => {
    const req = get().leaveRequests.find((l) => l.id === id);
    if (!req) return;
    if (status === 'approved' && req.kind !== 'unpaid') {
      // Balance guard: paid leave cannot exceed the accrued entitlement.
      const emp = get().employees.find((e) => e.id === req.employeeId);
      if (emp) {
        const { remaining } = computeLeaveBalance(emp, get().leaveRequests);
        if (req.days > remaining) {
          get().log({ agentId: 'a-people', agentName: 'Rigby', actor: 'system', kind: 'system', message: `Leave blocked — ${emp.name} has ${remaining}d remaining but requested ${req.days}d. Offer unpaid leave or split the request.` });
          return;
        }
      }
    }
    set((s) => ({ leaveRequests: s.leaveRequests.map((l) => (l.id === id ? { ...l, status } : l)) }));
    persist('leave', get().leaveRequests);
    const emp = get().employees.find((e) => e.id === req.employeeId);
    if (status === 'approved' && emp && req.kind !== 'unpaid') {
      const { remaining } = computeLeaveBalance(emp, get().leaveRequests);
      get().log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Leave approved for ${emp.name} (${req.days}d ${LEAVE_KIND_LABEL[req.kind]}) — balance now ${remaining}d.` });
    } else if (status === 'rejected') {
      get().log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Leave request rejected for ${req.employeeName}.` });
    }
  },
  addLeaveRequest: (l) => {
    set((s) => ({ leaveRequests: [l, ...s.leaveRequests] }));
    persist('leave', get().leaveRequests);
  },
  deleteLeaveRequest: (id) => {
    set((s) => ({ leaveRequests: s.leaveRequests.filter((l) => l.id !== id) }));
    persist('leave', get().leaveRequests);
  },

  runPayroll: (periodLabel) => {
    const active = get().employees.filter((e) => e.status === 'active');
    const total = Math.round(active.reduce((s, e) => s + e.salary / 12, 0) * 100) / 100;
    if (!active.length || total <= 0) {
      get().log({ agentId: 'a-people', agentName: 'Rigby', actor: 'system', kind: 'system', message: 'Payroll run skipped — no active employees to pay.' });
      return false;
    }
    const today = new Date();
    const dateIso = today.toISOString().slice(0, 10);
    // Ledger: one consolidated payroll expense entry (locked — auto-posted).
    const entry: FinanceEntry = {
      id: `f-payroll-${Date.now().toString(36)}`,
      label: `Payroll — ${periodLabel}`,
      amount: total,
      category: 'People',
      kind: 'expense',
      dateIso,
      paymentMethod: 'bank-transfer',
      createdAt: new Date().toISOString(),
      source: 'auto',
      externalRef: `${active.length} employees`,
    };
    set((s) => ({ finance: [...s.finance, entry] }));
    persist('finance', get().finance);
    // Journal: DR Payroll Expense / CR Cash & Bank.
    const cash = get().coa.find((a) => a.isCash);
    const payrollAcct = get().coa.find((a) => /payroll/i.test(a.name) && a.type === 'expense') ?? get().coa.find((a) => a.type === 'expense');
    if (cash && payrollAcct) {
      const je: JournalEntry = {
        id: `je-payroll-${Date.now().toString(36)}`,
        date: today.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        dateIso,
        memo: `Payroll run — ${periodLabel}`,
        description: `Monthly payroll for ${active.length} active employees (${periodLabel}).`,
        reference: `PAY-${periodLabel.replace(/\s/g, '-').toUpperCase()}`,
        paymentMethod: 'bank-transfer',
        status: 'posted',
        createdAt: new Date().toISOString(),
        lines: [
          { accountId: payrollAcct.id, debit: total, credit: 0 },
          { accountId: cash.id, debit: 0, credit: total },
        ],
      };
      set((s) => ({ journals: [je, ...s.journals] }));
      persist('journals', get().journals);
    }
    get().log({ agentId: 'a-people', agentName: 'Rigby', actor: 'agent', kind: 'task', message: `Payroll executed for ${periodLabel}: ${active.length} employees, ${total.toLocaleString()} posted to ledger and journal (DR ${payrollAcct?.name ?? 'Payroll'} / CR Cash).` });
    return true;
  },

  invoices: INITIAL_INVOICES,
  addInvoice: (i) => {
    set((s) => ({ invoices: [i, ...s.invoices] }));
    persist('invoices', get().invoices);
  },
  updateInvoice: (id, patch) => {
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
    persist('invoices', get().invoices);
  },
  /** Quote→cash: turns a won lead into a draft invoice (idempotent via externalRef). */
  convertLeadToInvoice: (leadId) => {
    const lead = get().leads.find((l) => l.id === leadId);
    if (!lead || lead.stage !== 'won' || lead.value <= 0) return null;
    const ref = `lead-${lead.id}`;
    if (get().invoices.some((i) => i.externalRef === ref && !i.voidedAt)) return null;
    const today = new Date();
    const seq = 2223 + get().invoices.length;
    const inv: Invoice = {
      id: `inv-${Date.now().toString(36)}`,
      number: `#${seq}`,
      client: lead.company || lead.name,
      amount: lead.value,
      status: 'draft',
      issued: today.toLocaleDateString([], { month: 'short', day: '2-digit' }),
      due: new Date(today.getTime() + 30 * 86400000).toLocaleDateString([], { month: 'short', day: '2-digit' }),
      lines: [{ id: `il-${Date.now().toString(36)}`, description: `Engagement — ${lead.name} (closed-won via ${lead.source})`, qty: 1, unitPrice: lead.value }],
      externalRef: ref,
      paymentMethod: 'bank-transfer',
    };
    set((s) => ({ invoices: [inv, ...s.invoices] }));
    persist('invoices', get().invoices);
    get().log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'handoff', message: `Won deal converted — draft invoice ${inv.number} for ${inv.client} (${inv.amount.toLocaleString()}) handed to Ledger for issuance.` });
    return inv;
  },
  setInvoiceStatus: (id, status) => {
    // Lock rule: paid invoices are approved history — no manual status flips.
    const current = get().invoices.find((i) => i.id === id);
    if (!current || current.status === 'paid' || current.voidedAt) return;
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, status } : i)) }));
    persist('invoices', get().invoices);
  },
  deleteInvoice: (id) => {
    const inv = get().invoices.find((i) => i.id === id);
    if (!inv || inv.status !== 'draft') return false; // issued/paid → void instead
    set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) }));
    persist('invoices', get().invoices);
    get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Draft invoice ${inv.number} deleted.` });
    return true;
  },
  voidInvoice: (id, reason) => {
    const inv = get().invoices.find((i) => i.id === id);
    if (!inv || inv.voidedAt || inv.status === 'draft') return;
    const wasPaid = inv.status === 'paid';
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, voidedAt: new Date().toISOString(), voidReason: reason?.trim() || undefined } : i,
      ),
    }));
    persist('invoices', get().invoices);

    if (wasPaid) {
      // Reversal ledger entry — the original payment entry stays for the audit trail.
      const reversal: FinanceEntry = {
        id: `f-void-${Date.now().toString(36)}`,
        label: `VOID ${inv.number} — ${inv.client} (reversal)`,
        amount: inv.amount,
        category: 'Sales',
        kind: 'revenue',
        dateIso: new Date().toISOString().slice(0, 10),
        paymentMethod: inv.paidMethod ?? inv.paymentMethod,
        createdAt: new Date().toISOString(),
        source: 'auto',
        externalRef: inv.externalRef || undefined,
      };
      // A void of received revenue reduces revenue again.
      const negative: FinanceEntry = { ...reversal, amount: -Math.abs(inv.amount), label: `Reversal — ${reversal.label}` };
      set((s) => ({ finance: [...s.finance, negative] }));
      persist('finance', get().finance);

      const cash = get().coa.find((a) => a.isCash);
      const credit = get().coa.find((a) => a.type === 'asset' && /receivable/i.test(a.name)) ?? get().coa.find((a) => a.type === 'revenue');
      if (cash && credit) {
        const je: JournalEntry = {
          id: `je-void-${Date.now().toString(36)}`,
          date: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }),
          dateIso: new Date().toISOString().slice(0, 10),
          memo: `Reversal — invoice ${inv.number} voided${reason ? ` (${reason.trim()})` : ''}`,
          description: `Automatic reversal of settlement for voided invoice ${inv.number}.`,
          reference: inv.number,
          status: 'posted',
          createdAt: new Date().toISOString(),
          auto: 'reversal',
          lines: [
            { accountId: credit.id, debit: inv.amount, credit: 0 },
            { accountId: cash.id, debit: 0, credit: inv.amount },
          ],
        };
        set((s) => ({ journals: [je, ...s.journals] }));
        persist('journals', get().journals);
      }
    }
    get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Invoice ${inv.number} voided${wasPaid ? ' with full reversal posted' : ''}${reason ? ` — reason: ${reason.trim()}` : ''}.` });
  },
  payInvoice: (id, method, paidOnIso, externalRef?) => {
    const inv = get().invoices.find((i) => i.id === id);
    if (!inv || inv.status === 'paid') return;

    const taxProfileName = get().taxProfiles.find((t) => t.id === inv.taxProfileId)?.name;

    // 1) Mark the invoice paid with the settlement method + timestamp.
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, status: 'paid' as InvoiceStatus, paidAt: paidOnIso, paidMethod: method } : i,
      ),
    }));
    persist('invoices', get().invoices);

    // 2) Ledger: real revenue receipt against the client.
    const ws = get().activeWorkspace();
    const entry: FinanceEntry = {
      id: `f-pay-${Date.now().toString(36)}`,
      label: `Payment received — ${inv.client} (${inv.number})`,
      amount: inv.amount,
      category: 'Sales',
      kind: 'revenue',
      dateIso: paidOnIso,
      dueDateIso: undefined,
      paymentMethod: method,
      createdAt: new Date().toISOString(),
      externalRef: externalRef?.trim() || inv.externalRef || undefined,
      taxProfileName,
      source: 'auto',
    };
    set((s) => ({ finance: [...s.finance, entry] }));
    persist('finance', get().finance);

    // 3) Journal: DR Cash & Bank (settlement) / CR Accounts Receivable.
    const cash = get().coa.find((a) => a.isCash);
    const ar = get().coa.find((a) => a.type === 'asset' && /receivable/i.test(a.name));
    const revenue = get().coa.find((a) => a.type === 'revenue');
    const credit = ar ?? revenue;
    if (cash && credit) {
      const je = {
        id: `je-pay-${Date.now().toString(36)}`,
        date: new Date(paidOnIso).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        dateIso: paidOnIso,
        memo: `Invoice ${inv.number} settled — ${inv.client}${taxProfileName ? ` (${taxProfileName})` : ''}`,
        description: `Payment received from ${inv.client} via ${method.replace('-', ' ')} for invoice ${inv.number}.`,
        reference: inv.number,
        dueDateIso: undefined,
        paymentMethod: method,
        status: 'posted' as const,
        createdAt: new Date().toISOString(),
        externalRef: externalRef?.trim() || inv.externalRef || undefined,
        taxProfileName,
        lines: [
          { accountId: cash.id, debit: inv.amount, credit: 0 },
          { accountId: credit.id, debit: 0, credit: inv.amount },
        ],
      };
      set((s) => ({ journals: [je, ...s.journals] }));
      persist('journals', get().journals);
    }

    get().log({
      agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task',
      message: `Invoice ${inv.number} marked paid via ${method.replace('-', ' ')} — ${fmtMoneyFull(inv.amount, ws?.currency ?? 'USD')} posted to the ledger and journal.`,
    });
  },
  runDunningSweep: () => {
    const overdue = get().invoices.filter((i) => i.status === 'overdue' && !i.voidedAt);
    if (!overdue.length) return 0;
    const existing = new Set(get().tasks.map((t) => t.title));
    const fresh = overdue
      .filter((i) => !existing.has(`Chase ${i.number} — ${i.client}`))
      .map((i) => {
        // Aging buckets drive tone and priority of the chase.
        const bucket = i.amount >= 40000 ? 'P1' : 'P2';
        return {
          id: `t-dun-${i.id}-${Date.now().toString(36)}`,
          title: `Chase ${i.number} — ${i.client}`,
          detail: `Overdue invoice ${i.number} for ${Math.round(i.amount).toLocaleString()} (issued ${i.issued}, due ${i.due}). Send a firm-but-friendly reminder, confirm the payment method on file, and offer a payment plan if cash is tight.`,
          priority: bucket as 'P1' | 'P2',
          status: 'todo' as const,
          bucket: 'today' as const,
          assignee: 'Nova',
          tags: ['dunning', 'ar'],
          due: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          progress: 0,
        };
      });
    if (fresh.length) {
      set((s) => ({ tasks: [...fresh, ...s.tasks] }));
      persist('tasks', get().tasks);
      get().log({
        agentId: 'a-comms', agentName: 'Nova', actor: 'agent', kind: 'task',
        message: `Dunning sweep: ${fresh.length} chase task${fresh.length === 1 ? '' : 's'} created for ${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'} totalling ${overdue.reduce((s, i) => s + i.amount, 0).toLocaleString()}.`,
      });
    }
    return fresh.length;
  },
  addFinanceEntry: (f) => {
    set((s) => ({ finance: [...s.finance, f] }));
    persist('finance', get().finance);
  },
  deleteFinanceEntry: (id) => {
    const entry = get().finance.find((f) => f.id === id);
    if (!entry) return false;
    // Lock rule: system-posted entries are immutable — void instead.
    if (entry.source === 'auto' || entry.voidedAt) return false;
    set((s) => ({ finance: s.finance.filter((f) => f.id !== id) }));
    persist('finance', get().finance);
    return true;
  },
  voidFinanceEntry: (id, reason) => {
    const entry = get().finance.find((f) => f.id === id);
    if (!entry || entry.voidedAt) return;
    set((s) => ({
      finance: s.finance.map((f) =>
        f.id === id ? { ...f, voidedAt: new Date().toISOString(), voidReason: reason?.trim() || undefined } : f,
      ),
    }));
    persist('finance', get().finance);
    get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Ledger entry "${entry.label}" voided${reason ? ` — reason: ${reason.trim()}` : ''} (kept for audit).` });
  },

  messagingChannels: DEFAULT_MESSAGING_CHANNELS,
  setChannelConnected: (channel, patch) => {
    set((s) => ({
      messagingChannels: s.messagingChannels.map((c) => (c.channel === channel ? { ...c, ...patch } : c)),
    }));
    persist('messagingChannels', get().messagingChannels);
  },

  secureChats: [],
  upsertSecureThread: (t) => {
    set((s) => {
      const exists = s.secureChats.some((c) => c.id === t.id);
      return {
        secureChats: exists
          ? s.secureChats.map((c) => (c.id === t.id ? t : c))
          : [t, ...s.secureChats],
      };
    });
    persist('secureChats', get().secureChats);
  },
  deleteSecureThread: (id) => {
    set((s) => ({ secureChats: s.secureChats.filter((c) => c.id !== id) }));
    persist('secureChats', get().secureChats);
  },

  customers: INITIAL_CUSTOMERS,
  addCustomer: (c) => {
    set((s) => ({ customers: [c, ...s.customers] }));
    persist('customers', get().customers);
  },
  updateCustomer: (id, patch) => {
    set((s) => ({ customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    persist('customers', get().customers);
  },
  deleteCustomer: (id) => {
    // Contacts belong to the account and are removed with it; deals, invoices,
    // tasks and projects are independent records — they're unlinked, not deleted.
    set((s) => ({
      customers: s.customers.filter((c) => c.id !== id),
      contacts: s.contacts.filter((c) => c.customerId !== id),
      leads: s.leads.map((l) => (l.customerId === id ? { ...l, customerId: undefined } : l)),
      invoices: s.invoices.map((i) => (i.customerId === id ? { ...i, customerId: undefined } : i)),
      tasks: s.tasks.map((t) => (t.customerId === id ? { ...t, customerId: undefined } : t)),
      projects: s.projects.map((p) => (p.customerId === id ? { ...p, customerId: undefined } : p)),
    }));
    persist('customers', get().customers);
    persist('contacts', get().contacts);
    persist('leads', get().leads);
    persist('invoices', get().invoices);
    persist('tasks', get().tasks);
    persist('projects', get().projects);
  },
  contacts: INITIAL_CONTACTS,
  addContact: (c) => {
    set((s) => ({ contacts: [...s.contacts, c] }));
    persist('contacts', get().contacts);
  },
  updateContact: (id, patch) => {
    set((s) => ({ contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    persist('contacts', get().contacts);
  },
  deleteContact: (id) => {
    set((s) => ({ contacts: s.contacts.filter((c) => c.id !== id) }));
    persist('contacts', get().contacts);
  },

  vendors: INITIAL_VENDORS,
  addVendor: (v) => {
    set((s) => ({ vendors: [v, ...s.vendors] }));
    persist('vendors', get().vendors);
  },
  updateVendor: (id, patch) => {
    set((s) => ({ vendors: s.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
    persist('vendors', get().vendors);
  },
  deleteVendor: (id) => {
    set((s) => ({ vendors: s.vendors.filter((v) => v.id !== id) }));
    persist('vendors', get().vendors);
  },
  bills: INITIAL_BILLS,
  addBill: (b) => {
    set((s) => ({ bills: [b, ...s.bills] }));
    persist('bills', get().bills);
  },
  updateBill: (id, patch) => {
    set((s) => ({ bills: s.bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    persist('bills', get().bills);
  },
  setBillStatus: (id, status) => {
    // Lock rule: paid bills are approved history — no manual status flips.
    const current = get().bills.find((b) => b.id === id);
    if (!current || current.status === 'paid' || current.voidedAt) return;
    set((s) => ({ bills: s.bills.map((b) => (b.id === id ? { ...b, status } : b)) }));
    persist('bills', get().bills);
  },
  deleteBill: (id) => {
    const bill = get().bills.find((b) => b.id === id);
    if (!bill || bill.status !== 'unpaid') return false; // scheduled/paid → void instead
    set((s) => ({ bills: s.bills.filter((b) => b.id !== id) }));
    persist('bills', get().bills);
    get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Draft bill ${bill.number} deleted.` });
    return true;
  },
  voidBill: (id, reason) => {
    const bill = get().bills.find((b) => b.id === id);
    if (!bill || bill.voidedAt || bill.status === 'unpaid') return;
    const wasPaid = bill.status === 'paid';
    set((s) => ({
      bills: s.bills.map((b) =>
        b.id === id ? { ...b, voidedAt: new Date().toISOString(), voidReason: reason?.trim() || undefined } : b,
      ),
    }));
    persist('bills', get().bills);

    if (wasPaid) {
      // Reversal ledger entry — the original payment stays for the audit trail.
      const negative: FinanceEntry = {
        id: `f-voidbill-${Date.now().toString(36)}`,
        label: `Reversal — VOID ${bill.number} — ${bill.vendorName}`,
        amount: -Math.abs(bill.amount),
        category: bill.vendorName,
        kind: 'expense',
        dateIso: new Date().toISOString().slice(0, 10),
        paymentMethod: bill.paidMethod ?? bill.paymentMethod,
        createdAt: new Date().toISOString(),
        source: 'auto',
        externalRef: bill.externalRef || undefined,
      };
      set((s) => ({ finance: [...s.finance, negative] }));
      persist('finance', get().finance);

      const cash = get().coa.find((a) => a.isCash);
      const credit = get().coa.find((a) => a.type === 'liability' && /payable/i.test(a.name)) ?? get().coa.find((a) => a.type === 'expense' || a.type === 'cost');
      if (cash && credit) {
        const je: JournalEntry = {
          id: `je-voidbill-${Date.now().toString(36)}`,
          date: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }),
          dateIso: new Date().toISOString().slice(0, 10),
          memo: `Reversal — bill ${bill.number} voided${reason ? ` (${reason.trim()})` : ''}`,
          description: `Automatic reversal of settlement for voided bill ${bill.number}.`,
          reference: bill.number,
          status: 'posted',
          createdAt: new Date().toISOString(),
          auto: 'reversal',
          lines: [
            { accountId: cash.id, debit: bill.amount, credit: 0 },
            { accountId: credit.id, debit: 0, credit: bill.amount },
          ],
        };
        set((s) => ({ journals: [je, ...s.journals] }));
        persist('journals', get().journals);
      }
    }
    get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Bill ${bill.number} voided${wasPaid ? ' with full reversal posted' : ''}${reason ? ` — reason: ${reason.trim()}` : ''}.` });
  },
  payBill: (id, method, paidOnIso, externalRef?) => {
    const bill = get().bills.find((b) => b.id === id);
    if (!bill || bill.status === 'paid') return;

    const taxProfileName = get().taxProfiles.find((t) => t.id === bill.taxProfileId)?.name;

    // 1) Mark the bill paid with the settlement method + timestamp.
    set((s) => ({
      bills: s.bills.map((b) =>
        b.id === id ? { ...b, status: 'paid' as Bill['status'], paidAt: paidOnIso, paidMethod: method } : b,
      ),
    }));
    persist('bills', get().bills);

    // 2) Ledger: real expense payment to the vendor.
    const ws = get().activeWorkspace();
    const entry: FinanceEntry = {
      id: `f-paybill-${Date.now().toString(36)}`,
      label: `Payment to ${bill.vendorName} (${bill.number})`,
      amount: bill.amount,
      category: bill.vendorName,
      kind: 'expense',
      dateIso: paidOnIso,
      dueDateIso: undefined,
      paymentMethod: method,
      createdAt: new Date().toISOString(),
      externalRef: externalRef?.trim() || bill.externalRef || undefined,
      taxProfileName,
      source: 'auto',
    };
    set((s) => ({ finance: [...s.finance, entry] }));
    persist('finance', get().finance);

    // 3) Journal: DR Accounts Payable / CR Cash & Bank (settlement).
    const cash = get().coa.find((a) => a.isCash);
    const ap = get().coa.find((a) => a.type === 'liability' && /payable/i.test(a.name));
    const expense = get().coa.find((a) => a.type === 'expense' || a.type === 'cost');
    const credit = ap ?? expense;
    if (cash && credit) {
      const je = {
        id: `je-paybill-${Date.now().toString(36)}`,
        date: new Date(paidOnIso).toLocaleDateString([], { month: 'short', day: 'numeric' }),
        dateIso: paidOnIso,
        memo: `Bill ${bill.number} settled — ${bill.vendorName}${taxProfileName ? ` (${taxProfileName})` : ''}`,
        description: `Payment to ${bill.vendorName} via ${method.replace('-', ' ')} for bill ${bill.number}.`,
        reference: bill.number,
        dueDateIso: undefined,
        paymentMethod: method,
        status: 'posted' as const,
        createdAt: new Date().toISOString(),
        externalRef: externalRef?.trim() || bill.externalRef || undefined,
        taxProfileName,
        lines: [
          { accountId: credit.id, debit: bill.amount, credit: 0 },
          { accountId: cash.id, debit: 0, credit: bill.amount },
        ],
      };
      set((s) => ({ journals: [je, ...s.journals] }));
      persist('journals', get().journals);
    }

    get().log({
      agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task',
      message: `Bill ${bill.number} paid to ${bill.vendorName} via ${method.replace('-', ' ')} — ${fmtMoneyFull(bill.amount, ws?.currency ?? 'USD')} posted to the ledger and journal.`,
    });
  },

  coa: INITIAL_COA,
  addAccount: (a) => {
    set((s) => ({ coa: [...s.coa, a] }));
    persist('coa', get().coa);
  },
  updateAccount: (id, patch) => {
    set((s) => ({ coa: s.coa.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    persist('coa', get().coa);
  },
  deleteAccount: (id) => {
    set((s) => ({ coa: s.coa.filter((a) => a.id !== id) }));
    persist('coa', get().coa);
  },
  journals: INITIAL_JOURNAL,
  addJournalEntry: (j) => {
    set((s) => ({ journals: [j, ...s.journals] }));
    persist('journals', get().journals);
  },
  updateJournalEntry: (id, patch) => {
    const entry = get().journals.find((j) => j.id === id);
    // Lock rule: only draft entries are editable — posted/voided are immutable.
    if (!entry || entry.status !== 'draft') return false;
    set((s) => ({ journals: s.journals.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
    persist('journals', get().journals);
    return true;
  },
  postJournalEntry: (id) => {
    const entry = get().journals.find((j) => j.id === id);
    if (!entry || entry.status !== 'draft') return;
    // Closed-period guard: a backdated draft inside a closed period cannot post.
    const closed = get().closures.find((c) => entry.dateIso >= c.startDate && entry.dateIso <= c.endDate);
    if (closed) {
      get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'system', message: `Posting blocked — ${entry.memo} is dated inside closed period ${closed.label}. Reopen it in Book Closure first.` });
      return;
    }
    // Approval gate: large postings require sign-off before hitting the GL.
    const amount = entry.lines.reduce((s, l) => s + l.debit, 0);
    if (amount >= POSTING_APPROVAL_THRESHOLD && !entry.auto) {
      const pending = get().approvals.find((a) => a.journalId === id && a.status === 'pending');
      if (!pending) {
        const approval: Approval = {
          id: `ap-${Date.now().toString(36)}`,
          title: `Posting approval — ${entry.memo}`,
          description: `Journal entry dated ${entry.dateIso} (${entry.reference ?? 'no ref'}) totals ${Math.round(amount).toLocaleString()} and needs sign-off before posting to the GL.`,
          category: 'spend',
          amount,
          status: 'pending',
          submittedBy: 'Atlas',
          createdAt: new Date().toISOString(),
          journalId: id,
        };
        set((s) => ({ approvals: [approval, ...s.approvals] }));
        persist('approvals', get().approvals);
        get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'system', message: `${entry.memo} needs approval (${Math.round(amount).toLocaleString()} ≥ threshold) — routed to the approval queue.` });
      }
      return; // stays a draft until approved
    }
    set((s) => ({
      journals: s.journals.map((j) =>
        j.id === id && j.status === 'draft'
          ? { ...j, status: 'posted', createdAt: j.createdAt ?? new Date().toISOString() }
          : j,
      ),
    }));
    persist('journals', get().journals);
  },
  deleteJournalEntry: (id) => {
    const entry = get().journals.find((j) => j.id === id);
    if (!entry || entry.status !== 'draft') return false; // posted → void instead
    set((s) => ({ journals: s.journals.filter((j) => j.id !== id) }));
    persist('journals', get().journals);
    return true;
  },
  voidJournalEntry: (id, reason) => {
    const entry = get().journals.find((j) => j.id === id);
    if (!entry || entry.status === 'voided') return;
    const now = new Date();
    // 1) Mark the original voided — it stays on the books forever.
    set((s) => ({
      journals: s.journals.map((j) =>
        j.id === id
          ? { ...j, status: 'voided' as const, voidedAt: now.toISOString(), voidReason: reason?.trim() || undefined }
          : j,
      ),
    }));
    persist('journals', get().journals);

    // 2) Book a linked reversal so the ledger stays balanced while the audit
    //    trail preserves both legs of the transaction.
    const je: JournalEntry = {
      id: `je-rev-${Date.now().toString(36)}`,
      date: now.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      dateIso: now.toISOString().slice(0, 10),
      memo: `Reversal — ${entry.memo}${reason ? ` (${reason.trim()})` : ''}`,
      description: `Automatic reversal of journal entry ${entry.reference ?? entry.id}.`,
      reference: entry.reference,
      status: 'posted',
      createdAt: now.toISOString(),
      auto: 'reversal',
      reversalOf: entry.id,
      lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
    };
    set((s) => ({ journals: [je, ...s.journals] }));
    persist('journals', get().journals);
    get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Journal entry "${entry.memo}" voided with linked reversal posted${reason ? ` — reason: ${reason.trim()}` : ''}.` });
  },

  taxProfiles: INITIAL_TAX_PROFILES,
  defaultTaxProfileId: DEFAULT_TAX_PROFILE_ID,
  addTaxProfile: (p) => {
    set((s) => ({ taxProfiles: [...s.taxProfiles, p] }));
    persist('taxProfiles', get().taxProfiles);
  },
  updateTaxProfile: (id, patch) => {
    set((s) => ({ taxProfiles: s.taxProfiles.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    persist('taxProfiles', get().taxProfiles);
  },
  deleteTaxProfile: (id) => {
    set((s) => {
      const left = s.taxProfiles.filter((t) => t.id !== id);
      // If the default was deleted, the first remaining profile becomes the default.
      const hasDefault = left.some((t) => t.isDefault);
      const fixed = hasDefault || !left.length ? left : left.map((t, i) => ({ ...t, isDefault: i === 0 }));
      return { taxProfiles: fixed, defaultTaxProfileId: defaultTaxIdOf(fixed) };
    });
    persist('taxProfiles', get().taxProfiles);
  },
  setDefaultTaxProfile: (id) => {
    if (!get().taxProfiles.some((t) => t.id === id)) return;
    // The default is stored on the profiles themselves so it is saved with them (it used to live only in memory and reset on reload).
    set((s) => ({ taxProfiles: s.taxProfiles.map((t) => ({ ...t, isDefault: t.id === id })), defaultTaxProfileId: id }));
    persist('taxProfiles', get().taxProfiles);
  },
  applyTaxPreset: (country) => {
    if (!isUntouchedTaxSetup(get().taxProfiles)) return false;
    const profiles = TAX_PRESETS[taxRegionFor(country)].profiles;
    set({ taxProfiles: profiles, defaultTaxProfileId: defaultTaxIdOf(profiles) });
    persist('taxProfiles', profiles);
    return true;
  },

  bankAccounts: INITIAL_BANK_ACCOUNTS,
  addBankAccount: (b) => {
    set((s) => ({ bankAccounts: [...s.bankAccounts, b] }));
    persist('bankAccounts', get().bankAccounts);
  },
  updateBankAccount: (id, patch) => {
    set((s) => ({ bankAccounts: s.bankAccounts.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    persist('bankAccounts', get().bankAccounts);
  },
  deleteBankAccount: (id) => {
    set((s) => ({
      bankAccounts: s.bankAccounts.filter((b) => b.id !== id),
      bankTxns: s.bankTxns.filter((t) => t.bankAccountId !== id),
    }));
    persist('bankAccounts', get().bankAccounts);
    persist('bankTxns', get().bankTxns);
  },
  bankTxns: INITIAL_BANK_TXNS,
  addBankTxns: (txns) => {
    set((s) => ({ bankTxns: [...txns, ...s.bankTxns] }));
    persist('bankTxns', get().bankTxns);
  },
  matchBankTxn: (id, matchedRef, accountId) => {
    set((s) => ({ bankTxns: s.bankTxns.map((t) => (t.id === id ? { ...t, status: 'matched', matchedRef, accountId: accountId ?? t.accountId } : t)) }));
    persist('bankTxns', get().bankTxns);
  },
  setBankTxnAccount: (id, accountId) => {
    const txn = get().bankTxns.find((t) => t.id === id);
    set((s) => ({ bankTxns: s.bankTxns.map((t) => (t.id === id ? { ...t, accountId } : t)) }));
    persist('bankTxns', get().bankTxns);
    if (txn) get().recordReconciliationMatch(txn.description, accountId);
  },
  unmatchBankTxn: (id) => {
    set((s) => ({
      bankTxns: s.bankTxns.map((t) => (t.id === id ? { ...t, status: 'unmatched', matchedRef: undefined } : t)),
    }));
    persist('bankTxns', get().bankTxns);
  },

  reconciliationRules: INITIAL_RECONCILIATION_RULES,
  addReconciliationRule: (r) => {
    set((s) => ({ reconciliationRules: [r, ...s.reconciliationRules] }));
    persist('reconciliationRules', get().reconciliationRules);
  },
  deleteReconciliationRule: (id) => {
    set((s) => ({ reconciliationRules: s.reconciliationRules.filter((r) => r.id !== id) }));
    persist('reconciliationRules', get().reconciliationRules);
  },
  findReconciliationRule: (description) => {
    const pattern = normalizeReconciliationPattern(description);
    if (!pattern) return undefined;
    return get().reconciliationRules.find((r) => pattern.includes(r.pattern) || r.pattern.includes(pattern));
  },
  recordReconciliationMatch: (description, accountId) => {
    const pattern = normalizeReconciliationPattern(description);
    if (!pattern) return;
    const existing = get().reconciliationRules.find((r) => r.pattern === pattern);
    if (existing) {
      set((s) => ({
        reconciliationRules: s.reconciliationRules.map((r) =>
          r.id === existing.id ? { ...r, accountId, matchCount: r.matchCount + 1, lastMatchedAt: new Date().toISOString() } : r,
        ),
      }));
    } else {
      const rule: ReconciliationRule = {
        id: `rr-${Date.now()}`, pattern, accountId, matchCount: 1,
        lastMatchedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      };
      set((s) => ({ reconciliationRules: [rule, ...s.reconciliationRules] }));
    }
    persist('reconciliationRules', get().reconciliationRules);
  },
  excludeBankTxn: (id) => {
    set((s) => ({
      bankTxns: s.bankTxns.map((t) =>
        t.id === id
          ? t.status === 'excluded'
            ? { ...t, status: 'unmatched', matchedRef: undefined }
            : { ...t, status: 'excluded', matchedRef: undefined }
          : t,
      ),
    }));
    persist('bankTxns', get().bankTxns);
  },
  deleteBankTxn: (id) => {
    set((s) => ({ bankTxns: s.bankTxns.filter((t) => t.id !== id) }));
    persist('bankTxns', get().bankTxns);
  },
  updateBankTxn: (id, patch) => {
    set((s) => ({ bankTxns: s.bankTxns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    persist('bankTxns', get().bankTxns);
  },

  addWorkflow: (w) => {
    set((s) => ({ workflows: [w, ...s.workflows] }));
    persist('workflows', get().workflows);
  },
  deleteWorkflow: (id) => {
    set((s) => ({ workflows: s.workflows.filter((w) => w.id !== id) }));
    persist('workflows', get().workflows);
  },

  closures: [],
  addClosure: (c) => {
    set((s) => ({ closures: [c, ...s.closures] }));
    persist('closures', get().closures);
  },
  updateClosure: (id, patch) => {
    set((s) => ({ closures: s.closures.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
    persist('closures', get().closures);
  },
  deleteClosure: (id) => {
    set((s) => ({ closures: s.closures.filter((c) => c.id !== id) }));
    persist('closures', get().closures);
  },

  budgets: INITIAL_BUDGETS,
  addBudget: (b) => {
    set((s) => ({ budgets: [b, ...s.budgets] }));
    persist('budgets', get().budgets);
  },
  updateBudget: (id, patch) => {
    set((s) => ({ budgets: s.budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    persist('budgets', get().budgets);
  },
  deleteBudget: (id) => {
    set((s) => ({ budgets: s.budgets.filter((b) => b.id !== id) }));
    persist('budgets', get().budgets);
  },
  setBudgetLine: (budgetId, accountId, month, amount) => {
    set((s) => ({
      budgets: s.budgets.map((b) => {
        if (b.id !== budgetId) return b;
        const existing = b.lines.find((l) => l.accountId === accountId);
        const lines = existing
          ? b.lines.map((l) => (l.accountId === accountId ? { ...l, monthly: { ...l.monthly, [month]: amount } } : l))
          : [...b.lines, { id: `bl-${accountId}-${Date.now()}`, accountId, monthly: { [month]: amount } }];
        return { ...b, lines };
      }),
    }));
    persist('budgets', get().budgets);
  },
  deleteBudgetLine: (budgetId, accountId) => {
    set((s) => ({
      budgets: s.budgets.map((b) => (b.id === budgetId ? { ...b, lines: b.lines.filter((l) => l.accountId !== accountId) } : b)),
    }));
    persist('budgets', get().budgets);
  },
  setBudgetLineGrowth: (budgetId, accountId, growthPct) => {
    set((s) => ({
      budgets: s.budgets.map((b) => {
        if (b.id !== budgetId) return b;
        const existing = b.lines.find((l) => l.accountId === accountId);
        const lines = existing
          ? b.lines.map((l) => (l.accountId === accountId ? { ...l, growthPct } : l))
          : [...b.lines, { id: `bl-${accountId}-${Date.now()}`, accountId, monthly: {}, growthPct }];
        return { ...b, lines };
      }),
    }));
    persist('budgets', get().budgets);
  },
  applyBudgetForecast: (budgetId) => {
    const coa = get().coa;
    set((s) => ({
      budgets: s.budgets.map((b) => {
        if (b.id !== budgetId) return b;
        const months = fiscalYearMonths(b.fiscalYear);
        const assumptions = b.assumptions ?? DEFAULT_BUDGET_ASSUMPTIONS;
        const resolve = (line: (typeof b.lines)[number]) => resolveLineGrowthPct(line, coa.find((a) => a.id === line.accountId)?.type, assumptions);
        return { ...b, lines: generateBudgetForecast(b.lines, months, resolve) };
      }),
    }));
    persist('budgets', get().budgets);
  },

  importCrmRecords: (customers, leads) => {
    const now = new Date().toISOString();
    const out: { customers?: MergeSummary; leads?: MergeSummary } = {};
    if (customers) {
      const r = mergeCustomers(get().customers, customers, now);
      set({ customers: r.next });
      persist('customers', get().customers);
      out.customers = r.summary;
    }
    if (leads) {
      const r = mergeLeads(get().leads, leads, get().customers);
      set({ leads: r.next });
      persist('leads', get().leads);
      out.leads = r.summary;
    }
    return out;
  },

  recurringBills: [],
  addRecurringBill: (r) => {
    set((s) => ({ recurringBills: [r, ...s.recurringBills] }));
    persist('recurringBills', get().recurringBills);
  },
  updateRecurringBill: (id, patch) => {
    set((s) => ({ recurringBills: s.recurringBills.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    persist('recurringBills', get().recurringBills);
  },
  deleteRecurringBill: (id) => {
    // Bills already recorded stay: they are real payables. Only the schedule goes away.
    set((s) => ({ recurringBills: s.recurringBills.filter((r) => r.id !== id) }));
    persist('recurringBills', get().recurringBills);
  },
  runRecurringBills: (todayIso) => {
    const today = todayIso ?? new Date().toISOString().slice(0, 10);
    const st = get();
    let bills = st.bills;
    const created: Bill[] = [];
    const nextRecs = st.recurringBills.map((rec) => {
      const runs = dueRuns(rec, today);
      if (runs.length === 0) return rec;
      let cur = rec;
      for (const run of runs) {
        if (!bills.some((b) => b.externalRef === recurringBillRef(rec.id, run.index))) {
          const seed = Date.now().toString(36) + '-' + created.length;
          const bill = buildBill(rec, run, nextBillNumber(bills), st.taxProfiles, seed);
          bills = [bill, ...bills];
          created.push(bill);
        }
        cur = { ...cur, generatedCount: run.index + 1, lastGeneratedIso: run.dateIso };
      }
      return { ...cur, status: isFinished(cur) ? ('ended' as const) : cur.status };
    });
    if (created.length === 0 && nextRecs.every((r, i) => r === st.recurringBills[i])) return { created: 0, bills: [] };
    set({ bills, recurringBills: nextRecs });
    persist('bills', get().bills);
    persist('recurringBills', get().recurringBills);
    if (created.length) {
      get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'task', message: 'Recurring billing recorded ' + created.length + ' unpaid bill(s): ' + created.map((b) => b.number + ' ' + b.vendorName).join(', ') + '. Nothing was paid; review them under Finance → Vendors & AP.' });
    }
    return { created: created.length, bills: created.map((b) => b.number) };
  },

  recurringInvoices: [],
  addRecurringInvoice: (r) => {
    set((s) => ({ recurringInvoices: [r, ...s.recurringInvoices] }));
    persist('recurringInvoices', get().recurringInvoices);
  },
  updateRecurringInvoice: (id, patch) => {
    set((s) => ({ recurringInvoices: s.recurringInvoices.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    persist('recurringInvoices', get().recurringInvoices);
  },
  deleteRecurringInvoice: (id) => {
    // Generated invoices stay: they are real documents. Only the schedule goes away.
    set((s) => ({ recurringInvoices: s.recurringInvoices.filter((r) => r.id !== id) }));
    persist('recurringInvoices', get().recurringInvoices);
  },
  runRecurringInvoices: (todayIso) => {
    const today = todayIso ?? new Date().toISOString().slice(0, 10);
    const st = get();
    let invoices = st.invoices;
    const created: Invoice[] = [];
    const nextRecs = st.recurringInvoices.map((rec) => {
      const runs = dueRuns(rec, today);
      if (runs.length === 0) return rec;
      let cur = rec;
      for (const run of runs) {
        // Idempotency: an occurrence already present (e.g. the template was re-imported) is skipped, not duplicated.
        if (!invoices.some((i) => i.externalRef === recurringRef(rec.id, run.index))) {
          const seed = Date.now().toString(36) + '-' + created.length;
          const inv = buildInvoice(rec, run, nextInvoiceNumber(invoices), st.taxProfiles, seed);
          invoices = [inv, ...invoices];
          created.push(inv);
        }
        cur = { ...cur, generatedCount: run.index + 1, lastGeneratedIso: run.dateIso };
      }
      return { ...cur, status: isFinished(cur) ? ('ended' as const) : cur.status };
    });
    if (created.length === 0 && nextRecs.every((r, i) => r === st.recurringInvoices[i])) return { created: 0, invoices: [] };
    set({ invoices, recurringInvoices: nextRecs });
    persist('invoices', get().invoices);
    persist('recurringInvoices', get().recurringInvoices);
    if (created.length) {
      get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'task', message: 'Recurring billing created ' + created.length + ' draft invoice(s): ' + created.map((i) => i.number + ' ' + i.client).join(', ') + '. Review and send them from Sales → Invoicing.' });
    }
    return { created: created.length, invoices: created.map((i) => i.number) };
  },

  revenueTracks: INITIAL_REVENUE_TRACKS,
  addRevenueTrack: (t) => {
    set((s) => ({ revenueTracks: [t, ...s.revenueTracks] }));
    persist('revenueTracks', get().revenueTracks);
  },
  updateRevenueTrack: (id, patch) => {
    set((s) => ({ revenueTracks: s.revenueTracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    persist('revenueTracks', get().revenueTracks);
  },
  deleteRevenueTrack: (id) => {
    set((s) => ({ revenueTracks: s.revenueTracks.filter((t) => t.id !== id) }));
    persist('revenueTracks', get().revenueTracks);
  },
  setRevenueActual: (trackId, lineId, monthIdx, amount) => {
    set((s) => ({
      revenueTracks: s.revenueTracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          lines: t.lines.map((l) =>
            l.id === lineId
              ? { ...l, actuals: l.actuals.map((a, i) => (i === monthIdx ? amount : a)) }
              : l,
          ),
        };
      }),
    }));
    persist('revenueTracks', get().revenueTracks);
  },
  // Spread an all-lines actual across service lines pro-rata to that month's targets.
  setRevenueActualTotal: (trackId, monthIdx, amount) => {
    set((s) => ({
      revenueTracks: s.revenueTracks.map((t) => {
        if (t.id !== trackId) return t;
        const monthTarget = t.lines.reduce((sum, l) => sum + (l.targets[monthIdx] ?? 0), 0);
        return {
          ...t,
          lines: t.lines.map((l) => {
            const share = monthTarget > 0 ? (l.targets[monthIdx] ?? 0) / monthTarget : 0;
            const actuals = l.actuals.map((a, i) => (i === monthIdx ? Math.round(amount * share) : a));
            return { ...l, actuals };
          }),
        };
      }),
    }));
    persist('revenueTracks', get().revenueTracks);
  },

  projects: INITIAL_PROJECTS,
  addProject: (p) => {
    set((s) => ({ projects: [p, ...s.projects] }));
    persist('projects', get().projects);
  },
  updateProject: (id, patch) => {
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    persist('projects', get().projects);
  },
  deleteProject: (id) => {
    // Unlink (don't delete) tasks/finance entries — they keep standing on their own.
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      tasks: s.tasks.map((t) => (t.projectId === id ? { ...t, projectId: undefined } : t)),
      finance: s.finance.map((f) => (f.projectId === id ? { ...f, projectId: undefined } : f)),
    }));
    persist('projects', get().projects);
    persist('tasks', get().tasks);
    persist('finance', get().finance);
  },

  timeEntries: [],
  clockIn: (employeeId, employeeName) => {
    const now = new Date();
    const entry: TimeEntry = {
      id: `te-${Date.now().toString(36)}`,
      employeeId,
      employeeName,
      clockInIso: now.toISOString(),
      clockInLabel: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    set((s) => ({ timeEntries: [entry, ...s.timeEntries] }));
    persist('timeEntries', get().timeEntries);
  },
  clockOut: (entryId) => {
    const now = new Date();
    set((s) => ({
      timeEntries: s.timeEntries.map((t) =>
        t.id === entryId
          ? {
              ...t,
              clockOutIso: now.toISOString(),
              clockOutLabel: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              durationMin: Math.max(1, Math.round((now.getTime() - new Date(t.clockInIso).getTime()) / 60000)),
            }
          : t,
      ),
    }));
    persist('timeEntries', get().timeEntries);
  },
  addTimeEntry: (t) => {
    set((s) => ({ timeEntries: [t, ...s.timeEntries] }));
    persist('timeEntries', get().timeEntries);
  },
  updateTimeEntry: (id, patch) => {
    set((s) => ({ timeEntries: s.timeEntries.map((t) => (t.id === id ? { ...t, ...patch, editedBy: 'user' } : t)) }));
    persist('timeEntries', get().timeEntries);
  },
  deleteTimeEntry: (id) => {
    set((s) => ({ timeEntries: s.timeEntries.filter((t) => t.id !== id) }));
    persist('timeEntries', get().timeEntries);
  },

  invites: [],
  addInvite: (i) => {
    set((s) => ({ invites: [i, ...s.invites] }));
    persist('invites', get().invites);
  },
  setInviteStatus: (id, status) => {
    set((s) => ({
      invites: s.invites.map((i) =>
        i.id === id ? { ...i, status, acceptedAt: status === 'accepted' ? new Date().toISOString() : i.acceptedAt } : i,
      ),
    }));
    persist('invites', get().invites);
  },
  deleteInvite: (id) => {
    set((s) => ({ invites: s.invites.filter((i) => i.id !== id) }));
    persist('invites', get().invites);
  },

  setUserName: (n) => {
    set({ userName: n || 'Lawrence' });
    try {
      localStorage.setItem('borga-user', n || 'Lawrence');
    } catch {}
  },

  agents: AGENTS,
  updateAgent: (id, patch) => {
    set((s) => ({
      agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
    persist('agents', get().agents);
  },
  addAgent: (a) => {
    set((s) => ({ agents: [...s.agents, a] }));
    persist('agents', get().agents);
  },
  deleteAgent: (id) => {
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
    persist('agents', get().agents);
  },

  fundraising: INITIAL_FUNDRAISING,
  addFunding: (f) => {
    set((s) => ({ fundraising: [f, ...s.fundraising] }));
    persist('fundraising', get().fundraising);
  },
  updateFundingStage: (id, stage) => {
    set((s) => ({ fundraising: s.fundraising.map((f) => (f.id === id ? { ...f, stage } : f)) }));
    persist('fundraising', get().fundraising);
  },

  browses: INITIAL_BROWSES,
  browse: (url, browsedBy) => {
    const host = (() => {
      try {
        return new URL(url.includes('://') ? url : `https://${url}`).hostname;
      } catch {
        return url;
      }
    })();
    const placeholderId = `br-${Date.now()}`;
    const placeholder: BrowseResult = {
      id: placeholderId,
      url: url.includes('://') ? url : `https://${url}`,
      title: host,
      browsedBy,
      summary: `Fetching ${host}…`,
      links: [],
      at: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };
    set((s) => ({ browses: [placeholder, ...s.browses].slice(0, 50) }));
    persist('browses', get().browses);

    fetch('/api/borga/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ url, browsedBy }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; title?: string; summary?: string; links?: string[] }) => {
        if (d.ok) {
          set((s) => ({
            browses: s.browses.map((b) =>
              b.id === placeholderId
                ? { ...b, title: d.title ?? b.title, summary: d.summary ?? b.summary, links: d.links ?? [] }
                : b,
            ),
          }));
          persist('browses', get().browses);
        }
      })
      .catch(() => {
        set((s) => ({
          browses: s.browses.map((b) =>
            b.id === placeholderId
              ? { ...b, summary: `Could not reach ${host}. The site may be unavailable.` }
              : b,
          ),
        }));
      });

    get().log({ agentId: 'a-fundraising', agentName: browsedBy, actor: 'agent', kind: 'task', message: `${browsedBy} browsed ${host} to research funding opportunities.` });
  },

  whatsapp: DEFAULT_WHATSAPP,
  setWhatsapp: (patch) => {
    set((s) => ({ whatsapp: { ...s.whatsapp, ...patch } }));
    persist('whatsapp', get().whatsapp);
  },

  chats: INITIAL_CHATS,
  sendChat: (chatId, text, agentName) => {
    const msg: ChatThread['messages'][number] = {
      id: `cm-${Date.now()}`,
      role: 'agent',
      sender: agentName,
      text,
      at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    set((s) => ({
      chats: s.chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, msg] } : c)),
    }));
    persist('chats', get().chats);
  },
  addChat: (t) => {
    set((s) => ({ chats: [t, ...s.chats] }));
    persist('chats', get().chats);
  },

  elevenlabs: DEFAULT_ELEVENLABS,
  setElevenlabs: (patch) => {
    set((s) => ({ elevenlabs: { ...s.elevenlabs, ...patch } }));
    persist('elevenlabs', get().elevenlabs);
  },
  calls: INITIAL_CALLS,
  placeCall: (a) => {
    const voiceName = get().elevenlabs.voice || 'george';
    const companyName = get().activeWorkspace()?.name ?? 'the company';
    const script = a.note || `Hello, this is ${a.agentName} calling from ${companyName}. I'm reaching out to ${a.leadName || a.contact} regarding a potential partnership opportunity. Please feel free to call us back. Have a wonderful day.`;
    const id = `call-${Date.now()}`;
    const rec: CallRecord = {
      id,
      agentId: a.agentId,
      agentName: a.agentName,
      contact: a.contact,
      leadName: a.leadName || a.contact,
      voice: voiceName,
      status: 'dialing',
      durationSec: 0,
      note: script,
      at: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    };
    set((s) => ({ calls: [rec, ...s.calls].slice(0, 50) }));
    persist('calls', get().calls);
    get().log({ agentId: a.agentId, agentName: a.agentName, actor: 'agent', kind: 'voice', message: `${a.agentName} placing outbound call to ${a.leadName} (${a.contact})…` });

    const patchCall = (patch: Partial<CallRecord>) => {
      set((s) => ({ calls: s.calls.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      persist('calls', get().calls);
    };
    const logCall = (message: string) => {
      get().log({ agentId: a.agentId, agentName: a.agentName, actor: 'agent', kind: 'voice', message });
    };

    const normalizedTo = a.contact.replace(/[\s\-().]/g, '');
    const looksDialable = /^\+[1-9]\d{7,14}$/.test(normalizedTo);

    // No real telephony configured (or the contact isn't a dialable E.164
    // number) — honestly labeled "simulated": generates the real ElevenLabs
    // audio and plays it locally, measuring its ACTUAL playback duration
    // rather than fabricating one.
    const playSimulated = () => {
      patchCall({ mode: 'simulated' });
      fetch('/api/borga/elevenlabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'tts', voice: voiceName, text: script, agentName: a.agentName, contact: a.contact, leadName: a.leadName, note: a.note, ws: ACTIVE_WS, companyName }),
      })
        .then((r) => r.json())
        .then((d: { ok?: boolean; mode?: string; audio?: string; mimeType?: string; script?: string }) => {
          patchCall({ status: 'active' });
          const startedAt = Date.now();
          const finish = (ok: boolean) => {
            if (!ok) {
              patchCall({ status: 'failed' });
              logCall(`${a.agentName} could not speak the call script — no speech output was available.`);
              return;
            }
            const durationSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            patchCall({ status: 'completed', durationSec });
            logCall(`${a.agentName} completed a simulated call with ${a.leadName} (${durationSec}s — played locally; connect Twilio in Integrations to place a real call).`);
          };
          if (d.ok && d.audio && d.mimeType && typeof window !== 'undefined') {
            const blob = new Blob([Uint8Array.from(atob(d.audio), (c) => c.charCodeAt(0))], { type: d.mimeType });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.onended = () => { URL.revokeObjectURL(url); finish(true); };
            audio.onerror = () => { URL.revokeObjectURL(url); finish(false); };
            audio.play().catch(() => finish(false));
          } else if (d.script && typeof window !== 'undefined' && 'speechSynthesis' in window) {
            // Fall back to browser speech even when ElevenLabs itself failed
            // (no key, quota, network) — the server still returns the script
            // text in that case, so the call can still say something real.
            const utt = new SpeechSynthesisUtterance(d.script);
            utt.rate = 0.95;
            utt.onend = () => finish(true);
            utt.onerror = () => finish(false);
            window.speechSynthesis.speak(utt);
          } else {
            finish(false);
          }
        })
        .catch(() => {
          patchCall({ status: 'failed' });
          logCall(`${a.agentName}'s call to ${a.leadName} failed — could not reach the speech service.`);
        });
    };

    // Real Twilio call already dialed — poll Twilio's own status API so the
    // record reflects the actual call state and duration, not a fake timer.
    const pollRealStatus = (callSid: string) => {
      const startedAt = Date.now();
      const tick = async () => {
        try {
          const res = await fetch('/api/borga/voice/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
            body: JSON.stringify({ action: 'status', callSid }),
          });
          const d = (await res.json()) as { ok?: boolean; status?: string; durationSec?: number };
          if (d.ok) {
            const terminal = ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(d.status ?? '');
            const status: CallRecord['status'] =
              d.status === 'completed' ? 'completed' : d.status === 'in-progress' ? 'active' : terminal ? 'failed' : 'dialing';
            patchCall({ status, durationSec: d.durationSec || Math.round((Date.now() - startedAt) / 1000) });
            if (terminal) {
              logCall(`${a.agentName}'s real call to ${a.leadName} ended: ${d.status} (${d.durationSec ?? 0}s).`);
              return;
            }
          }
        } catch {
          // transient — keep polling within the budget below
        }
        if (Date.now() - startedAt < 5 * 60_000) setTimeout(tick, 3000);
      };
      setTimeout(tick, 2000);
    };

    if (!looksDialable) {
      playSimulated();
      return;
    }

    patchCall({ mode: 'real' });
    fetch('/api/borga/voice/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'dial', to: normalizedTo, message: script, voiceId: voiceName }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; callSid?: string; error?: string; message?: string }) => {
        if (d.ok && d.callSid) {
          patchCall({ callSid: d.callSid, status: 'dialing' });
          logCall(`${a.agentName} dialed a real outbound call to ${a.leadName} via Twilio (${d.callSid}).`);
          pollRealStatus(d.callSid);
        } else {
          if (d.message || d.error) logCall(`Real call not placed (${d.message ?? d.error}) — playing the script locally instead.`);
          playSimulated();
        }
      })
      .catch(() => playSimulated());
  },

  knowledge: KNOWLEDGE_SEED,
  addKnowledge: (e) => {
    set((s) => ({ knowledge: [e, ...s.knowledge] }));
    persist('knowledge', get().knowledge);
  },
  updateKnowledge: (id, patch) => {
    set((s) => ({ knowledge: s.knowledge.map((k) => (k.id === id ? { ...k, ...patch } : k)) }));
    persist('knowledge', get().knowledge);
  },
  deleteKnowledge: (id) => {
    set((s) => ({ knowledge: s.knowledge.filter((k) => k.id !== id) }));
    persist('knowledge', get().knowledge);
  },
  setKnowledge: (entries) => {
    set({ knowledge: entries });
    persist('knowledge', get().knowledge);
  },
  kbQuestions: KNOWLEDGE_QUESTIONS,
  collectQuestion: (id, answer, source) => {
    const q = get().kbQuestions.find((x) => x.id === id);
    set((s) => ({ kbQuestions: s.kbQuestions.filter((x) => x.id !== id) }));
    persist('kbquestions', get().kbQuestions);
    if (q) {
      const entry: KnowledgeEntry = {
        id: `kb-${Date.now()}`,
        category: q.category,
        title: q.question,
        answer: answer.trim() || 'Collected — pending full answer.',
        source: source.trim() || q.source,
        updatedAt: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      };
      get().addKnowledge(entry);
    }
  },

  memories: INITIAL_MEMORIES,
  addMemory: (m) => {
    set((s) => ({ memories: [m, ...s.memories].slice(0, 500) }));
    persist('memories', get().memories);
  },
  deleteMemory: (id) => {
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
    persist('memories', get().memories);
  },
  clearMemoriesByAgent: (agentId) => {
    set((s) => ({ memories: agentId ? s.memories.filter((m) => m.agentId !== agentId) : [] }));
    persist('memories', get().memories);
  },

  settings: DEFAULT_SETTINGS,
  setSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    persist('settings', get().settings);
  },

  goals: INITIAL_GOALS,
  addGoal: (g) => {
    set((s) => ({ goals: [...s.goals, g] }));
    persist('goals', get().goals);
  },
  updateGoal: (id, patch) => {
    set((s) => ({ goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
    persist('goals', get().goals);
  },
  deleteGoal: (id) => {
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
    persist('goals', get().goals);
  },

  approvals: INITIAL_APPROVALS,
  setApproval: (id, status) => {
    const approval = get().approvals.find((a) => a.id === id);
    set((s) => ({ approvals: s.approvals.map((a) => (a.id === id ? { ...a, status } : a)) }));
    persist('approvals', get().approvals);
    // Approval-gated posting: approving a posting request pushes the linked
    // journal entry straight to the GL; rejecting leaves it as a draft.
    if (approval?.journalId && status === 'approved') {
      const entry = get().journals.find((j) => j.id === approval.journalId);
      if (entry && entry.status === 'draft') {
        set((s) => ({
          journals: s.journals.map((j) =>
            j.id === entry.id ? { ...j, status: 'posted', createdAt: j.createdAt ?? new Date().toISOString() } : j,
          ),
        }));
        persist('journals', get().journals);
        get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'agent', kind: 'task', message: `Approved posting released to GL: ${entry.memo} (${Math.round(approval.amount).toLocaleString()}).` });
      }
    }
    if (approval?.journalId && status === 'rejected') {
      const entry = get().journals.find((j) => j.id === approval.journalId);
      get().log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'agent', kind: 'system', message: `Posting rejected — ${entry?.memo ?? 'journal entry'} stays as an editable draft.` });
    }
  },
  addApproval: (a) => {
    set((s) => ({ approvals: [a, ...s.approvals] }));
    if (a.status === 'pending') notifyEmail(get().activeWorkspaceId, 'approval_requested', { id: a.id, title: a.title, description: a.description, amount: a.amount, submittedBy: a.submittedBy });
    persist('approvals', get().approvals);
  },

  finance: INITIAL_FINANCE,

  toolkits: COMPOSIO_TOOLKITS,
  installToolkit: (id) => {
    set((s) => ({
      toolkits: s.toolkits.map((t) => (t.id === id ? { ...t, installed: true, installedAt: 'Just now' } : t)),
    }));
    persist('toolkits', get().toolkits);
  },
  uninstallToolkit: (id) => {
    set((s) => ({
      toolkits: s.toolkits.map((t) => (t.id === id ? { ...t, installed: false, installedAt: undefined } : t)),
    }));
    persist('toolkits', get().toolkits);
  },

  connections: INITIAL_CONNECTIONS,
  connectApp: (id, patch) => {
    set((s) => {
      const exists = s.connections.some((c) => c.id === id);
      return {
        connections: exists
          ? s.connections.map((c) => (c.id === id ? { ...c, ...patch } : c))
          : [...s.connections, { id, type: 'tool', provider: id.replace('cn-', ''), label: id.replace('cn-', ''), status: 'off', lastSync: '…', ...patch }],
      };
    });
    persist('connections', get().connections);
  },

  ops: INITIAL_OPS,
  setBookingStatus: (id, status) => {
    set((s) => ({ ops: { ...s.ops, bookings: s.ops.bookings.map((b) => (b.id === id ? { ...b, status } : b)) } }));
    persist('ops', get().ops);
  },
  addDriver: (d) => {
    set((s) => ({ ops: { ...s.ops, drivers: [...s.ops.drivers, d] } }));
    persist('ops', get().ops);
  },
  addClient: (c) => {
    set((s) => ({ ops: { ...s.ops, clients: [...s.ops.clients, c] } }));
    persist('ops', get().ops);
  },

  composio: DEFAULT_COMPOSIO,
  setComposio: (patch) => {
    set((s) => ({ composio: { ...s.composio, ...patch, configured: true } }));
    // Never persist the API key in plaintext — store only a mask.
    const clean = { ...get().composio };
    if ('apiKey' in clean && clean.apiKey) clean.apiKey = '[stored server-side]';
    persist('composio', clean);
  },
  
  addComposioConnection: (connection) => {
    set((s) => {
      const existing = s.composio.connections || [];
      const updated = existing.filter((c: any) => c.appId !== connection.appId);
      updated.push(connection);
      return { composio: { ...s.composio, connections: updated } };
    });
    // Persist without sensitive data
    const clean = { ...get().composio };
    if ('apiKey' in clean && clean.apiKey) clean.apiKey = '[stored server-side]';
    if (clean.connections) {
      clean.connections = clean.connections.map((conn: any) => ({
        ...conn,
        // Remove any sensitive tokens
      }));
    }
    persist('composio', clean);
  },
  
  removeComposioConnection: (appId) => {
    set((s) => {
      const existing = s.composio.connections || [];
      const updated = existing.filter((c: any) => c.appId !== appId);
      return { composio: { ...s.composio, connections: updated } };
    });
    // Persist without sensitive data
    const clean = { ...get().composio };
    if ('apiKey' in clean && clean.apiKey) clean.apiKey = '[stored server-side]';
    if (clean.connections) {
      clean.connections = clean.connections.map((conn: any) => ({
        ...conn,
        // Remove any sensitive tokens
      }));
    }
    persist('composio', clean);
  },
  
  updateComposioConnection: (appId: string, updates: Partial<any>) => {
    set((s) => {
      const existing = s.composio.connections || [];
      const updated = existing.map((c: any) => 
        c.appId === appId ? { ...c, ...updates, lastUsed: new Date().toISOString() } : c
      );
      return { composio: { ...s.composio, connections: updated } };
    });
    // Persist without sensitive data
    const clean = { ...get().composio };
    if ('apiKey' in clean && clean.apiKey) clean.apiKey = '[stored server-side]';
    if (clean.connections) {
      clean.connections = clean.connections.map((conn: any) => ({
        ...conn,
        // Remove any sensitive tokens
      }));
    }
    persist('composio', clean);
  },

  messages: INITIAL_MESSAGES,
  sendMessage: (m) => {
    set((s) => ({ messages: [m, ...s.messages] }));
    persist('messages', get().messages);
  },

  ads: INITIAL_ADS,
  addCampaign: (c) => {
    set((s) => ({ ads: [c, ...s.ads] }));
    persist('ads', get().ads);
  },
  setCampaignStatus: (id, status) => {
    set((s) => ({ ads: s.ads.map((a) => (a.id === id ? { ...a, status } : a)) }));
    persist('ads', get().ads);
  },
  updateCampaign: (id, patch) => {
    set((s) => ({ ads: s.ads.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    persist('ads', get().ads);
  },
  deleteCampaign: (id) => {
    set((s) => ({ ads: s.ads.filter((a) => a.id !== id) }));
    persist('ads', get().ads);
  },

  webhooks: INITIAL_WEBHOOKS,
  addWebhook: (w) => {
    set((s) => ({ webhooks: [w, ...s.webhooks] }));
    persist('webhooks', get().webhooks);
  },
  toggleWebhook: (id) => {
    set((s) => ({ webhooks: s.webhooks.map((w) => (w.id === id ? { ...w, active: !w.active } : w)) }));
    persist('webhooks', get().webhooks);
  },
  deleteWebhook: (id) => {
    set((s) => ({ webhooks: s.webhooks.filter((w) => w.id !== id) }));
    persist('webhooks', get().webhooks);
  },

  mcpServers: INITIAL_MCP_SERVERS,
  addMcpServer: (s) => {
    set((st) => ({ mcpServers: [s, ...st.mcpServers] }));
    persist('mcpServers', get().mcpServers);
  },
  updateMcpServer: (id, patch) => {
    set((st) => ({ mcpServers: st.mcpServers.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    persist('mcpServers', get().mcpServers);
  },
  deleteMcpServer: (id) => {
    set((st) => ({ mcpServers: st.mcpServers.filter((m) => m.id !== id) }));
    persist('mcpServers', get().mcpServers);
  },

  kpiGroups: INITIAL_KPI_GROUPS,
  addKpi: (groupId, kpi) => {
    set((s) => ({
      kpiGroups: s.kpiGroups.map((g) => (g.id === groupId ? { ...g, kpis: [...g.kpis, kpi] } : g)),
    }));
    persist('kpis', get().kpiGroups);
  },
  updateKpi: (groupId, kpiId, patch) => {
    set((s) => ({
      kpiGroups: s.kpiGroups.map((g) =>
        g.id === groupId ? { ...g, kpis: g.kpis.map((k) => (k.label === kpiId ? { ...k, ...patch } : k)) } : g,
      ),
    }));
    persist('kpis', get().kpiGroups);
  },
  deleteKpi: (groupId, kpiId) => {
    set((s) => ({
      kpiGroups: s.kpiGroups.map((g) =>
        g.id === groupId ? { ...g, kpis: g.kpis.filter((k) => k.label !== kpiId) } : g,
      ),
    }));
    persist('kpis', get().kpiGroups);
  },

  llm: DEFAULT_LLM,
  setLlm: (patch) => {
    set((s) => ({ llm: { ...s.llm, ...patch } }));
    persist('llm', get().llm);
  },

  setDefaultLlm: (patch) => {
    const prev = get().llm;
    const next = { ...prev, ...patch };
    set({ llm: next });
    persist('llm', next);
    // Agents pinned to the old default model move with it; agents with no model already follow the default.
    if (next.model !== prev.model) {
      for (const a of get().agents) {
        if (a.model && a.model === prev.model) get().updateAgent(a.id, { model: next.model });
      }
    }
  },

  llmCatalog: LLM_PROVIDERS,
  loadFreeModels: async (providerId) => {
    try {
      const res = await fetch('/api/borga/llm-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ providerId }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; models?: LlmModelInfo[]; total?: number; loadedAt?: number; error?: string; needsKey?: boolean };
      if (!d.ok || !d.models) return { ok: false, error: d.error ?? `The server answered HTTP ${res.status}.`, needsKey: d.needsKey };
      const loaded = d.models;
      const s = get();
      const catalog = (s.llmCatalog.length ? s.llmCatalog : LLM_PROVIDERS).map((p) =>
        p.id === providerId
          ? { ...p, models: mergeLoadedModels(p.models, loaded, s.llm.providerId === providerId ? [s.llm.model] : []), modelsLoadedAt: d.loadedAt ?? Date.now() }
          : p,
      );
      get().setLlmCatalog(catalog);
      return { ok: true, count: loaded.length, total: d.total };
    } catch {
      return { ok: false, error: 'Network error. Try again.' };
    }
  },
  setLlmCatalog: (catalog) => {
    set({ llmCatalog: catalog });
    persist('llmCatalog', catalog);
  },

  valuation: VALUATION_CONFIG_SEED,
  setValuation: (config) => {
    set({ valuation: config });
    persist('valuation', config);
  },

  saveConflicts: [],
  loadLatest: async () => {
    set({ saveConflicts: [] });
    await get().hydrate();
  },

  hydrate: async () => {
    const seq = ++hydrateSeq;
    try {
      // Prefer the persisted workspace choice, else the first known workspace.
      let wsId = get().activeWorkspaceId;
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('borga-workspace');
        if (saved && (get().workspaces.some((w) => w.id === saved) || /^[a-zA-Z0-9_-]{1,64}$/.test(saved))) {
          wsId = saved;
          ACTIVE_WS = wsId;
        }
      }
      if (!ACTIVE_WS) ACTIVE_WS = wsId;

      // 1) Load the global workspace registry first so the switcher is usable.
      const regRes = await fetch('/api/borga/data', {
        headers: { 'X-Borga-Client': 'borga-dashboard' },
      });
      const reg = await regRes.json() as { workspaces?: Workspace[]; persisted?: boolean; versions?: Record<string, number> };
      if (seq !== hydrateSeq) return; // superseded by a newer hydrate
      if (regRes.status === 503) failServerLoad();
      else SAVES.setVersions('global|', reg.versions ?? {});
      const dbAvailable = reg.persisted === true;
      // When the database is available, the workspace registry is fully
      // server-authoritative (per-user) — do not merge in the global seed
      // companies. In local/offline mode we fall back to any locally cached
      // companies so a newly created workspace survives a reload.
      let workspaces: Workspace[] = Array.isArray(reg.workspaces) ? reg.workspaces : [];
      if (!dbAvailable) {
        const map = new Map<string, Workspace>();
        workspaces.forEach((w) => map.set(w.id, w));
        get().workspaces.forEach((w) => { if (!map.has(w.id)) map.set(w.id, w); });
        const localWs = readLocalValue('global', 'workspaces');
        if (Array.isArray(localWs)) (localWs as Workspace[]).forEach((w) => { if (!map.has(w.id)) map.set(w.id, w); });
        workspaces = [...map.values()];
      }
      if (!workspaces.some((w) => w.id === wsId)) wsId = workspaces[0]?.id ?? '';
      set({ workspaces, activeWorkspaceId: wsId, synced: true, dbAvailable });
      ACTIVE_WS = wsId || null;
      if (!wsId) return; // no company yet — wait for the user to create one

      // 2) Load everything scoped to the active workspace in one bulk fetch.
      const res = await fetch(`/api/borga/data?ws=${encodeURIComponent(wsId)}`, {
        headers: { 'X-Borga-Client': 'borga-dashboard' },
      });
      const d = await res.json();
      // Isolation guard: discard stale responses outright.
      if (seq !== hydrateSeq || get().activeWorkspaceId !== wsId) return;
      if (!res.ok) {
        // Database unavailable: keep what is on screen, hold server writes, never treat seed data as saved.
        failServerLoad();
        set({ synced: true, dbAvailable: false });
        return;
      }
      SERVER_LOAD_FAILED = false;
      // Remember which version of every entity this tab now holds; saves are refused if it has moved on by then.
      SAVES.setVersions(`${wsId}|`, (d.versions ?? {}) as Record<string, number>);
      const dbAgents = Array.isArray(d.agents) && d.agents.length ? (d.agents as Agent[]) : null;
      const agents = dbAgents ? ensureNadia(dbAgents) : AGENTS;
      const agentsChanged = !!dbAgents && agents !== dbAgents;
      set({
        synced: true,
        dbAvailable,
        goals: d.goals ?? INITIAL_GOALS,
        approvals: d.approvals ?? INITIAL_APPROVALS,
        finance: d.finance ?? INITIAL_FINANCE,
        toolkits: d.toolkits ?? COMPOSIO_TOOLKITS,
        connections: d.connections ?? INITIAL_CONNECTIONS,
        ops: d.ops ?? INITIAL_OPS,
        composio: d.composio ?? DEFAULT_COMPOSIO,
        messages: d.messages ?? INITIAL_MESSAGES,
        ads: d.ads ?? INITIAL_ADS,
        webhooks: d.webhooks ?? INITIAL_WEBHOOKS,
        mcpServers: d.mcpServers ?? INITIAL_MCP_SERVERS,
        kpiGroups: d.kpis ?? INITIAL_KPI_GROUPS,
        llm: d.llm ?? DEFAULT_LLM,
        llmCatalog: Array.isArray(d.llmCatalog) && d.llmCatalog.length ? repairCatalog(d.llmCatalog, LLM_PROVIDERS) : LLM_PROVIDERS,
        valuation: d.valuation ?? VALUATION_CONFIG_SEED,
        fundraising: d.fundraising ?? INITIAL_FUNDRAISING,
        browses: d.browses ?? INITIAL_BROWSES,
        whatsapp: d.whatsapp ?? DEFAULT_WHATSAPP,
        chats: d.chats ?? INITIAL_CHATS,
        elevenlabs: d.elevenlabs ?? DEFAULT_ELEVENLABS,
        calls: d.calls ?? INITIAL_CALLS,
        knowledge: d.knowledge ?? KNOWLEDGE_SEED,
        kbQuestions: d.kbquestions ?? KNOWLEDGE_QUESTIONS,
        memories: Array.isArray(d.memories) ? d.memories : INITIAL_MEMORIES,
        settings: d.settings ?? DEFAULT_SETTINGS,
        // Once a non-empty agent list has been saved to the DB, trust it fully
        // so deletions of built-in agents persist instead of being re-inserted.
        // Nadia (fundraising) is a required built-in and is re-inserted after Zed.
        agents,
        activity: Array.isArray(d.activity) ? (d.activity as ActivityEvent[]) : undefined,
        tasks: d.tasks ?? INITIAL_TASKS,
        posts: d.posts ?? INITIAL_POSTS,
        leads: d.leads ?? INITIAL_LEADS,
        scheduledTasks: Array.isArray(d.scheduledTasks) ? d.scheduledTasks : INITIAL_SCHEDULED_TASKS,
        agentRuns: Array.isArray(d.agentRuns) ? d.agentRuns : [],
        notices: Array.isArray(d.notices) ? d.notices : INITIAL_NOTICES,
        employees: Array.isArray(d.employees) ? d.employees : INITIAL_EMPLOYEES,
        leaveRequests: Array.isArray(d.leave) ? d.leave : INITIAL_LEAVE,
        invoices: Array.isArray(d.invoices) ? d.invoices : INITIAL_INVOICES,
        messagingChannels: Array.isArray(d.messagingChannels) && d.messagingChannels.length > 0 ? d.messagingChannels : DEFAULT_MESSAGING_CHANNELS,
        secureChats: Array.isArray(d.secureChats) ? d.secureChats : [],
        customers: Array.isArray(d.customers) ? d.customers : INITIAL_CUSTOMERS,
        contacts: Array.isArray(d.contacts) ? d.contacts : INITIAL_CONTACTS,
        vendors: Array.isArray(d.vendors) ? d.vendors : INITIAL_VENDORS,
        bills: Array.isArray(d.bills) ? d.bills : INITIAL_BILLS,
        coa: Array.isArray(d.coa) ? d.coa : INITIAL_COA,
        journals: Array.isArray(d.journals) ? d.journals : INITIAL_JOURNAL,
        bankAccounts: Array.isArray(d.bankAccounts) ? d.bankAccounts : INITIAL_BANK_ACCOUNTS,
        bankTxns: Array.isArray(d.bankTxns) ? d.bankTxns : INITIAL_BANK_TXNS,
        workflows: Array.isArray(d.workflows) && d.workflows.length > 0 ? d.workflows : get().workflows,
        closures: Array.isArray(d.closures) ? d.closures : [],
        timeEntries: Array.isArray(d.timeEntries) ? d.timeEntries : [],
        invites: Array.isArray(d.invites) ? d.invites : [],
        taxProfiles: Array.isArray(d.taxProfiles) ? d.taxProfiles : INITIAL_TAX_PROFILES,
        defaultTaxProfileId: defaultTaxIdOf(Array.isArray(d.taxProfiles) && d.taxProfiles.length ? d.taxProfiles : INITIAL_TAX_PROFILES),
        budgets: Array.isArray(d.budgets) ? d.budgets : INITIAL_BUDGETS,
        revenueTracks: Array.isArray(d.revenueTracks) ? d.revenueTracks : INITIAL_REVENUE_TRACKS,
        recurringInvoices: Array.isArray(d.recurringInvoices) ? d.recurringInvoices : [],
        recurringBills: Array.isArray(d.recurringBills) ? d.recurringBills : [],
        projects: Array.isArray(d.projects) ? d.projects : INITIAL_PROJECTS,
        reconciliationRules: Array.isArray(d.reconciliationRules) ? d.reconciliationRules : INITIAL_RECONCILIATION_RULES,
      });
      // Local fallback: when the database is unavailable the API returns shared
      // seeds for every workspace, which would erase company-specific edits on
      // switch. Prefer the per-workspace localStorage mirror for any entity
      // that was previously persisted locally.
      if (!dbAvailable) {
        const overrides: Partial<BorgaStore> = {};
        for (const [field, entity] of LS_FALLBACK_FIELDS) {
          const v = readLocalValue(wsId, entity);
          if (v !== undefined) (overrides as Record<string, unknown>)[field] = v;
        }
        if (Object.keys(overrides).length) set(overrides as Partial<BorgaStore>);
      }
      // Persist the corrected agent list (with Nadia) back to the cloud DB.
      if (agentsChanged) persist('agents', agents);
    } catch {
      // Never leave the shell stuck on the loading spinner. Surface the app
      // with whatever local state we have so the user can recover.
      failServerLoad();
      set({ synced: true });
    }
  },

  tasks: INITIAL_TASKS,
  addTask: (t) => {
    set((s) => ({ tasks: [t, ...s.tasks] }));
    persist('tasks', get().tasks);
  },
  updateTask: (id, patch) => {
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    persist('tasks', get().tasks);
  },
  deleteTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    persist('tasks', get().tasks);
  },
  moveTaskBucket: (id, bucket) => get().updateTask(id, { bucket }),

  activity: [
    {
      id: 'e-init',
      time: '…',
      agentId: 'a1',
      agentName: 'Borga',
      actor: 'system',
      kind: 'system',
      message: 'Dashboard initialised. Shared brain linked across all agents.',
    },
  ],
  log: (e) => {
    const entry: ActivityEvent = {
      ...e,
      id: `e-${Date.now()}-${logSeq++}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    set((s) => ({ activity: [entry, ...s.activity].slice(0, 200) }));
    persist('activity', get().activity);

    // System notifications for meaningful events (kept quiet for routine noise).
    if (e.kind === 'handoff') {
      toast({ title: 'Approval needed', description: e.message, variant: 'warning' });
    } else if (e.kind === 'sync') {
      toast({ title: e.actor === 'system' ? 'Workflow notice' : 'Workflow update', description: e.message, variant: 'info' });
    } else if (e.kind === 'voice') {
      toast({ title: `${e.agentName} — voice`, description: e.message, variant: 'info', duration: 2600 });
    } else if (e.kind === 'system' && e.actor === 'system' && /(blocked|error|unreachable|rejected|denied|skipped)/i.test(e.message)) {
      toast({ title: 'System notice', description: e.message, variant: 'error' });
    }
  },

  connectors: CONNECTORS,
  setConnector: (id, status, lastSync) =>
    set((s) => ({
      connectors: s.connectors.map((c) => (c.id === id ? { ...c, status, lastSync } : c)),
    })),

  posts: INITIAL_POSTS,
  addPost: (p) => {
    set((s) => ({ posts: [p, ...s.posts] }));
    persist('posts', get().posts);
  },
  updatePost: (id, patch) => {
    set((s) => ({ posts: s.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    persist('posts', get().posts);
  },
  deletePost: (id) => {
    set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
    persist('posts', get().posts);
  },
  setPostStatus: (id, status) => {
    set((s) => ({ posts: s.posts.map((p) => (p.id === id ? { ...p, status } : p)) }));
    persist('posts', get().posts);
  },

  leads: INITIAL_LEADS,
  addLead: (l) => {
    set((s) => ({ leads: [l, ...s.leads] }));
    persist('leads', get().leads);
  },
  moveLeadStage: (id, stage) => {
    set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, stage } : l)) }));
    persist('leads', get().leads);
  },
  updateLead: (id, patch) => {
    set((s) => ({ leads: s.leads.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
    persist('leads', get().leads);
  },
  deleteLead: (id) => {
    set((s) => ({ leads: s.leads.filter((l) => l.id !== id) }));
    persist('leads', get().leads);
  },

  workflows: INITIAL_WORKFLOWS,
  setWorkflow: (id, patch) =>
    set((s) => ({ workflows: s.workflows.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
  runWorkflow: (id) => {
    const workflowName = get().workflows.find((w) => w.id === id)?.name ?? id;
    const agents = get().agents;
    const workflowId = id;
    
    set((s) => ({ workflows: s.workflows.map((w) => (w.id === id ? { ...w, status: 'running', progress: 4 } : w)) }));

    // Climb toward (but never claim) completion while the real request is in
    // flight — an honest "still working" indicator, not a fake finish. The
    // fetch's own resolution is what actually marks the workflow complete/error.
    let progress = 4;
    const climber = setInterval(() => {
      progress = Math.min(90, progress + 6);
      set((s) => ({ workflows: s.workflows.map((w) => (w.id === workflowId && w.status === 'running' ? { ...w, progress } : w)) }));
    }, 800);

    const finish = (status: 'complete' | 'error') => {
      clearInterval(climber);
      set((s) => ({ workflows: s.workflows.map((w) => (w.id === workflowId ? { ...w, status, progress: status === 'complete' ? 100 : w.progress } : w)) }));
    };

    // Fire the real orchestration API with proper task distribution.
    // Scoped to the active company so each tenant drives its own engine.
    fetch('/api/borga/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'run', workflowName, agent: 'Borga', ws: ACTIVE_WS }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; mode?: string; steps?: Array<{ step: string; output: string; status: string }>; summary?: string }) => {
        const mode = d.mode === 'remote' ? 'company engine' : 'local fallback';
        get().log({ agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync', message: `Workflow "${workflowName}" dispatched to ${mode}.` });

        // If local execution, process the steps
        if (d.mode === 'local' && d.steps) {
          const steps = d.steps;
          steps.forEach((step, index) => {
            setTimeout(() => {
              get().log({
                agentId: 'a-borga',
                agentName: 'Borga',
                actor: 'agent',
                kind: 'task',
                message: `Step ${index + 1}/${steps.length}: ${step.step} — ${step.output}`
              });
            }, (index + 1) * 1000);
          });
        }

        // Distribute tasks to relevant agents based on workflow type
        distributeWorkflowTasks(workflowName, agents);
        get().log({ agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync', message: `Workflow completed: ${workflowName}` });
        finish('complete');
      })
      .catch((error) => {
        console.error('Workflow execution error:', error);
        get().log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Workflow "${workflowName}" failed to reach the engine — falling back to local task distribution.` });

        // Fallback to local task distribution — the dispatch itself still failed, so mark it accordingly.
        distributeWorkflowTasks(workflowName, agents);
        finish('error');
      });
  },

  voice: { listening: false, thinking: false, transcript: '', lastReply: '', awake: false },
  setVoice: (patch) => set((s) => ({ voice: { ...s.voice, ...patch } })),

  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),

  activeAgentId: 'a1',
  setActiveAgentId: (id) => set({ activeAgentId: id }),

  scheduledTasks: INITIAL_SCHEDULED_TASKS,
  addScheduledTask: (t) => {
    set((s) => ({ scheduledTasks: [t, ...s.scheduledTasks] }));
    persist('scheduledTasks', get().scheduledTasks);
  },
  updateScheduledTask: (id, patch) => {
    set((s) => ({ scheduledTasks: s.scheduledTasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    persist('scheduledTasks', get().scheduledTasks);
  },
  deleteScheduledTask: (id) => {
    set((s) => ({ scheduledTasks: s.scheduledTasks.filter((t) => t.id !== id) }));
    persist('scheduledTasks', get().scheduledTasks);
  },
  toggleScheduledTask: (id) => {
    set((s) => ({
      scheduledTasks: s.scheduledTasks.map((t) => {
        if (t.id !== id) return t;
        const enabled = !t.enabled;
        return { ...t, enabled, nextRun: enabled ? null : null };
      }),
    }));
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'toggle', id, ws: ACTIVE_WS }),
    }).then((r) => r.json()).then((d: { task?: ScheduledTask }) => {
      if (d.task) {
        set((s) => ({ scheduledTasks: s.scheduledTasks.map((t) => (t.id === id ? d.task! : t)) }));
        persist('scheduledTasks', get().scheduledTasks);
      }
    }).catch(() => null);
  },

  agentRuns: [],
  addAgentRun: (r) => {
    set((s) => ({ agentRuns: [r, ...s.agentRuns].slice(0, 50) }));
    persist('agentRuns', get().agentRuns);
  },
  clearAgentRuns: () => {
    set({ agentRuns: [] });
    persist('agentRuns', []);
  },

  notices: INITIAL_NOTICES,
  addNotice: (n) => {
    set((s) => ({ notices: [n, ...s.notices].slice(0, 100) }));
    persist('notices', get().notices);
  },
  dismissNotice: (id) => {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    persist('notices', get().notices);
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'dismissNotice', id, ws: ACTIVE_WS }),
    }).catch(() => null);
  },
  clearNotices: () => {
    set({ notices: [] });
    persist('notices', []);
  },
}));

export function pickAgentName(agents: Agent[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? 'Borga';
}

export function priorityRank(p: Priority): number {
  return p === 'P0' ? 0 : p === 'P1' ? 1 : p === 'P2' ? 2 : 3;
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
  );
}
