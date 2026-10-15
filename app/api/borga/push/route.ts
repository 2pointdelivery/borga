import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { isValidSubscription } from '@/lib/borga/push-core';
import {
  addSubscription,
  loadSubscriptions,
  pushForNotice,
  removeSubscription,
  vapidStatus,
} from '@/lib/borga/push-server';
import { ownsWorkspace } from '@/lib/borga/workspace-access';

export const runtime = 'nodejs';

// Browser push subscriptions: session-only, one row per user+workspace.
// GET: { configured, subscriptions } — the client needs the public key to subscribe.
// POST subscribe { ws, subscription } / unsubscribe { ws, endpoint } / test { ws }.

const subscriptionSchema = z.object({
  endpoint: z.string().max(2000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subscribe'), ws: z.string(), subscription: subscriptionSchema, userAgent: z.string().max(500).optional() }),
  z.object({ action: z.literal('unsubscribe'), ws: z.string(), endpoint: z.string().max(2000) }),
  z.object({ action: z.literal('test'), ws: z.string() }),
]);

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const ws = url.searchParams.get('ws') ?? '';
  const status = vapidStatus();
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return NextResponse.json({ ok: true, configured: status.ok, publicKey: status.ok ? (process.env.VAPID_PUBLIC_KEY ?? '').trim() : null, subscriptions: 0 });
  }
  const subs = await loadSubscriptions(userId, ws);
  return NextResponse.json({
    ok: true,
    configured: status.ok,
    publicKey: status.ok ? (process.env.VAPID_PUBLIC_KEY ?? '').trim() : null,
    subscriptions: subs.length,
  });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'action must be subscribe {ws, subscription} / unsubscribe {ws, endpoint} / test {ws}' }, { status: 400 });
  const { ws } = parsed.data;
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
  }

  if (parsed.data.action === 'subscribe') {
    if (!vapidStatus().ok) return NextResponse.json({ ok: false, error: 'push_unconfigured' }, { status: 503 });
    const sub = parsed.data.subscription;
    if (!isValidSubscription(sub)) return NextResponse.json({ ok: false, error: 'invalid_subscription' }, { status: 400 });
    const r = await addSubscription(userId, ws, sub, (parsed.data.userAgent ?? req.headers.get('user-agent') ?? '').slice(0, 200) || null);
    if (!r.stored) return NextResponse.json({ ok: false, error: 'database_unavailable' }, { status: 503 });
    return NextResponse.json({ ok: true, subscriptions: r.count });
  }

  if (parsed.data.action === 'unsubscribe') {
    const r = await removeSubscription(userId, ws, parsed.data.endpoint);
    return NextResponse.json({ ok: true, removed: r.removed, subscriptions: r.count });
  }

  // test: one real delivery attempt to this caller's devices, reported honestly.
  const subs = await loadSubscriptions(userId, ws);
  if (subs.length === 0) return NextResponse.json({ ok: false, error: 'no_subscriptions' }, { status: 404 });
  const result = await pushForNotice(userId, ws, {
    id: `push-test-${Date.now().toString(36)}`,
    title: 'Push is working',
    body: 'Borga will now reach this device even with the dashboard closed.',
    severity: 'noteworthy',
    source: 'scheduler',
    createdAt: new Date().toISOString(),
    readAt: null,
  });
  return NextResponse.json({ ok: result.sent > 0, ...result });
}
