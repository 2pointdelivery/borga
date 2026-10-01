import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { DEFAULT_PROVIDER_CONFIG, resolveProviderConfig } from '@/lib/borga/llm-providers';
import { getApiKey } from '@/lib/borga/secrets';
import { fetchPublic, readTextCapped } from '@/lib/borga/safe-url';
import { FREE_LLM_PROVIDERS, parseModelList, presetFor } from '@/lib/borga/model-catalog';

export const runtime = 'nodejs';

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.local');

/**
 * POST { providerId, freeOnly? } -> the provider's live model list, reduced to chat models and classified free / credits / paid.
 *
 * Public lists (OpenRouter, NVIDIA, SambaNova, Pollinations, LLM7) load with no key. Lists that need a key (Groq, Gemini, Cerebras,
 * Mistral) answer { needsKey: true } until one is saved. Ollama is read from the local server.
 *
 * The request goes to the provider's built-in base URL only, never to a URL taken from the workspace catalog: the catalog is
 * editable, and a saved API key must never be sent to an address a user typed.
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
  const freeOnly = body?.freeOnly !== false;

  try {
    let res: Response;
    if (preset.local) {
      // Ollama runs on the user's own machine, so the public-URL guard (which blocks private addresses) does not apply; the same
      // localhost-only rule as the chat route does.
      const base = (await resolveProviderConfig(providerId, null, userId)).baseUrl || 'http://127.0.0.1:11434/v1';
      let host: string;
      try {
        host = new URL(base).hostname;
      } catch {
        return NextResponse.json({ ok: false, error: 'The Ollama address is not a valid URL.' });
      }
      if (!isLocalHost(host)) {
        return NextResponse.json({ ok: false, error: 'Ollama must be on this computer (localhost). Change its address under Integrations if it is elsewhere on your network.' });
      }
      res = await fetch(`${base.replace(/\/$/, '')}/models`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }).catch(() => {
        throw new Error('Could not reach Ollama. Is it running? (start it with: ollama serve)');
      });
    } else {
      const cfg = DEFAULT_PROVIDER_CONFIG[providerId];
      if (!cfg?.baseUrl) return NextResponse.json({ ok: false, error: `${preset.label} has no base URL configured.` }, { status: 400 });
      const apiKey = cfg.envVar ? await getApiKey(cfg.envVar).catch(() => '') : '';
      if (!apiKey && !preset.keyOptional) {
        return NextResponse.json({
          ok: false,
          needsKey: true,
          error: `${preset.label}'s live list needs your free API key. Add it, and the models load automatically (free signup: ${preset.signupUrl}).`,
        });
      }
      res = await fetchPublic(`${cfg.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Accept: 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
    }

    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ' The API key was rejected; check it was copied in full.' : res.status === 429 ? ' Rate limited; try again in a minute.' : '';
      return NextResponse.json({ ok: false, error: `${preset.label} answered HTTP ${res.status}.${hint}` });
    }
    const payload = JSON.parse(await readTextCapped(res, 4_000_000)) as unknown;
    const parsed = parseModelList(providerId, payload, { freeOnly });
    if (parsed.models.length === 0) {
      return NextResponse.json({ ok: false, error: preset.local ? 'Ollama is running but has no models yet. Pull one, for example: ollama pull llama3.2' : `${preset.label} returned no usable chat models.` });
    }
    return NextResponse.json({ ok: true, providerId, models: parsed.models, total: parsed.total, skipped: parsed.skipped, loadedAt: Date.now() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ ok: false, error: `Could not load the ${preset.label} model list: ${msg.slice(0, 160)}` });
  }
}
