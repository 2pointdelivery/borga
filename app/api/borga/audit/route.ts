import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import { readAudit } from '@/lib/borga/audit';

export const runtime = 'nodejs';

/** Workspace save audit: newest first. Session-scoped to the caller's own workspaces. */
export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws') ?? '';
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, audit: (await readAudit(userId, ws)).slice(0, 100) });
}
