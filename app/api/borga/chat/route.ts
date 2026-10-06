import { NextResponse, type NextRequest } from 'next/server';
import { paymentRequired } from '@/lib/borga/billing-server';
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

  // --- Muse (local CLI) ---
  // Runs on the user's own machine. Without a configured local address there
  // is nothing to call, so the reply says how to install it instead of failing.
  if (providerId === 'llm-muse') {
    let museHost = '';
    try {
      museHost = baseUrl ? new URL(baseUrl).hostname : '';
    } catch {
      museHost = '';
    }
    const museLocal = museHost === 'localhost' || museHost === '127.0.0.1' || museHost === '::1' || museHost.endsWith('.local');
    if (!baseUrl || !museLocal) {
      return NextResponse.json({ reply: 'Muse runs on your own computer via the Muse CLI. Install it first: /bin/bash -c "$(curl -fsSL https://dev.meta.ai/cli/install-opencode.sh)", then set its local address under Integrations → AI & Voice.' }, { status: 200 });
    }

    if (kb.length) {
      const facts = await kbFactsFor(userId, ws, kb, lastUserText);
      messages.unshift({ role: 'system', content: `Knowledge base (${companyName}):\n${facts}` });
    }

    try {
      const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: 512, temperature: 0.6 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!upstream.ok) {
        return NextResponse.json({
          reply: 'Muse returned an error — is the CLI serving its local endpoint at the configured address?'
        }, { status: 502 });
      }
      const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
      return NextResponse.json({ reply: data.choices?.[0]?.message?.content?.trim() ?? 'Borga received no answer.' }, { status: 200 });
    } catch {
      // Muse not reachable → plain guidance, no stack trace
      return NextResponse.json({
        reply: 'Muse is not reachable at its configured local address. Install the CLI: /bin/bash -c "$(curl -fsSL https://dev.meta.ai/cli/install-opencode.sh)", then set its local address under Integrations → AI & Voice.',
        error: 'MUSE_UNREACHABLE'
      }, { status: 502 });
    }
  }

  // --- Custom endpoint ---
  if (providerId === 'llm-custom') {
    const customBase = process.env.LLM_BASE_URL ?? '';
    const customKey = process.env.LLM_API_KEY ?? '';
    const isValidUrl = (() => {
      try { return !!new URL(customBase) && !['example', 'xxx', 'placeholder'].includes(customBase.toLowerCase()); }
      catch { return false; }
    })();
    if (!isValidUrl || !customKey || ['xxx', 'placeholder', 'your-key'].includes(customKey)) {
      return NextResponse.json({
        reply: 'Custom endpoint is not configured. Set LLM_BASE_URL (a valid OpenAI-compatible base URL) and LLM_API_KEY in .env.',
        error: 'CUSTOM_ENDPOINT_NOT_CONFIGURED'
      }, { status: 400 });
    }

    if (kb.length) {
      const facts = await kbFactsFor(userId, ws, kb, lastUserText);
      messages.unshift({ role: 'system', content: `Knowledge base (${companyName}):\n${facts}` });
    }

    try {
      const upstream = await fetch(`${customBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customKey}` },
        body: JSON.stringify({ model, messages, max_tokens: 512, temperature: 0.6 }),
        signal: AbortSignal.timeout(45000),
      });
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Custom LLM error', upstream.status, text.slice(0, 200));
        return NextResponse.json({ 
          reply: 'Custom LLM endpoint returned an error. Check LLM_BASE_URL and LLM_API_KEY in .env.',
          error: 'CUSTOM_LLM_ERROR'
        }, { status: 502 });
      }
      const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
      return NextResponse.json({ reply: data.choices?.[0]?.message?.content?.trim() ?? 'Borga received no answer.' }, { status: 200 });
    } catch (err) {
      console.error('Custom LLM error', err);
      return NextResponse.json({ 
        reply: 'Custom LLM endpoint is unreachable. Verify LLM_BASE_URL in .env.',
        error: 'CUSTOM_LLM_UNREACHABLE'
      }, { status: 502 });
    }
  }

  // --- Standard cloud providers (require API key) ---
  if (envKeyName && !apiKey) {
    const providerLabel = providerId.replace('llm-', '');
    return NextResponse.json(
      { 
        reply: `${providerLabel} isn't connected — no server-side API key is configured. Add ${envKeyName} in .env to enable this provider.`,
        error: 'API_KEY_MISSING'
      },
      { status: 400 },
    );
  }

  // Inject knowledge base into system prompt
  if (kb.length) {
    const facts = await kbFactsFor(userId, ws, kb, lastUserText);
      messages.unshift({ role: 'system', content: `Knowledge base (${companyName}):\n${facts}` });
  }

  // Tier 1: all cloud turns flow through the unified brain seam (never the SDK directly).
  const brainMessages: BrainMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const provider = { providerId, model, apiKey, baseUrl };

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
          });
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

  const reply = await sendBrainTurn(brainMessages, provider);
  return NextResponse.json({ reply }, { status: 200 });
}
