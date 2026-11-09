import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import { createPortalToken, listPortalTokens, revokePortalToken } from '@/lib/borga/portal-server';

export const runtime = 'nodejs';

// Portal links for customer accounts: mint (secret shown once), list, revoke.
// Session-scoped to the caller's own workspaces; customers use the token routes instead.

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ws: z.string(), customerId: z.string().max(64), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
  z.object({ action: z.literal('revoke'), ws: z.string(), id: z.string().max(64) }),
]);

async function guard(req: NextRequest, ws: string) {
  const userId = await sessionUserId(req);
  if (!userId) return { res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return { res: NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 }) } as const;
  }
  return { userId } as const;
}

export async function GET(req: NextRequest) {
  const ws = new URL(req.url).searchParams.get('ws') ?? '';
  const g = await guard(req, ws);
  if ('res' in g) return g.res;
  return NextResponse.json({ ok: true, tokens: await listPortalTokens(g.userId, ws) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const g = await guard(req, parsed.data.ws);
  if ('res' in g) return g.res;
  const { userId, ws } = { userId: g.userId, ws: parsed.data.ws };

  if (parsed.data.action === 'revoke') {
    const ok = await revokePortalToken(userId, ws, parsed.data.id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }
  const r = await createPortalToken(userId, ws, parsed.data.customerId, { expiresAt: parsed.data.expiresAt });
  if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: 404 });
  const appUrl = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '');
  return NextResponse.json({ ok: true, ...r, url: appUrl ? `${appUrl}/portal/${r.secret}` : `/portal/${r.secret}` });
}
