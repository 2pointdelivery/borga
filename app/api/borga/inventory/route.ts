import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { featureGate } from '@/lib/borga/features-server';
import { resolveLlm, callLlm } from '@/lib/borga/agent-context';
import { descriptionPrompt, templateDescription, type ItemType } from '@/lib/borga/inventory';
import { currencySymbol } from '@/lib/borga/currencies';

export const runtime = 'nodejs';

/**
 * AI product/service descriptions for the inventory catalog. Uses the
 * workspace model when one is configured; otherwise (or on failure) it
 * answers with the deterministic template — honestly labelled by `source`
 * so the UI never pretends a generated paragraph came from a model.
 */

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

function isValidWsId(ws: unknown): ws is string {
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
}

interface DescribeTarget {
  id?: string;
  name: string;
  type?: ItemType;
  category?: string;
  unit?: string;
  price?: number;
}

const clean = (s: string): string => s
  .replace(/```[a-z]*\n?/gi, '')
  .replace(/[*_#>`]+/g, '')
  .replace(/^["'\s]+|["'\s]+$/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 600);

function readTarget(raw: Record<string, unknown>): DescribeTarget | null {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const type: ItemType = raw.type === 'service' ? 'service' : 'product';
  const price = Number(raw.price ?? 0);
  return {
    id: raw.id ? String(raw.id).slice(0, 60) : undefined,
    name: name.slice(0, 120),
    type,
    category: raw.category ? String(raw.category).slice(0, 60) : '',
    unit: raw.unit ? String(raw.unit).slice(0, 20) : 'ea',
    price: Number.isFinite(price) && price >= 0 ? price : 0,
  };
}

async function describeOne(
  target: DescribeTarget,
  companyName: string,
  currency: string,
  ws: string | null,
  userId: string | null,
): Promise<{ description: string; source: 'model' | 'template'; model?: string }> {
  const fallback = templateDescription(
    { name: target.name, type: target.type ?? 'product', category: target.category ?? '', unit: target.unit ?? 'ea', price: target.price ?? 0 },
    currency,
    currencySymbol(currency),
  );
  try {
    const provider = await resolveLlm(null, ws, userId);
    if (!provider) return { description: fallback, source: 'template' };
    const prompt = descriptionPrompt(
      { name: target.name, type: target.type ?? 'product', category: target.category ?? '', unit: target.unit ?? 'ea', price: target.price ?? 0 },
      companyName,
      currency,
    );
    const out = await callLlm([{ role: 'user', content: prompt }], provider);
    const text = clean(out);
    if (!text || text.length < 20) return { description: fallback, source: 'template' };
    return { description: text, source: 'model', model: provider.model };
  } catch {
    return { description: fallback, source: 'template' };
  }
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

  const ws = isValidWsId(body.ws) ? body.ws : null;
  const gate = await featureGate('inventory', userId, ws);
  if (gate) return gate;

  const currency = String(body.currency ?? 'USD').slice(0, 3).toUpperCase();
  const companyName = String(body.companyName ?? 'the company').slice(0, 80);

  // One item.
  if (body.action === 'describe' || body.action === undefined) {
    const target = readTarget(body);
    if (!target) return NextResponse.json({ ok: false, error: 'name is required' }, { status: 400 });
    const r = await describeOne(target, companyName, currency, ws, userId);
    return NextResponse.json({ ok: true, ...r });
  }

  // A batch (catalog "generate missing descriptions" — capped, one model call each).
  if (body.action === 'describeMany') {
    const raw = Array.isArray(body.items) ? body.items : [];
    const targets = raw
      .slice(0, 8)
      .map((r) => readTarget((r ?? {}) as Record<string, unknown>))
      .filter((t): t is DescribeTarget => t !== null);
    if (!targets.length) return NextResponse.json({ ok: false, error: 'items[] is required' }, { status: 400 });
    const results = [];
    for (const t of targets) {
      const r = await describeOne(t, companyName, currency, ws, userId);
      results.push({ id: t.id, ...r });
    }
    return NextResponse.json({ ok: true, results });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${String(body.action)}` }, { status: 400 });
}
