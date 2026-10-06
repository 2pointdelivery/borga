import 'server-only';
import { getBorgaState, setBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { INITIAL_NOTICES, type ProactiveNotice } from './data';

/**
 * Held inbox: everything the heartbeat (and now the run queue) surfaces while
 * you were away waits here until you dismiss it — never deliver-once-and-lose-it.
 * Split out of heartbeat.ts so the run queue can post completion notices
 * without an import cycle.
 */

export function noticesKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'notices') : scopedKey(ws, 'notices');
}

export async function loadNotices(ws: string | null | undefined, userId: string | null | undefined): Promise<ProactiveNotice[]> {
  return (await getBorgaState<ProactiveNotice[]>(noticesKey(ws, userId))) ?? [...INITIAL_NOTICES];
}

export async function addNotice(notice: ProactiveNotice, ws: string | null | undefined, userId: string | null | undefined): Promise<void> {
  const existing = await loadNotices(ws, userId);
  await setBorgaState(noticesKey(ws, userId), [notice, ...existing].slice(0, 100));
  if (notice.severity === 'urgent' && ws && userId) void import('./email-notify').then((m) => m.notifyEvent(userId, ws, 'agent_urgent', { title: notice.title, body: notice.body, at: notice.createdAt })).catch(() => undefined);
}
