import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { getConnection } from '@/lib/borga/connections-server';
import { engineConfigFrom, fetchResource, resourceUrl, testEngine } from '@/lib/borga/engine-http';
import { normalizeAll, normalizeCustomer, normalizeLead, type CrmCustomer, type CrmLead } from '@/lib/borga/crm-core';

export const runtime = 'nodejs';

/**
 * Company Engine: pull customers and deals from the company's own CRM/API.
 * The browser never sees the API key; it receives normalised records and merges them
 * into Borga's customers/leads (so the dashboard remains the only writer of those lists).
 *
 *   GET  ?ws=             -> is a connection saved? which URLs?
 *   POST {action:'test'}  -> first-page check
 *   POST {action:'pull', resources:['customers','leads']} -> normalised records + counts
 */

const body = z.object({ action: z.enum(['test', 'pull']), resources: z.array(z.enum(['customers', 'leads'])).max(2).optional() });

async function guard(req: NextRequest) {
  const userId = await sessionUserId(req);
  const ws = new URL(req.url).searchParams.get('ws');
  if (!userId) return { res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isValidWsId(ws)) return { res: NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 }) } as const;
  return { userId, ws } as const;
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const cfg = engineConfigFrom(await getConnection(g.userId, g.ws, 'company_engine'));
  return NextResponse.json({
    ok: true,
    configured: !!cfg && !!cfg.apiKey,
    customersUrl: cfg ? resourceUrl(cfg, 'customers') : null,
    leadsUrl: cfg ? resourceUrl(cfg, 'leads') : null,
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  const cfg = engineConfigFrom(await getConnection(g.userId, g.ws, 'company_engine'));
  if (!cfg || !cfg.apiKey) return NextResponse.json({ ok: false, error: 'Save the Company Engine connection (URL and API key) first.' }, { status: 400 });

  if (parsed.data.action === 'test') return NextResponse.json({ ok: true, result: await testEngine(cfg) });

  const wanted = parsed.data.resources?.length ? parsed.data.resources : (['customers', 'leads'] as const);
  const out: { customers?: { records: CrmCustomer[]; skipped: number; pages: number; truncated: boolean }; leads?: { records: CrmLead[]; skipped: number; pages: number; truncated: boolean } } = {};
  const errors: Record<string, string> = {};
  for (const resource of wanted) {
    const r = await fetchResource(cfg, resource);
    if (!r.ok) {
      errors[resource] = r.error;
      continue;
    }
    if (resource === 'customers') out.customers = { ...normalizeAll(r.rows, normalizeCustomer), pages: r.pages, truncated: r.truncated };
    else out.leads = { ...normalizeAll(r.rows, normalizeLead), pages: r.pages, truncated: r.truncated };
  }
  return NextResponse.json({ ok: Object.keys(errors).length === 0, ...out, errors });
}
