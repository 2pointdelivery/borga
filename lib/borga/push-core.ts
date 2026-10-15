import type { NoticeSeverity, NotificationPrefs, ProactiveNotice } from './data';

/**
 * Web-push core: pure rules for self-hosted VAPID push (no third party).
 * The I/O twin is push-server.ts; the browser twin is public/sw.js.
 */

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface StoredPushSubscription extends PushSubscriptionJson {
  createdAt: string;
  userAgent: string | null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Collapses repeat pushes for one notice into a single notification. */
  tag: string;
  /** Where the service worker sends the user on tap. */
  url: string;
  severity: NoticeSeverity;
  noticeId: string;
}

export interface PushTarget {
  page: string;
  tab?: string;
}

/** Browsers per user+workspace: enough for phone + laptop + tablet, bounded so a row cannot grow forever. */
export const MAX_SUBSCRIPTIONS = 20;

const TITLE_LIMIT = 60;
const BODY_LIMIT = 180;

/** A push subscription must point at a real (https) push service and carry both encryption keys. */
export function isValidSubscription(s: unknown): s is PushSubscriptionJson {
  if (!s || typeof s !== 'object') return false;
  const sub = s as Record<string, unknown>;
  if (typeof sub.endpoint !== 'string') return false;
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  const keys = sub.keys as Record<string, unknown> | undefined;
  return !!keys && typeof keys.p256dh === 'string' && keys.p256dh.length > 0 && typeof keys.auth === 'string' && keys.auth.length > 0;
}

/** Urgent must wake the device; noteworthy waits its turn; info stays in-app only (never pushed). */
export function pushUrgency(severity: NoticeSeverity): 'high' | 'normal' {
  return severity === 'urgent' ? 'high' : 'normal';
}

/** Where a notice deep-links: an agent run opens Runs & Queue, a task opens the Planner, the rest open Overview. */
export function noticeTarget(n: Pick<ProactiveNotice, 'taskId' | 'runId'>): PushTarget {
  if (n.runId) return { page: 'ai', tab: 'runs' };
  if (n.taskId) return { page: 'ai', tab: 'planner' };
  return { page: 'overview', tab: 'command' };
}

function truncate(s: string, limit: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > limit ? `${t.slice(0, limit - 1).trimEnd()}…` : t;
}

/** Build the JSON the service worker renders. Titles/bodies are truncated so one long notice cannot overflow the tray. */
export function buildPushPayload(n: ProactiveNotice, appUrl: string): PushPayload {
  const base = (appUrl || '').replace(/\/$/, '');
  return {
    title: truncate(n.title || 'Borga', TITLE_LIMIT),
    body: truncate(n.body || '', BODY_LIMIT),
    tag: `borga-${n.id}`,
    url: `${base}/app`,
    severity: n.severity,
    noticeId: n.id,
  };
}

export interface PushGate {
  pushUrgent: boolean;
  pushNoteworthy: boolean;
}

/** Resolve push prefs with onboarding-safe defaults: push is on for urgent and noteworthy once a device is subscribed. */
export function resolvePushGate(prefs: NotificationPrefs | null | undefined): PushGate {
  return {
    pushUrgent: prefs?.pushUrgent ?? true,
    pushNoteworthy: prefs?.pushNoteworthy ?? true,
  };
}

/** Pure delivery decision: subscribed, and the severity's switch is on. Info never leaves the app. */
export function shouldPush(gate: PushGate, severity: NoticeSeverity, subscriptionCount: number): boolean {
  if (subscriptionCount <= 0) return false;
  if (severity === 'urgent') return gate.pushUrgent;
  if (severity === 'noteworthy') return gate.pushNoteworthy;
  return false;
}

/** Merge a subscription list: dedupe by endpoint, newest first, bounded. Returns the list to store. */
export function mergeSubscriptions(
  existing: StoredPushSubscription[],
  sub: PushSubscriptionJson,
  userAgent: string | null,
  nowIso: string,
): StoredPushSubscription[] {
  const next = [{ ...sub, createdAt: nowIso, userAgent }, ...existing.filter((s) => s.endpoint !== sub.endpoint)];
  return next.slice(0, MAX_SUBSCRIPTIONS);
}

const B64URL = /^[A-Za-z0-9\-_]+$/;

/**
 * Validate VAPID keys from the environment without touching the network.
 * `web-push generate-vapid-keys` prints url-safe base64: 65 bytes public (~87 chars), 32 bytes private (43 chars).
 */
export function validateVapidEnv(env: Record<string, string | undefined>): { ok: boolean; reason?: string } {
  const pub = (env.VAPID_PUBLIC_KEY ?? '').trim();
  const priv = (env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (env.VAPID_SUBJECT ?? '').trim();
  if (!pub || !priv) return { ok: false, reason: 'VAPID keys are not set (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Push stays off.' };
  if (!B64URL.test(pub) || pub.length < 80 || pub.length > 90) return { ok: false, reason: 'VAPID_PUBLIC_KEY is malformed (expected url-safe base64, ~87 chars).' };
  if (!B64URL.test(priv) || priv.length !== 43) return { ok: false, reason: 'VAPID_PRIVATE_KEY is malformed (expected url-safe base64, 43 chars).' };
  if (subject && !/^mailto:.+@.+|^https?:\/\/.+/.test(subject)) return { ok: false, reason: 'VAPID_SUBJECT should be a mailto: address or https URL.' };
  return { ok: true };
}
