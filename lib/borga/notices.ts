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
  // Urgent and noteworthy notices also try browser push (gated by the workspace's push prefs and subscriptions; never throws).
  if ((notice.severity === 'urgent' || notice.severity === 'noteworthy') && ws && userId) {
    void import('./push-server').then((m) => m.pushForNotice(userId, ws, notice)).catch(() => undefined);
    // …and the phone (Expo), best-effort, same severity gate.
    void import('./expo-push').then((m) => m.pushMobileForNotice(userId, ws, notice.title, notice.body, { noticeId: notice.id, severity: notice.severity })).catch(() => undefined);
  }
  // Urgent notices are also workflow events (escalate to an agent, page the team email). Dedupe by notice id.
  if (notice.severity === 'urgent' && ws && userId) {
    void import('./flows-server')
      .then((m) => m.fireEvent(userId, ws, 'notice.urgent', { title: notice.title, body: notice.body }, `notice:${notice.id}`))
      .catch(() => undefined);
  }
}
