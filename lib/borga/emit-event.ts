import 'server-only';
import { getBorgaState } from './persistence';
import { userWsKey } from './keys';
import { loadQueue, saveQueue } from './webhook-queue';
import type { Webhook } from './data';

/** Enqueue a payload to every active webhook subscribed to `event` (best-effort, never throws). */
export async function emitEvent(userId: string, ws: string, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const hooks = (await getBorgaState<Webhook[]>(userWsKey(userId, ws, 'webhooks'))) ?? [];
    const targets = hooks.filter((h) => h.active && h.event === event);
    if (targets.length === 0) return;
    const queue = await loadQueue(userId, ws);
    const now = new Date().toISOString();
    for (const w of targets) {
      queue.push({ webhookId: w.id, eventId: event, payload: { event, ws, at: now, ...payload }, status: 'pending', attempts: 0, lastAttempt: now, nextAttempt: now });
    }
    await saveQueue(userId, ws, queue);
  } catch { /* best-effort */ }
}
