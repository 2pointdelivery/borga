import 'server-only';
import { callLlm, loadCatalog } from './agent-context';
import { fetchPublic, readTextCapped } from './safe-url';
import { parseModelList } from './model-catalog';
import { resolveApiKey, resolveProviderConfig } from './llm-providers';
import { loadSettings } from './heartbeat-settings';
import { addNotice } from './notices';
import { LLM_PROVIDERS, RETIRED_LLM_PROVIDERS } from './data';
import {
  AllModelsFailed, ProviderHealth, planOrder, runWithFallback,
  type Candidate, type FallbackResult,
} from './llm-fallback-core';

export { AllModelsFailed, type Candidate, type FallbackResult } from './llm-fallback-core';

/**
 * Graceful fallback between a company's activated AI models, applied. Every text turn that goes through callLlmResilient tries the
 * requested model first and, when it fails, the next activated one, so a rate limit, an outage or a refused key on one provider no
 * longer stops agents, chat or voice.
 *
 * "Activated" means the company itself set the model up: a saved API key, or for Muse a saved address. The free community services
 * that need no account are never used as a silent fallback: they send prompts to a third party the company did not choose.
 */

type Ctx = { ws?: string | null; userId?: string | null };

const g = globalThis as typeof globalThis & { __borgaLlmHealth?: ProviderHealth };
const health = (g.__borgaLlmHealth ??= new ProviderHealth());

// A provider's live model list, kept for an hour: used to find a working model when the saved one no longer exists.
const modelCache = new Map<string, { at: number; ids: string[] }>();
async function liveModelIds(c: Candidate): Promise<string[]> {
  const key = `${c.providerId}|${c.baseUrl}`;
  const hit = modelCache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.ids;
  try {
    const res = await fetchPublic(`${c.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Accept: 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const parsed = parseModelList(c.providerId, JSON.parse(await readTextCapped(res, 4_000_000)) as unknown, { freeOnly: false });
    const ids = parsed.models.map((m) => m.id);
    modelCache.set(key, { at: Date.now(), ids });
    return ids;
  } catch {
    return [];
  }
}

// Remembers a model that was replaced because it no longer exists, so the next request goes straight to the one that works.
const replaced = new Map<string, string>();
const replacedKey = (ctx: Ctx, c: Candidate) => `${ctx.userId ?? ''}|${ctx.ws ?? ''}|${c.providerId}|${c.model}`;

const keyFor = (ctx: Ctx) => (c: Candidate) => `${ctx.userId ?? ''}|${ctx.ws ?? ''}|${c.providerId}`;
const labelOf = (providerId: string) => LLM_PROVIDERS.find((p) => p.id === providerId)?.label ?? providerId.replace(/^llm-/, '');

/** The company's activated models in fallback order (its saved order first, then the catalog's), each with the model it would use. */
export async function activatedCandidates(ctx: Ctx): Promise<Candidate[]> {
  const ws = ctx.ws ?? null;
  const userId = ctx.userId ?? null;
  const catalog = await loadCatalog(ws, userId);
  const found: Candidate[] = [];
  for (const p of catalog) {
    if (RETIRED_LLM_PROVIDERS.includes(p.id)) continue;
    const cfg = await resolveProviderConfig(p.id, ws, userId).catch(() => null);
    if (!cfg?.baseUrl || !cfg.envVar) continue; // no address, or a keyless service: not something the company activated
    const apiKey = await resolveApiKey(cfg).catch(() => '');
    if (!apiKey && !cfg.optionalKey) continue;
    const model = (p.models.find((m) => m.tier === 'free') ?? p.models[0])?.id;
    if (!model) continue;
    found.push({ providerId: p.id, model, apiKey, baseUrl: cfg.baseUrl });
  }
  const order = (await loadSettings(ws, userId).catch(() => null))?.llmFallbackOrder ?? [];
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  return found.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.providerId) - rank(b.c.providerId) || a.i - b.i).map((x) => x.c);
}

/**
 * Whether any model could answer right now: the one in use or an activated one, and not paused after failing. Work that would only
 * fail (and spend a retry budget) is not queued while this is false.
 */
export async function anyModelReady(ctx: Ctx): Promise<boolean> {
  const { getConfiguredLlm } = await import('./agent-context');
  const primary = await getConfiguredLlm(ctx.ws ?? null, ctx.userId ?? null).catch(() => null);
  const list = [...(primary ? [primary] : []), ...((await fallbackEnabled(ctx)) ? await activatedCandidates(ctx) : [])];
  const key = keyFor(ctx);
  return list.some((c) => !health.coolingUntil(key(c)));
}

/** Whether fallback is on for the company (it is, unless switched off in Integrations → AI & Voice). */
export async function fallbackEnabled(ctx: Ctx): Promise<boolean> {
  return (await loadSettings(ctx.ws ?? null, ctx.userId ?? null).catch(() => null))?.llmFallback !== false;
}

/** One model call with fallback. Throws AllModelsFailed (with a readable message) only when every activated model failed. */
export async function callLlmResilient(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  primary: Candidate | null,
  ctx: Ctx = {},
): Promise<FallbackResult> {
  const enabled = await fallbackEnabled(ctx);
  const others = enabled ? await activatedCandidates(ctx) : [];
  const key = keyFor(ctx);
  const swap = (c: Candidate): Candidate => ({ ...c, model: replaced.get(replacedKey(ctx, c)) ?? c.model });
  const chain = planOrder(primary ? swap(primary) : null, others.map(swap), health, key, enabled ? 4 : 1);
  const asked = new Map(chain.map((c) => [c.providerId, c.model]));
  const result = await runWithFallback(chain, (c) => callLlm(messages, c), health, key, labelOf, liveModelIds);
  const was = asked.get(result.used.providerId);
  if (was && was !== result.used.model) replaced.set(replacedKey(ctx, { ...result.used, model: was }), result.used.model);
  if (result.newlyDown.length && ctx.ws && ctx.userId) {
    // Said once, when a model first goes down, not on every request that skips it.
    for (const f of result.newlyDown) {
      void addNotice({
        id: `n-llm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: `${labelOf(f.providerId)} is not answering`,
        body: `${labelOf(f.providerId)} failed because ${f.reason}. Borga is using ${labelOf(result.used.providerId)} instead and will try ${labelOf(f.providerId)} again shortly.`,
        severity: 'noteworthy',
        source: 'agent',
        createdAt: new Date().toISOString(),
        readAt: null,
      }, ctx.ws, ctx.userId).catch(() => undefined);
    }
  }
  return result;
}

/** What the Settings card shows: the chain, and which models are cooling down right now. */
export async function fallbackStatus(ctx: Ctx, primary: Candidate | null) {
  const candidates = await activatedCandidates(ctx);
  const key = keyFor(ctx);
  const chain = [...(primary ? [primary] : []), ...candidates.filter((c) => c.providerId !== primary?.providerId)];
  const seen = new Set<string>();
  return {
    enabled: await fallbackEnabled(ctx),
    chain: chain.filter((c) => (seen.has(c.providerId) ? false : (seen.add(c.providerId), true))).map((c) => ({
      providerId: c.providerId,
      label: labelOf(c.providerId),
      model: c.model,
      primary: c.providerId === primary?.providerId,
      activated: candidates.some((a) => a.providerId === c.providerId),
      coolingUntil: health.coolingUntil(key(c)) || null,
    })),
  };
}
