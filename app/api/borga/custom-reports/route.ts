import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import {
  deleteCustomReport,
  listShareLinks,
  loadCustomReports,
  mintShareLink,
  putCustomReport,
  revokeShareLink,
  runReportServer,
} from '@/lib/borga/custom-reports-server';
import type { CustomReport } from '@/lib/borga/custom-report';

export const runtime = 'nodejs';

// Custom reports: list / save / delete / run (own data), plus share links
// (mint once, list, revoke). Session-scoped to the caller's own workspaces.

const filterSchema = z.object({
  field: z.string().max(40),
  op: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than']),
  value: z.string().max(200),
});

const reportSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(80),
  dataset: z.enum(['invoices', 'bills', 'leads', 'customers', 'tickets', 'tasks']),
  columns: z.array(z.string().max(40)).max(12),
  filters: z.array(filterSchema).max(8),
  groupBy: z.string().max(40).optional(),
});

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), ws: z.string(), report: reportSchema }),
  z.object({ action: z.literal('delete'), ws: z.string(), id: z.string().max(64) }),
  z.object({ action: z.literal('run'), ws: z.string(), id: z.string().max(64) }),
  z.object({ action: z.literal('share'), ws: z.string(), id: z.string().max(64) }),
  z.object({ action: z.literal('unshare'), ws: z.string(), shareId: z.string().max(64) }),
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
  return NextResponse.json({ ok: true, reports: await loadCustomReports(g.userId, ws), shares: await listShareLinks(g.userId, ws) });
}

export async function POST(req: NextRequest) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const g = await guard(req, parsed.data.ws);
  if ('res' in g) return g.res;
  const { userId, ws } = { userId: g.userId, ws: parsed.data.ws };
  const b = parsed.data;

  if (b.action === 'save') {
    const r = await putCustomReport(userId, ws, b.report as Partial<CustomReport>);
    if (r.errors) return NextResponse.json({ ok: false, errors: r.errors }, { status: 400 });
    return NextResponse.json({ ok: true, report: r.report });
  }

  if (b.action === 'delete') {
    const ok = await deleteCustomReport(userId, ws, b.id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  if (b.action === 'run') {
    const reports = await loadCustomReports(userId, ws);
    const report = reports.find((r) => r.id === b.id);
    if (!report) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, name: report.name, result: await runReportServer(userId, ws, report) });
  }

  if (b.action === 'share') {
    const r = await mintShareLink(userId, ws, b.id);
    if ('error' in r) return NextResponse.json({ ok: false, error: r.error }, { status: 404 });
    const appUrl = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '');
    return NextResponse.json({ ok: true, ...r, url: appUrl ? `${appUrl}/share/${r.secret}` : `/share/${r.secret}` });
  }

  const ok = await revokeShareLink(userId, ws, b.shareId);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
}
