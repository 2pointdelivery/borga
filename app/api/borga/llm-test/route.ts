import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { resolveProviderConfig, resolveApiKey } from '@/lib/borga/llm-providers';
import { callLlm } from '@/lib/borga/agent-context';

export const runtime = 'nodejs';

/**
 * POST { ws, providerId, model } -> sends one tiny real completion and reports the measured
 * latency. This replaces the hardcoded "120ms / online" the dashboard used to show.
 */
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { ws?: unknown; providerId?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
  const { ws, providerId, model } = body;
  if (!isValidWsId(ws) || typeof providerId !== 'string' || typeof model !== 'string' || !model) {
    return NextResponse.json({ ok: false, error: 'ws, providerId and model are required' }, { status: 400 });
  }
  if (providerId === 'llm-demo') return NextResponse.json({ ok: true, latencyMs: 0, note: 'Built-in demo needs no key.' });

  const cfg = await resolveProviderConfig(providerId, ws, userId);
  if (!cfg.baseUrl) return NextResponse.json({ ok: false, error: 'No base URL configured for this provider.' });
  const apiKey = await resolveApiKey(cfg);
  if (cfg.envVar && !apiKey) return NextResponse.json({ ok: false, error: `No API key saved (${cfg.envVar}).` });

  const t0 = Date.now();
  try {
    const out = await callLlm([{ role: 'user', content: 'Reply with the single word OK.' }], { providerId, model, apiKey, baseUrl: cfg.baseUrl });
    return NextResponse.json({ ok: true, latencyMs: Date.now() - t0, reply: out.slice(0, 40) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const msg = (err.message || 'failed') + (err.cause?.code ? ' (' + err.cause.code + ': check the base URL and that the server is reachable)' : '');
    // Provider error bodies can be long; the status line is what the user needs.
    return NextResponse.json({ ok: false, error: msg.slice(0, 300), latencyMs: Date.now() - t0 });
  }
}
