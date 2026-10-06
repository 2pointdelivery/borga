/**
 * Feature registry. Shared by client and server (no server-only imports).
 *
 * A feature that misbehaves can be switched off per workspace from
 * Settings → Features, or for the whole deployment with the env var
 * BORGA_FEATURES_OFF="voice,calls" (env always wins and cannot be toggled on
 * from the UI). Disabled features disappear from navigation and their API
 * routes answer 404 — server enforcement, not just hidden buttons.
 */

export type FeatureStatus = 'stable' | 'beta' | 'experimental' | 'simulated';

/** How features are grouped on the Settings screen. */
export type FeatureGroup = 'Finance' | 'Company' | 'Operations' | 'Support' | 'Communications' | 'Marketing' | 'AI & automation' | 'Platform';

export const FEATURE_GROUPS: readonly FeatureGroup[] = ['Finance', 'Company', 'Operations', 'Support', 'Communications', 'Marketing', 'AI & automation', 'Platform'];

export interface FeatureDef {
  id: string;
  label: string;
  description: string;
  status: FeatureStatus;
  defaultOn: boolean;
  /** Nav placement used to hide the feature's page/tab when it is off. */
  page?: string;
  tab?: string;
  group: FeatureGroup;
}

export const FEATURES = [
  { id: 'tickets', label: 'Support Desk (tickets, SLA, mailbox)', description: 'Jira-style tickets with SLA timers and an email-linked mailbox.', status: 'beta', defaultOn: true, page: 'support', group: 'Support' },
  { id: 'supermemory', label: 'Supermemory (long-term AI memory)', description: 'Semantic recall for agents, knowledge-base search and similar-ticket lookup via Supermemory. Sends data to a third party; off by default.', status: 'beta', defaultOn: false, group: 'AI & automation' },
  { id: 'emailUpdates', label: 'Email updates', description: 'Per-company transactional emails (approvals, SLA alerts, recurring billing) and a daily/weekly digest.', status: 'beta', defaultOn: true, group: 'Platform' },
  { id: 'projects', label: 'Projects', description: 'Projects, milestones and project task boards.', status: 'stable', defaultOn: true, page: 'projects', group: 'Operations' },
  { id: 'inventory', label: 'Inventory', description: 'Products and services catalog with auto-assigned EAN-13 barcodes, AI descriptions, weighted-average stock costing and warehouse or store locations.', status: 'beta', defaultOn: true, page: 'inventory', group: 'Operations' },
  { id: 'pos', label: 'Point of sale', description: 'POS register: barcode-ready item grid, cart with discounts and tax, cash/card/mobile payments, receipts and refunds. Sales move stock and record COGS.', status: 'beta', defaultOn: true, page: 'inventory', tab: 'pos', group: 'Operations' },
  { id: 'voice', label: 'Voice assistant', description: 'Wake-word / push-to-talk assistant, ElevenLabs and Deepgram.', status: 'beta', defaultOn: true, group: 'AI & automation' },
  { id: 'calls', label: 'Calls', description: 'Outbound calls. Real only with Twilio configured, otherwise simulated.', status: 'simulated', defaultOn: false, page: 'communications', tab: 'calls', group: 'Communications' },
  { id: 'secureChat', label: 'Encrypted chat', description: 'Encrypted internal threads.', status: 'beta', defaultOn: true, page: 'communications', tab: 'securechat', group: 'Communications' },
  { id: 'social', label: 'Social media', description: 'Post planner. Publishes live to linked accounts via Composio; anything unlinked stays queued.', status: 'beta', defaultOn: true, page: 'marketing', tab: 'social', group: 'Marketing' },
  { id: 'advertising', label: 'Advertising', description: 'Ad campaign tracker.', status: 'experimental', defaultOn: false, page: 'marketing', tab: 'advertising', group: 'Marketing' },
  { id: 'banking', label: 'Banking', description: 'Bank accounts, transactions and reconciliation rules.', status: 'beta', defaultOn: true, page: 'finance', tab: 'banking', group: 'Finance' },
  { id: 'fixedAssets', label: 'Fixed assets', description: 'Asset register with automatic depreciation, revaluation and impairment under IFRS, US GAAP or ASPE.', status: 'beta', defaultOn: true, page: 'finance', tab: 'assets', group: 'Finance' },
  { id: 'filings', label: 'Tax filings', description: 'Federal and provincial or state returns by country, due dates, worksheets, reminders and Excel/CSV exports.', status: 'beta', defaultOn: true, page: 'finance', tab: 'filing', group: 'Finance' },
  { id: 'bankFeeds', label: 'Bank feeds (Salt Edge)', description: 'Connect a bank and import its transactions for reconciliation. PDF and CSV import stay available.', status: 'beta', defaultOn: true, group: 'Finance' },
  { id: 'bookClosure', label: 'Book closure', description: 'Period close and journal locking.', status: 'beta', defaultOn: true, page: 'finance', tab: 'closures', group: 'Finance' },
  { id: 'revenueTracker', label: 'Revenue tracker', description: 'Recognised revenue schedules.', status: 'experimental', defaultOn: true, page: 'finance', tab: 'revenue', group: 'Finance' },
  { id: 'valuation', label: 'Valuation', description: 'Comparable-multiple valuation model. Price history chart is illustrative.', status: 'experimental', defaultOn: false, page: 'company', tab: 'valuation', group: 'Company' },
  { id: 'fundraising', label: 'Fundraising', description: 'Funding opportunity tracker.', status: 'experimental', defaultOn: false, page: 'company', tab: 'fundraising', group: 'Company' },
  { id: 'companyEngine', label: 'Company Engine', description: 'Your own CRM or company API: pull customers and deals, run workflows and webhooks.', status: 'beta', defaultOn: true, page: 'company', tab: 'engine', group: 'Company' },
  { id: 'agents', label: 'AI agents & runner', description: 'Agent fleet, runner and planner.', status: 'beta', defaultOn: true, page: 'ai', group: 'AI & automation' },
  { id: 'heartbeat', label: 'Always-on heartbeat', description: 'Scheduled agent checks and the /api/borga/cron endpoint.', status: 'beta', defaultOn: true, group: 'AI & automation' },
  { id: 'mcp', label: 'MCP servers', description: 'Generic MCP server connections with OAuth.', status: 'beta', defaultOn: true, group: 'Platform' },
  { id: 'composio', label: 'Composio toolkits', description: 'Third-party app toolkits via Composio.', status: 'beta', defaultOn: true, page: 'integrations', tab: 'toolkits', group: 'Platform' },
  { id: 'inbox', label: 'Unified inbox', description: 'One inbox for email, WhatsApp and other channels, with AI-drafted replies.', status: 'beta', defaultOn: true, page: 'communications', tab: 'inbox', group: 'Communications' },
  { id: 'budgeting', label: 'Budgeting', description: 'Budgets by account and period, tracked against actuals.', status: 'beta', defaultOn: true, page: 'finance', tab: 'budgeting', group: 'Finance' },
  { id: 'hr', label: 'HR (directory, time off, teams)', description: 'Employee directory, leave requests, team invites, teams and the organogram.', status: 'beta', defaultOn: true, page: 'hr', group: 'Company' },
  { id: 'kpis', label: 'KPI scorecard', description: 'Best-practice KPIs by department, scored against targets, with values filled from your own data.', status: 'beta', defaultOn: true, page: 'overview', tab: 'kpis', group: 'Company' },
  { id: 'analytics', label: 'Analytics', description: 'Charts and trends across sales, finance and operations.', status: 'beta', defaultOn: true, page: 'overview', tab: 'analytics', group: 'Company' },
  { id: 'developers', label: 'Developer tools (API keys, webhooks)', description: 'Public API keys, outgoing webhooks and the feature-request board.', status: 'beta', defaultOn: true, page: 'developers', group: 'Platform' },
  { id: 'automations', label: 'Automatic delegation', description: 'New tickets, stale leads, overdue invoices and agent-assigned tasks are handed to the agent that owns them. Each can also be switched under AI Platform.', status: 'beta', defaultOn: true, group: 'AI & automation' },
  { id: 'advisor', label: 'Advisor bubble', description: 'The floating assistant that suggests what to look at on each page.', status: 'beta', defaultOn: true, group: 'AI & automation' },
  { id: 'widgets', label: 'Dashboard widgets', description: 'The side column with project progress, support tickets, calendar, AI assistant and plan.', status: 'stable', defaultOn: true, group: 'Platform' },
  { id: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp Business messaging.', status: 'experimental', defaultOn: false, group: 'Communications' },
] as const satisfies readonly FeatureDef[];

export type FeatureId = (typeof FEATURES)[number]['id'];

export const FEATURE_IDS: ReadonlySet<string> = new Set(FEATURES.map((f) => f.id));

export function isFeatureId(id: unknown): id is FeatureId {
  return typeof id === 'string' && FEATURE_IDS.has(id);
}

/**
 * Policy: a feature that is simulated, or experimental and not yet backed by real data, ships OFF. A company turns it on
 * under Settings, Features, knowing its status. lib/features.test.ts enforces this, so a new experimental feature cannot
 * be added switched on by accident. (Revenue tracker is the one experimental feature that is on: it records real,
 * user-entered revenue; only its ledger-based actuals are still to come.)
 */
export const EXPERIMENTAL_ON_BY_DEFAULT: readonly string[] = ['revenueTracker'];

/** Stored overrides: only explicit choices are persisted; absent = feature default. */
export type FeatureOverrides = Partial<Record<FeatureId, boolean>>;

export interface ResolvedFeatures {
  flags: Record<FeatureId, boolean>;
  /** Features forced off by the deployment (BORGA_FEATURES_OFF) — not toggleable. */
  locked: FeatureId[];
}

export function parseEnvOff(raw: string | undefined): FeatureId[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(isFeatureId);
}

export function resolveFeatures(overrides: FeatureOverrides | null | undefined, envOff: FeatureId[] = []): ResolvedFeatures {
  const locked = new Set<FeatureId>(envOff);
  const flags = {} as Record<FeatureId, boolean>;
  for (const f of FEATURES) {
    flags[f.id] = locked.has(f.id) ? false : (overrides?.[f.id] ?? f.defaultOn);
  }
  return { flags, locked: [...locked] };
}

/** Features whose page/tab is currently hidden (used by navigation). */
export function featureForTab(page: string, tab?: string): FeatureId | null {
  const exact = FEATURES.find((f) => 'page' in f && f.page === page && 'tab' in f && f.tab === tab);
  if (exact) return exact.id;
  if (tab === undefined) {
    const pageWide = FEATURES.find((f) => 'page' in f && f.page === page && !('tab' in f));
    return pageWide ? pageWide.id : null;
  }
  return null;
}
