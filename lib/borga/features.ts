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

export interface FeatureDef {
  id: string;
  label: string;
  description: string;
  status: FeatureStatus;
  defaultOn: boolean;
  /** Nav placement used to hide the feature's page/tab when it is off. */
  page?: string;
  tab?: string;
}

export const FEATURES = [
  { id: 'tickets', label: 'Support Desk (tickets, SLA, mailbox)', description: 'Jira-style tickets with SLA timers and an email-linked mailbox.', status: 'beta', defaultOn: true, page: 'support' },
  { id: 'supermemory', label: 'Supermemory (long-term AI memory)', description: 'Semantic recall for agents, knowledge-base search and similar-ticket lookup via Supermemory. Sends data to a third party; off by default.', status: 'beta', defaultOn: false },
  { id: 'emailUpdates', label: 'Email updates', description: 'Per-company transactional emails (approvals, SLA alerts, recurring billing) and a daily/weekly digest.', status: 'beta', defaultOn: true },
  { id: 'projects', label: 'Projects', description: 'Projects, milestones and project task boards.', status: 'stable', defaultOn: true, page: 'projects' },
  { id: 'voice', label: 'Voice assistant', description: 'Wake-word / push-to-talk assistant, ElevenLabs and Deepgram.', status: 'beta', defaultOn: true },
  { id: 'calls', label: 'Calls', description: 'Outbound calls. Real only with Twilio configured, otherwise simulated.', status: 'simulated', defaultOn: false, page: 'communications', tab: 'calls' },
  { id: 'secureChat', label: 'Encrypted chat', description: 'Encrypted internal threads.', status: 'beta', defaultOn: true, page: 'communications', tab: 'securechat' },
  { id: 'social', label: 'Social media', description: 'Post planner. Publishing does not reach external platforms yet.', status: 'simulated', defaultOn: false, page: 'marketing', tab: 'social' },
  { id: 'advertising', label: 'Advertising', description: 'Ad campaign tracker.', status: 'experimental', defaultOn: false, page: 'marketing', tab: 'advertising' },
  { id: 'banking', label: 'Banking', description: 'Bank accounts, transactions and reconciliation rules.', status: 'beta', defaultOn: true, page: 'finance', tab: 'banking' },
  { id: 'bookClosure', label: 'Book closure', description: 'Period close and journal locking.', status: 'beta', defaultOn: true, page: 'finance', tab: 'closures' },
  { id: 'revenueTracker', label: 'Revenue tracker', description: 'Recognised revenue schedules.', status: 'experimental', defaultOn: true, page: 'finance', tab: 'revenue' },
  { id: 'valuation', label: 'Valuation', description: 'Comparable-multiple valuation model. Price history chart is illustrative.', status: 'experimental', defaultOn: false, page: 'company', tab: 'valuation' },
  { id: 'fundraising', label: 'Fundraising', description: 'Funding opportunity tracker.', status: 'experimental', defaultOn: false, page: 'company', tab: 'fundraising' },
  { id: 'agents', label: 'AI agents & runner', description: 'Agent fleet, runner, planner and orchestration.', status: 'beta', defaultOn: true, page: 'ai' },
  { id: 'heartbeat', label: 'Always-on heartbeat', description: 'Scheduled agent checks and the /api/borga/cron endpoint.', status: 'beta', defaultOn: true },
  { id: 'mcp', label: 'MCP servers', description: 'Generic MCP server connections with OAuth.', status: 'beta', defaultOn: true },
  { id: 'composio', label: 'Composio toolkits', description: 'Third-party app toolkits via Composio.', status: 'beta', defaultOn: true },
  { id: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp Business messaging.', status: 'experimental', defaultOn: false },
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
