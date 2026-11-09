import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from './features-server';
import { isValidWsId } from './keys';
import { ownsWorkspaceStrict } from './workspace-access';

/**
 * The front door for every route that acts on a workspace. It answers, in
 * order: is there a signed-in user (401), is the workspace id well formed
 * (400), and does that workspace belong to this user (403). Mutating routes
 * also require the dashboard CSRF header, so a cross-site form post cannot
 * ride an authenticated cookie.
 *
 * Ownership is checked strictly here: a database error while reading the
 * registry denies the request instead of failing open.
 */

export type WorkspaceGuard =
  | { ok: true; userId: string; ws: string }
  | { ok: false; res: NextResponse };

const unauthorized = () => NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
const badWs = () => NextResponse.json({ ok: false, error: 'A valid workspace id is required.' }, { status: 400 });
const forbidden = () => NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
const csrf = () => NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

/** True when the request carries the dashboard header. CSRF defence for state changes. */
export function hasDashboardHeader(req: NextRequest): boolean {
  return req.headers.get('X-Borga-Client') === 'borga-dashboard';
}

export async function requireWorkspace(
  req: NextRequest,
  ws: unknown,
  opts: { csrf?: boolean } = {},
): Promise<WorkspaceGuard> {
  if (opts.csrf && !hasDashboardHeader(req)) return { ok: false, res: csrf() };
  const userId = await sessionUserId(req);
  if (!userId) return { ok: false, res: unauthorized() };
  if (!isValidWsId(ws)) return { ok: false, res: badWs() };
  if (!(await ownsWorkspaceStrict(userId, ws))) return { ok: false, res: forbidden() };
  return { ok: true, userId, ws };
}

/** Session-only routes (no workspace yet, e.g. listing the caller's companies). */
export async function requireSession(req: NextRequest, opts: { csrf?: boolean } = {}): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  if (opts.csrf && !hasDashboardHeader(req)) return { ok: false, res: csrf() };
  const userId = await sessionUserId(req);
  return userId ? { ok: true, userId } : { ok: false, res: unauthorized() };
}

/** 429 with the standard Retry-After header. */
export function tooManyRequests(retryAfterSec: number, message = 'Too many requests. Try again shortly.'): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) } },
  );
}
