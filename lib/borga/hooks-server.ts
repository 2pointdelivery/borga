import 'server-only';
import { createHash } from 'crypto';
import { insertBorgaStateIfAbsent, deleteBorgaState } from './persistence';

/**
 * Provider webhook plumbing. Later phases register handlers here
 * (WhatsApp inbound in phase 3, Twilio call status/voicemail in phase 4);
 * the public route authenticates and de-duplicates before any handler runs.
 */

export interface HookContext {
  userId: string;
  ws: string;
  provider: 'meta' | 'twilio';
  /** Parsed payload: JSON object (Meta) or form fields (Twilio). */
  payload: Record<string, unknown>;
  /** Stable id used to drop provider retries. */
  eventId: string;
}

export type HookHandler = (ctx: HookContext) => Promise<void>;

const handlers: Record<'meta' | 'twilio', HookHandler[]> = { meta: [], twilio: [] };

export function registerHook(provider: 'meta' | 'twilio', handler: HookHandler): void {
  handlers[provider].push(handler);
}

export async function dispatchHook(ctx: HookContext): Promise<number> {
  for (const h of handlers[ctx.provider]) await h(ctx);
  return handlers[ctx.provider].length;
}

/** Atomic first-seen claim for an event. False means it is a retry/replay. */
const claimKey = (userId: string, ws: string, provider: string, eventId: string) =>
  `t::${userId}::${ws}::hook::${provider}::${createHash('sha1').update(eventId).digest('hex')}`;

export async function claimEvent(userId: string, ws: string, provider: string, eventId: string): Promise<boolean> {
  return insertBorgaStateIfAbsent(claimKey(userId, ws, provider, eventId), { at: new Date().toISOString() });
}

/** Un-claim after a handler failure so the provider's retry is processed, not dropped as a duplicate. */
export async function releaseEvent(userId: string, ws: string, provider: string, eventId: string): Promise<void> {
  await deleteBorgaState(claimKey(userId, ws, provider, eventId));
}

export const hashBody = (raw: string): string => createHash('sha256').update(raw).digest('hex');
