import { NextResponse, type NextRequest } from 'next/server';
import { paymentRequired } from '@/lib/borga/billing-server';
import { activatedCandidates, fallbackEnabled } from '@/lib/borga/llm-fallback';
import { getBorgaState, scopedKey } from '@/lib/borga/persistence';
import { resolveProviderConfig, resolveApiKey } from '@/lib/borga/llm-providers';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { kbFactsFor } from '@/lib/borga/supermemory-context';
import { userWsKey } from '@/lib/borga/keys';
import { type KnowledgeEntry } from '@/lib/borga/data';
import { MODEL_PROVIDER_PREFIX } from '@/lib/borga/agent-context';
import { BORGA_SYSTEM_PROMPT, sendBrainTurn, streamBrainTurn, type BrainMessage } from '@/lib/borga/agent-core';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

export const runtime = 'nodejs';

interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Provider → env-key / base-URL resolution is now dynamic and company-specific.
// See lib/borga/llm-providers.ts: the per-workspace `llmCatalog` (DB-backed)
// overrides the server defaults, so providers can be added/renamed without code.

// Tier 1 unified brain: single system prompt lives in lib/borga/agent-core.ts.
const SYSTEM_PROMPT = BORGA_SYSTEM_PROMPT;

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  let body: { messages?: ChatMsg[]; model?: string; providerId?: string; ws?: string; companyName?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: 'Invalid request body.' }, { status: 400 });
  }

  const wsParam = body.ws;
  const ws = typeof wsParam === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  const companyName = (body.companyName ?? 'the company').slice(0, 80);
  if (userId && ws) {
    const unpaid = await paymentRequired(userId, ws);
    if (unpaid) return NextResponse.json({ reply: unpaid.error, billing: unpaid.billing }, { status: 402 });
  }

  const rawModel = body.model ?? '';
  let providerId = body.providerId ?? 'llm-pollinations';
  let model = rawModel;

  // Align routing and prefix-stripping exactly with resolved agent-context LLM logic.
  // Resolves mismatched providerIds and slices off vendor prefixes (e.g. "nvidia/") where required.
  const hit = MODEL_PROVIDER_PREFIX.find((m) => rawModel.toLowerCase().startsWith(m.prefix));
  if (hit) {
    providerId = hit.provider;
    model = hit.strip ? rawModel.slice(hit.prefix.length) : rawModel;
  }

  const cfg = await resolveProviderConfig(providerId, ws, userId);
  // A keyless provider (Pollinations, LLM7) has no key variable and must not borrow NVIDIA's; the others resolve env first, then the DB-stored key.
  const envKeyName = cfg.envVar;
  const baseUrl = cfg.baseUrl;
  const apiKey = await resolveApiKey(cfg);
  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...(body.messages ?? [])];

  // Load knowledge base for injection / demo responses — same key the dashboard
  // itself reads (userWsKey), not the bare per-workspace key.
  let kb: KnowledgeEntry[] = [];
  try {
    const kbKey = ws && userId ? userWsKey(userId, ws, 'knowledge') : scopedKey(ws, 'knowledge');
    kb = (await getBorgaState<KnowledgeEntry[]>(kbKey)) ?? [];
  } catch {
    // KB is optional
  }

  const lastUserText = (body.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content ?? '';

  // Can the requested model be called at all? Muse and the custom endpoint need an address; most others need a key. When it cannot,
  // the company's other activated models answer instead (see lib/borga/llm-fallback.ts) rather than the chat just failing.
  const needsAddress = providerId === 'llm-muse' || providerId === 'llm-custom';
  const requestedUsable = !(needsAddress && !baseUrl) && !(envKeyName && !apiKey && !cfg.optionalKey);
  const fallbackReady = !requestedUsable && (await fallbackEnabled({ ws, userId })) && (await activatedCandidates({ ws, userId })).length > 0;
  if (!requestedUsable && !fallbackReady) {
    const providerLabel = providerId.replace('llm-', '');
    const reply = providerId === 'llm-muse'
      ? 'Muse is not set up yet. Add its remote base URL (https://…/v1) and API key under Integrations → AI & Voice.'
      : providerId === 'llm-custom'
        ? 'The custom endpoint is not set up yet. Add its base URL and API key under Integrations → AI & Voice.'
        : `${providerLabel} isn't connected: no API key is configured. Add ${envKeyName} (Integrations → AI & Voice) to enable this provider.`;
    return NextResponse.json({ reply, error: needsAddress ? 'ENDPOINT_NOT_CONFIGURED' : 'API_KEY_MISSING' }, { status: 400 });
  }


  // Inject knowledge base into system prompt
  if (kb.length) {
    const facts = await kbFactsFor(userId, ws, kb, lastUserText);
      messages.unshift({ role: 'system', content: `Knowledge base (${companyName}):\n${facts}` });
  }

  // Tier 1: all cloud turns flow through the unified brain seam (never the SDK directly).
  const brainMessages: BrainMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  // An unusable requested model is passed as null: the fallback then starts from the company's first activated one.
  const provider = requestedUsable ? { providerId, model, apiKey, baseUrl } : null;
  const turnCtx = { ws, userId };

  const wantsStream = new URL(req.url).searchParams.get('stream') === '1';
  if (wantsStream) {
    const readable = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (data: object) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        try {
          let full = '';
          await streamBrainTurn(brainMessages, provider, (token) => {
            full += token;
            send({ type: 'token', token });
          }, turnCtx);
          // streamBrainTurn emits the fallback as a single token when streaming
          // is unavailable, so `full` is always the complete reply here.
          send({ type: 'complete', reply: full });
        } catch (err) {
          console.error('Borga chat stream error', err);
          send({ type: 'error', error: 'Borga had trouble reaching the model. Please try again shortly.' });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const reply = await sendBrainTurn(brainMessages, provider, turnCtx);
  return NextResponse.json({ reply }, { status: 200 });
}
