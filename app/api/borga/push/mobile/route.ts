import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import { listExpoTokens, registerExpoToken, unregisterExpoToken, isExpoPushToken } from '@/lib/borga/expo-push';

export const runtime = 'nodejs';

// Mobile push registration (expo-notifications): the device sends its
// ExponentPushToken; urgent/noteworthy notices fan out to it alongside web
// push. Session-scoped to the caller's own workspaces.

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), ws: z.string(), token: z.string().min(20).max(200) }),
  z.object({ action: z.literal('unregister'), ws: z.string(), token: z.string().min(20).max(200) }),
]);

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws') ?? '';
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, tokens: (await listExpoTokens(userId, ws)).length });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const { ws, token } = parsed.data;
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
  }
  if (!isExpoPushToken(token)) return NextResponse.json({ ok: false, error: 'invalid_token' }, { status: 400 });
  const r = parsed.data.action === 'register'
    ? await registerExpoToken(userId, ws, token)
    : await unregisterExpoToken(userId, ws, token);
  return NextResponse.json({ ok: true, ...r });
}
