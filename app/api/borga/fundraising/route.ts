import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import {
  analyzeOpportunity,
  applyForOpportunity,
  draftApplication,
  loadOpportunities,
  patchOpportunity,
  runFullPipeline,
} from '@/lib/borga/fundraising-pipeline';

export const runtime = 'nodejs';

/**
 * Nadia's autonomous fundraising surface: browse program websites, summarize
 * requirements + expectations, draft applications, and run the full pipeline.
 * Every action persists onto the opportunity so the Fundraising tab, agent
 * runs and the scheduler all see the same state.
 */

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

function isValidWsId(ws: unknown): ws is string {
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const wsParam = new URL(req.url).searchParams.get('ws');
  const ws = isValidWsId(wsParam) ? wsParam : null;
  return NextResponse.json({ ok: true, opportunities: await loadOpportunities(ws, userId) });
}

export async function POST(req: NextRequest) {
  if (req.headers.get('X-Borga-Client') !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const ws = isValidWsId(body.ws) ? body.ws : null;
  const id = String(body.id ?? '');
  const agent = { id: 'a-fundraising', name: 'Nadia' };

  // Analyze one program site (requirements + expectations + fit).
  if (action === 'analyze') {
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    const r = await analyzeOpportunity(id, ws, userId, agent);
    if (!r.ok && r.error === 'Opportunity not found') {
      return NextResponse.json({ ok: false, error: r.error }, { status: 404 });
    }
    const opp = (await loadOpportunities(ws, userId)).find((o) => o.id === id) ?? null;
    return NextResponse.json({ ok: r.ok, result: r, opportunity: opp });
  }

  // Browse every open program site and summarize each.
  if (action === 'analyze-all') {
    const open = (await loadOpportunities(ws, userId)).filter((o) => !['applied', 'won', 'rejected'].includes(o.stage));
    const results = [];
    for (const o of open) {
      results.push(await analyzeOpportunity(o.id, ws, userId, agent));
    }
    return NextResponse.json({ ok: true, results, opportunities: await loadOpportunities(ws, userId) });
  }

  // Draft (or re-draft) one application from profile + analyzed facts.
  if (action === 'draft') {
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    const r = await draftApplication(id, ws, userId, agent);
    if (!r.ok && r.error === 'Opportunity not found') {
      return NextResponse.json({ ok: false, error: r.error }, { status: 404 });
    }
    const opp = (await loadOpportunities(ws, userId)).find((o) => o.id === id) ?? null;
    return NextResponse.json({ ok: r.ok, result: r, opportunity: opp });
  }

  // Advance one opportunity: auto-apply at 85%+ fit, else review-ready draft.
  if (action === 'apply') {
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    const r = await applyForOpportunity(id, ws, userId, agent);
    if (!r.ok && r.error === 'Opportunity not found') {
      return NextResponse.json({ ok: false, error: r.error }, { status: 404 });
    }
    const opp = (await loadOpportunities(ws, userId)).find((o) => o.id === id) ?? null;
    return NextResponse.json({ ok: r.ok, result: r, opportunity: opp });
  }

  // Full autonomous pass over every open program (or one id).
  if (action === 'pipeline') {
    const report = await runFullPipeline(ws, userId, agent, id || undefined);
    return NextResponse.json({ ok: true, report, opportunities: await loadOpportunities(ws, userId) });
  }

  // Update editable fields (program, amount, deadline, url, note, stage).
  if (action === 'update') {
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const f of ['program', 'amount', 'deadline', 'url', 'note', 'stage', 'matchScore'] as const) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    const opp = await patchOpportunity(id, patch as never, ws, userId);
    if (!opp) return NextResponse.json({ ok: false, error: 'Opportunity not found' }, { status: 404 });
    return NextResponse.json({ ok: true, opportunity: opp });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
