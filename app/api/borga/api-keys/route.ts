import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId, userWorkspacesKey } from '@/lib/borga/keys';
import { getBorgaState } from '@/lib/borga/persistence';
import type { Workspace } from '@/lib/borga/data';
import { createApiKey, listApiKeys, revokeApiKey, toPublic } from '@/lib/borga/api-keys-server';

export const runtime = 'nodejs';

// API key management is session-only: keys themselves never mint keys.
async function me(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return null;
  return userId;
}

async function ownWorkspaces(userId: string): Promise<string[]> {
  const ws = (await getBorgaState<Workspace[]>(userWorkspacesKey(userId))) ?? [];
  return ws.map((w) => w.id).filter((id) => isValidWsId(id));
}

export async function GET(req: NextRequest) {
  const userId = await me(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const keys = (await listApiKeys(userId)).map(toPublic);
  return NextResponse.json({ ok: true, keys });
}

const createSchema = z.object({
  action: z.literal('create'),
  name: z.string().trim().min(1).max(80),
  wsIds: z.array(z.string().max(64)).max(50).optional(),
});

const revokeSchema = z.object({
  action: z.literal('revoke'),
  id: z.string().max(64),
});

export async function POST(req: NextRequest) {
  const userId = await me(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = z.discriminatedUnion('action', [createSchema, revokeSchema]).safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'action must be create {name, wsIds?} or revoke {id}' }, { status: 400 });

  if (parsed.data.action === 'revoke') {
    const ok = await revokeApiKey(userId, parsed.data.id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Key not found or already revoked.' }, { status: 404 });
  }

  const owned = await ownWorkspaces(userId);
  const requested = parsed.data.wsIds?.filter((w) => isValidWsId(w)) ?? [];
  // An empty or fully-invalid scope falls back to every workspace the user owns.
  const wsIds = requested.length ? requested.filter((w) => owned.includes(w)) : owned;
  const { record, secret } = await createApiKey(userId, parsed.data.name, wsIds.length ? wsIds : owned);
  // The secret is shown exactly once — it is stored hashed and can never be read back.
  return NextResponse.json({ ok: true, key: record, secret });
}
