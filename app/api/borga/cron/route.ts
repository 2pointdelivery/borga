import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { tickWorkspace, listScheduledWorkspaces } from '@/lib/borga/heartbeat';
import { loadFeatures } from '@/lib/borga/features-server';
import { listTicketWorkspaces, pollMailbox, sweepSla } from '@/lib/borga/tickets-server';
import { listConnectionWorkspaces } from '@/lib/borga/connections-server';
import { runDueSyncJobs } from '@/lib/borga/sync-jobs';
import '@/lib/borga/sync-registry';
import { processAllPendingDeliveries } from '@/lib/borga/webhook-queue';

export const runtime = 'nodejs';

/**
 * Always-on home: beat the heartbeat without a laptop or browser.
 *
 * Point any scheduler at this endpoint (cron-job.org, Vercel Cron, systemd
 * timer, or curl on a 5-minute schedule):
 *
 *   POST /api/borga/cron  Authorization: Bearer $CRON_SECRET
 *
 * CRON_SECRET lives in the server environment ONLY — it is deliberately not
 * in the UI-configurable key allowlist (lib/borga/secrets.ts), so it can
 * never be pasted into the dashboard or returned to a client. Without it the
 * endpoint answers 401 and runs nothing. Each workspace's own kill switch,
 * quiet hours, and overlap guard still apply per beat.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  let single: { ws?: string; userId?: string } = {};
  try {
    single = (await req.json()) as { ws?: string; userId?: string };
  } catch {
    single = {};
  }

  const valid = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
  const targets = valid(single.ws) && valid(single.userId)
    ? [{ ws: single.ws, userId: single.userId }]
    : await listScheduledWorkspaces();

  const results: Record<string, unknown> = {};
  for (const t of targets) {
    try {
      const flags = (await loadFeatures(t.userId, t.ws)).flags;
      results[`${t.userId}/${t.ws}`] = flags.heartbeat ? await tickWorkspace(t.ws, t.userId) : { skipped: 'feature "heartbeat" is off' };
    } catch (e) {
      results[`${t.userId}/${t.ws}`] = { ok: false, error: (e as Error).message };
    }
  }

  // Support desk: pull new mail (IMAP mailboxes) and escalate SLA crossings.
  const tickets: Record<string, unknown> = {};
  for (const t of await listTicketWorkspaces()) {
    try {
      if (!(await loadFeatures(t.userId, t.ws)).flags.tickets) continue;
      const mail = await pollMailbox(t.userId, t.ws);
      const sla = await sweepSla(t.userId, t.ws);
      tickets[`${t.userId}/${t.ws}`] = { mail, sla };
    } catch (e) {
      tickets[`${t.userId}/${t.ws}`] = { ok: false, error: (e as Error).message };
    }
  }
  // Integration sync jobs (ads, comps, scheduled posts ...) for every workspace with a connection.
  const sync: Record<string, unknown> = {};
  for (const t of await listConnectionWorkspaces()) {
    try {
      sync[`${t.userId}/${t.ws}`] = await runDueSyncJobs(t.userId, t.ws);
    } catch (e) {
      sync[`${t.userId}/${t.ws}`] = { ok: false, error: (e as Error).message };
    }
  }
  const webhooksPending = await processAllPendingDeliveries().catch(() => -1);
  return NextResponse.json({ ok: true, workspaces: targets.length, results, tickets, sync, webhooksPending });
}

export async function GET(req: NextRequest) {
  // Health probe for the scheduler target — auth required, runs nothing.
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const targets = await listScheduledWorkspaces();
  return NextResponse.json({ ok: true, workspaces: targets.length });
}
