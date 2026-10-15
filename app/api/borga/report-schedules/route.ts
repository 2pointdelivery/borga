import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import { deleteReportSchedule, loadReportSchedules, putReportSchedule } from '@/lib/borga/report-schedules-server';
import { sendScheduledReport } from '@/lib/borga/email-notify';
import type { ReportSchedule } from '@/lib/borga/report-schedules-core';

export const runtime = 'nodejs';

// P&L email schedules: list / save / delete / toggle / send-now.
// Session-scoped to the caller's own workspaces; recipients and delivery ride
// the existing Email updates settings (rate cap, suppression, unsubscribe).

const scheduleSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(80),
  enabled: z.boolean().optional(),
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  hour: z.number().int().min(0).max(23),
});

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), ws: z.string(), schedule: scheduleSchema }),
  z.object({ action: z.literal('delete'), ws: z.string(), id: z.string().max(64) }),
  z.object({ action: z.literal('toggle'), ws: z.string(), id: z.string().max(64), enabled: z.boolean() }),
  z.object({ action: z.literal('sendNow'), ws: z.string(), id: z.string().max(64) }),
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
  return NextResponse.json({ ok: true, schedules: await loadReportSchedules(g.userId, ws) });
}

export async function POST(req: NextRequest) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const g = await guard(req, parsed.data.ws);
  if ('res' in g) return g.res;
  const { userId, ws } = { userId: g.userId, ws: parsed.data.ws };
  const b = parsed.data;

  if (b.action === 'save') {
    // The schema only admits P&L schedules today; the validator wants it named.
    const r = await putReportSchedule(userId, ws, { ...b.schedule, report: 'pl' } as Partial<ReportSchedule>);
    if (r.errors) return NextResponse.json({ ok: false, errors: r.errors }, { status: 400 });
    return NextResponse.json({ ok: true, schedule: r.schedule });
  }

  if (b.action === 'delete') {
    const ok = await deleteReportSchedule(userId, ws, b.id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  const schedules = await loadReportSchedules(userId, ws);
  const schedule = schedules.find((s) => s.id === b.id);
  if (!schedule) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  if (b.action === 'toggle') {
    const r = await putReportSchedule(userId, ws, { ...schedule, enabled: b.enabled });
    if (r.errors) return NextResponse.json({ ok: false, errors: r.errors }, { status: 400 });
    return NextResponse.json({ ok: true, schedule: r.schedule });
  }

  // sendNow: explicit user action — bypasses the master switch and dedupe (like Send test email).
  const r = await sendScheduledReport(userId, ws, schedule.cadence, { force: true });
  const { putReportSchedule: put } = await import('@/lib/borga/report-schedules-server');
  await put(userId, ws, { ...schedule, lastSentAt: r.sent > 0 ? new Date().toISOString() : schedule.lastSentAt, lastResult: r.sent > 0 ? `Sent to ${r.sent}.` : `Not sent: ${r.skipped ?? `${r.failed} failed`}.` });
  return NextResponse.json({ ok: r.sent > 0, ...r, error: r.sent > 0 ? undefined : r.skipped ?? 'The mail server is not configured or refused the message.' });
}
