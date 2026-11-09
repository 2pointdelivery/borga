import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { ownsWorkspace } from './workspace-access';

/**
 * Mobile push via Expo (expo-notifications on the device hands us an
 * ExponentPushToken; we POST to Expo's push service, which routes to FCM/APNs).
 * Tokens register per user+workspace and ride the same notice fan-out as web
 * push. Sends are best-effort and never throw into the producer.
 *
 * Not verifiable without a physical device + Expo project: the register route,
 * storage, dedupe and fan-out are exercised; the Expo API call shape follows
 * their documented /v2/push/send contract (run scripts/smoke-expo-push.mjs
 * once with a real token).
 */

const tokensKey = (u: string, ws: string): string => userWsKey(u, ws, 'expoPushTokens');

/** Expo push tokens are long, distinctive strings; anything else is refused before storage. */
export function isExpoPushToken(v: unknown): v is string {
  return typeof v === 'string' && /^ExponentPushToken\[.{8,120}\]$/.test(v) || (typeof v === 'string' && v.length >= 20 && v.length <= 200 && /^[A-Za-z0-9_\-=]+$/.test(v));
}

export async function listExpoTokens(u: string, ws: string): Promise<string[]> {
  const stored = (await getBorgaState<string[]>(tokensKey(u, ws)).catch(() => null)) ?? [];
  return Array.isArray(stored) ? [...new Set(stored.filter(isExpoPushToken))].slice(0, 5) : [];
}

export async function registerExpoToken(u: string, ws: string, token: string): Promise<{ stored: boolean; count: number }> {
  if (!(await ownsWorkspace(u, ws)) || !isExpoPushToken(token)) return { stored: false, count: 0 };
  const existing = await listExpoTokens(u, ws);
  const next = [token, ...existing.filter((t) => t !== token)].slice(0, 5);
  const ok = await setBorgaState(tokensKey(u, ws), next).catch(() => false);
  return { stored: ok, count: next.length };
}

export async function unregisterExpoToken(u: string, ws: string, token: string): Promise<{ removed: boolean; count: number }> {
  const existing = await listExpoTokens(u, ws);
  const next = existing.filter((t) => t !== token);
  const removed = next.length !== existing.length;
  if (removed) await setBorgaState(tokensKey(u, ws), next).catch(() => false);
  return { removed, count: next.length };
}

export interface ExpoSendResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: string | null;
}

/** POST to Expo's push service. Tickets are not individually tracked (no receipts endpoint here); failures count. */
export async function sendExpoPush(tokens: string[], title: string, body: string, data?: Record<string, unknown>): Promise<ExpoSendResult> {
  const zero: ExpoSendResult = { attempted: 0, sent: 0, failed: 0, skipped: null };
  if (!tokens.length) return { ...zero, skipped: 'no-tokens' };
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        tokens.slice(0, 10).map((to) => ({ to, title: title.slice(0, 60), body: body.slice(0, 180), sound: 'default', ...(data ? { data } : {}) })),
      ),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ...zero, attempted: tokens.length, failed: tokens.length, skipped: `expo-${res.status}` };
    const j = (await res.json().catch(() => null)) as { data?: Array<{ status?: string }> } | null;
    const results = j?.data ?? [];
    const sent = results.filter((t) => t.status === 'ok').length;
    return { attempted: tokens.length, sent, failed: tokens.length - sent, skipped: null };
  } catch {
    return { ...zero, attempted: tokens.length, failed: tokens.length, skipped: 'unreachable' };
  }
}

/** Fan-out used by the notice producers: web push first, Expo best-effort after. Never throws. */
export async function pushMobileForNotice(u: string, ws: string, title: string, body: string, data?: Record<string, unknown>): Promise<ExpoSendResult> {
  try {
    return await sendExpoPush(await listExpoTokens(u, ws), title, body, data);
  } catch {
    return { attempted: 0, sent: 0, failed: 0, skipped: 'error' };
  }
}
