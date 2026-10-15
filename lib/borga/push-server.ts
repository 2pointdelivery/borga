import 'server-only';
import webPush from 'web-push';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { ownsWorkspace } from './workspace-access';
import {
  buildPushPayload,
  isValidSubscription,
  mergeSubscriptions,
  pushUrgency,
  resolvePushGate,
  shouldPush,
  validateVapidEnv,
  type PushSubscriptionJson,
  type StoredPushSubscription,
} from './push-core';
import type { NotificationPrefs, ProactiveNotice, SettingsState } from './data';

/**
 * Self-hosted VAPID web push (no third party). Subscriptions live per
 * user+workspace next to the notices they amplify; dead endpoints (410/404)
 * are pruned on send so the row cannot fill with corpses.
 */

export const pushSubscriptionsKey = (userId: string, ws: string): string => userWsKey(userId, ws, 'pushSubscriptions');

export function vapidStatus(): { ok: boolean; reason?: string } {
  return validateVapidEnv(process.env);
}

let vapidReady = false;

/** Configure web-push from the environment once. False when push is unavailable (warned about at boot). */
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const v = vapidStatus();
  if (!v.ok) return false;
  try {
    webPush.setVapidDetails(
      (process.env.VAPID_SUBJECT ?? '').trim() || 'mailto:borga@localhost',
      (process.env.VAPID_PUBLIC_KEY ?? '').trim(),
      (process.env.VAPID_PRIVATE_KEY ?? '').trim(),
    );
  } catch {
    return false;
  }
  vapidReady = true;
  return true;
}

export async function loadSubscriptions(userId: string, ws: string): Promise<StoredPushSubscription[]> {
  const stored = await getBorgaState<StoredPushSubscription[]>(pushSubscriptionsKey(userId, ws)).catch(() => null);
  return Array.isArray(stored) ? stored.filter(isValidSubscription) : [];
}

async function loadNotifPrefs(userId: string, ws: string): Promise<NotificationPrefs | undefined> {
  const settings = await getBorgaState<SettingsState>(userWsKey(userId, ws, 'settings')).catch(() => null);
  return settings?.notifications;
}

export async function addSubscription(
  userId: string,
  ws: string,
  sub: PushSubscriptionJson,
  userAgent: string | null,
): Promise<{ stored: boolean; count: number }> {
  if (!(await ownsWorkspace(userId, ws))) return { stored: false, count: 0 };
  const existing = await loadSubscriptions(userId, ws);
  const next = mergeSubscriptions(existing, sub, userAgent, new Date().toISOString());
  const ok = await setBorgaState(pushSubscriptionsKey(userId, ws), next);
  return { stored: ok, count: next.length };
}

export async function removeSubscription(userId: string, ws: string, endpoint: string): Promise<{ removed: boolean; count: number }> {
  if (!(await ownsWorkspace(userId, ws))) return { removed: false, count: 0 };
  const existing = await loadSubscriptions(userId, ws);
  const next = existing.filter((s) => s.endpoint !== endpoint);
  const removed = next.length !== existing.length;
  if (removed) await setBorgaState(pushSubscriptionsKey(userId, ws), next);
  return { removed, count: next.length };
}

export interface PushSendResult {
  attempted: number;
  sent: number;
  failed: number;
  pruned: number;
  skipped: string | null;
}

function statusOf(e: unknown): number | null {
  if (typeof e === 'object' && e !== null && 'statusCode' in e && typeof (e as { statusCode: unknown }).statusCode === 'number') {
    return (e as { statusCode: number }).statusCode;
  }
  return null;
}

/** Send one notice to every subscribed device. Never throws: failures are counted, dead endpoints pruned. */
export async function sendPushToUser(userId: string, ws: string, notice: ProactiveNotice): Promise<PushSendResult> {
  const zero: PushSendResult = { attempted: 0, sent: 0, failed: 0, pruned: 0, skipped: null };
  if (!ensureVapid()) return { ...zero, skipped: 'push_unconfigured' };
  let subs: StoredPushSubscription[];
  try {
    subs = await loadSubscriptions(userId, ws);
  } catch {
    return { ...zero, skipped: 'database_unavailable' };
  }
  const gate = resolvePushGate(await loadNotifPrefs(userId, ws).catch(() => undefined));
  if (!shouldPush(gate, notice.severity, subs.length)) return { ...zero, skipped: 'gated' };
  const payload = JSON.stringify(buildPushPayload(notice, (process.env.APP_URL ?? '').trim()));
  const urgency = pushUrgency(notice.severity);
  const TTL = 7 * 24 * 3600;
  const outcomes = await Promise.all(
    subs.map(async (s) => {
      try {
        await webPush.sendNotification(s, payload, { urgency, TTL });
        return 'sent' as const;
      } catch (e) {
        const code = statusOf(e);
        return code === 404 || code === 410 ? ('gone' as const) : ('failed' as const);
      }
    }),
  );
  const sent = outcomes.filter((o) => o === 'sent').length;
  const failed = outcomes.filter((o) => o === 'failed').length;
  const gone = subs.filter((_, i) => outcomes[i] === 'gone');
  if (gone.length > 0) {
    const keep = subs.filter((_, i) => outcomes[i] !== 'gone');
    await setBorgaState(pushSubscriptionsKey(userId, ws), keep).catch(() => false);
  }
  return { attempted: subs.length, sent, failed, pruned: gone.length, skipped: null };
}

/** Fan-out for notice producers (heartbeat, run queue, SLA sweeps). Fire-and-forget: never rejects. */
export function pushForNotice(userId: string, ws: string, notice: ProactiveNotice): Promise<PushSendResult> {
  return sendPushToUser(userId, ws, notice).catch(() => ({ attempted: 0, sent: 0, failed: 0, pruned: 0, skipped: 'error' }));
}

/** Batch twin for producers that write several notices at once (SLA sweeps). Never rejects. */
export async function pushForNotices(userId: string, ws: string, notices: ProactiveNotice[]): Promise<PushSendResult> {
  const total: PushSendResult = { attempted: 0, sent: 0, failed: 0, pruned: 0, skipped: null };
  for (const n of notices.slice(0, 8)) {
    const r = await pushForNotice(userId, ws, n);
    total.attempted += r.attempted;
    total.sent += r.sent;
    total.failed += r.failed;
    total.pruned += r.pruned;
    if (r.skipped && !total.skipped) total.skipped = r.skipped;
  }
  return total;
}
