import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { getUserById } from '@/lib/auth/queries';
import { getBorgaStatesByPrefix } from '@/lib/borga/persistence';
import { userWorkspacesKey, isValidUserId } from '@/lib/borga/keys';
import type { Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = await verifySessionToken(req.cookies.get(sessionCookieName())?.value);
  if (!userId || !isValidUserId(userId)) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });

  const rows = await getBorgaStatesByPrefix(userWorkspacesKey(user.id));
  const workspaces = (rows[userWorkspacesKey(user.id)] as Workspace[] | undefined) ?? [];

  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
    workspaces,
    activeWorkspaceId: workspaces[0]?.id ?? null,
  });
}
