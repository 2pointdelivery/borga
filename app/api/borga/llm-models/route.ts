import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { DEFAULT_PROVIDER_CONFIG } from '@/lib/borga/llm-providers';
import { getApiKey } from '@/lib/borga/secrets';
import { fetchPublic, readTextCapped } from '@/lib/borga/safe-url';
import { FREE_LLM_PROVIDERS, parseModelList, presetFor } from '@/lib/borga/model-catalog';

export const runtime = 'nodejs';

/**
 * POST { providerId, freeOnly? } -> the provider's live model list, reduced to chat models and classified free / credits / paid.
 *
 * The request goes to the provider's built-in base URL only, never to a URL taken from the workspace catalog: the catalog is
 * editable, and the shared API key must never be sent to an address a user typed.
 */
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { providerId?: unknown; freeOnly?: unknown } | null;
  const providerId = typeof body?.providerId === 'string' ? body.providerId : '';
  const preset = presetFor(providerId);
  if (!preset) {
    return NextResponse.json({ ok: false, error: `Loading models is supported for: ${FREE_LLM_PROVIDERS.map((p) => p.label).join(', ')}.` }, { status: 400 });
  }

  const cfg = DEFAULT_PROVIDER_CONFIG[providerId];
  if (!cfg?.baseUrl) return NextResponse.json({ ok: false, error: `${preset.label} has no base URL configured.` }, { status: 400 });
  const apiKey = cfg.envVar ? await getApiKey(cfg.envVar).catch(() => '') : '';
  if (!apiKey && !preset.keyOptional) {
    return NextResponse.json({ ok: false, error: `Add the ${preset.label} API key first (free signup: ${preset.signupUrl}).` });
  }

  try {
    const res = await fetchPublic(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ' The API key was rejected; check it was copied in full.' : res.status === 429 ? ' Rate limited; try again in a minute.' : '';
      return NextResponse.json({ ok: false, error: `${preset.label} answered HTTP ${res.status}.${hint}` });
    }
    const payload = JSON.parse(await readTextCapped(res, 4_000_000)) as unknown;
    const parsed = parseModelList(providerId, payload, { freeOnly: body?.freeOnly !== false });
    if (parsed.models.length === 0) {
      return NextResponse.json({ ok: false, error: `${preset.label} returned no usable chat models.` });
    }
    return NextResponse.json({ ok: true, providerId, models: parsed.models, total: parsed.total, skipped: parsed.skipped, loadedAt: Date.now() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ ok: false, error: `Could not load the ${preset.label} model list: ${msg.slice(0, 160)}` });
  }
}
