/**
 * Single source of truth for "which Composio toolkit is connected". Composio's
 * connected_accounts is the authority; the dashboard mirrors it into three
 * local slices (connections cards, composio.connections, messaging channels)
 * through ONE store action, so connecting Gmail (or LinkedIn, …) once lights
 * it up everywhere instead of each tab keeping its own copy.
 *
 * Pure helpers live here for unit tests; the mirror write itself is a store
 * action (lib/borga/store.ts `syncToolkitConnection`).
 */

export interface ComposioAccountRef {
  id?: string;
  /** Toolkit slug, e.g. 'gmail', 'linkedin'. */
  appName: string;
  status: string;
  entityId?: string;
}

export interface ToolkitConnState {
  connected: boolean;
  accountId?: string;
  status?: string;
}

export function normalizeAccount(raw: Record<string, unknown>): ComposioAccountRef {
  const toolkit = (raw.toolkit ?? {}) as { slug?: string; name?: string };
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    appName: String(toolkit.slug ?? raw.toolkit_slug ?? raw.appName ?? '').toLowerCase(),
    status: String(raw.status ?? ''),
    entityId: (raw.user_id ?? raw.userId ?? raw.entity_id ?? '') as string,
  };
}

export function toolkitStatus(
  accounts: ComposioAccountRef[],
  toolkit: string,
  entityId?: string,
): ToolkitConnState {
  const slug = toolkit.toLowerCase();
  const match = accounts.find((a) => a.appName === slug && (!entityId || !a.entityId || a.entityId === entityId))
    ?? accounts.find((a) => a.appName === slug);
  if (!match) return { connected: false };
  return {
    connected: match.status.toUpperCase() === 'ACTIVE',
    accountId: match.id,
    status: match.status,
  };
}

/**
 * Local connection-card id convention. Must match the cards the Tools tab
 * actually renders (TOOLKIT_CONN labels, else `cn-tk-<slug>`): a different
 * prefix here used to create ghost duplicate cards next to the real ones.
 */
const KNOWN_CARDS: Record<string, string> = {
  gmail: 'cn-gmail',
  calendar: 'cn-calendar',
  drive: 'cn-drive',
  slack: 'cn-slack',
  hubspot: 'cn-hubspot',
  stripe: 'cn-stripe',
  linkedin: 'cn-linkedin',
};

export function connectionIdForToolkit(toolkit: string): string {
  const slug = toolkit.toLowerCase();
  return KNOWN_CARDS[slug] ?? `cn-tk-${slug}`;
}

/** Composio toolkit → inbox messaging channel (reverse of CHANNEL_COMPOSIO_APP). */
const TOOLKIT_TO_COMMS_CHANNEL: Record<string, 'email' | 'sms' | 'whatsapp' | 'telegram'> = {
  gmail: 'email',
  outlook: 'email',
  twilio: 'sms',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
};

export function commsChannelForToolkit(toolkit: string): 'email' | 'sms' | 'whatsapp' | 'telegram' | null {
  return TOOLKIT_TO_COMMS_CHANNEL[toolkit.toLowerCase()] ?? null;
}

/**
 * The one Composio entity every screen connects and acts under. Gmail connected on the Integrations page is the same Gmail the Inbox,
 * invoices and agents send with. (Screens used to pick their own - "workspace-inbox", "workspace-comms", the company id - so one app
 * could be connected several times and each copy was invisible to the others.)
 */
export const COMPOSIO_ENTITY = 'default';
