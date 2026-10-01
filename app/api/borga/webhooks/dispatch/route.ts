import { NextResponse, type NextRequest } from 'next/server';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey, isValidWsId } from '@/lib/borga/keys';
import { sessionUserId } from '@/lib/borga/features-server';
import { assertPublicHttpsUrl } from '@/lib/borga/safe-url';
import { loadQueue, processQueue, saveQueue, type Delivery } from '@/lib/borga/webhook-queue';
import type { Webhook } from '@/lib/borga/data';

export const runtime = 'nodejs';

/**
 * Outbound webhook delivery (Borga -> your endpoints), session-scoped to the user's own
 * `webhooks` entity and a per-workspace queue (lib/borga/webhook-queue.ts). The first attempt
 * is inline; failures retry 1s/5s/15s apart via the cron endpoint or `action: process`.
 */

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { action?: string; ws?: string; webhookId?: string; eventId?: string; payload?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }
  if (!isValidWsId(body.ws)) return NextResponse.json({ ok: false, error: 'A valid workspace id (ws) is required.' }, { status: 400 });
  const ws = body.ws;
  const hooks = (await getBorgaState<Webhook[]>(userWsKey(userId, ws, 'webhooks'))) ?? [];
  const action = body.action ?? 'dispatch';

  if (action === 'dispatch') {
    const { webhookId, eventId, payload } = body;
    if (!webhookId || !eventId || !payload) return NextResponse.json({ ok: false, error: 'webhookId, eventId and payload are required.' }, { status: 400 });
    const w = hooks.find((h) => h.id === webhookId);
    if (!w) return NextResponse.json({ ok: false, error: 'Webhook not found.' }, { status: 404 });
    if (!w.active) return NextResponse.json({ ok: false, error: 'Webhook is inactive.' }, { status: 400 });
    try {
      await assertPublicHttpsUrl(w.url);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
    }
    const queue = await loadQueue(userId, ws);
    queue.push({ webhookId, eventId, payload, status: 'pending', attempts: 0, lastAttempt: new Date().toISOString(), nextAttempt: new Date().toISOString() });
    await saveQueue(userId, ws, queue);
    const after = await processQueue(userId, ws, hooks);
    const d = after.filter((x) => x.webhookId === webhookId && x.eventId === eventId).pop();
    return NextResponse.json({ ok: true, action: 'dispatch', status: d?.status ?? 'pending', error: d?.error, message: d?.status === 'delivered' ? 'Delivered.' : 'Queued; failed attempts are retried.' });
  }

  if (action === 'process') {
    const after = await processQueue(userId, ws, hooks);
    return NextResponse.json({ ok: true, action: 'process', pending: after.filter((d) => d.status === 'pending').length });
  }

  if (action === 'status') {
    const q = await loadQueue(userId, ws);
    const n = (s: Delivery['status']) => q.filter((d) => d.status === s).length;
    return NextResponse.json({ ok: true, action: 'status', queue: { total: q.length, pending: n('pending'), failed: n('failed'), delivered: n('delivered') } });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
