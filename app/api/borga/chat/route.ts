import { NextResponse, type NextRequest } from 'next/server';
import { getBorgaState, scopedKey } from '@/lib/borga/persistence';
import { getApiKey } from '@/lib/borga/secrets';
import { resolveProviderConfig } from '@/lib/borga/llm-providers';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { userWsKey } from '@/lib/borga/keys';
import { type KnowledgeEntry } from '@/lib/borga/data';
import { MODEL_PROVIDER_PREFIX } from '@/lib/borga/agent-context';

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

const SYSTEM_PROMPT = `You are Borga, the orchestrator AI of an autonomous business command center. You are calm, concise and a little warm. You assist the user by delegating tasks to specialist agents, summarizing KPIs, and answering questions about their business.

When the user asks you to DO something (create a task, follow up, delegate), reply by echoing an actionable confirmation in plain language. Keep replies under ~90 words unless asked for detail. Respond conversationally in the language the user speaks.

The user is working inside one of their company workspaces; that company's knowledge base is provided when relevant. Use it to answer accurately about the company, its services and operations.`;

function generateFallbackResponse(messages: ChatMsg[], kb: KnowledgeEntry[], providerId: string): string {
  const lastUser = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const lower = lastUser.toLowerCase();
  const isDemo = providerId === 'Demo';

  // Search knowledge base for matching facts
  const relevant = kb
    .filter((k) => {
      const words = lower.split(/\s+/).filter((w) => w.length > 3);
      const titleLower = k.title.toLowerCase();
      return words.some((w) => titleLower.includes(w) || k.answer.toLowerCase().includes(w));
    })
    .slice(0, 2);

  if (relevant.length > 0) {
    return isDemo
      ? relevant.map((k) => k.answer).join(' ')
      : `${relevant.map((k) => k.answer).join(' ')}\n\n*(AI provider ${providerId} unavailable — check API key configuration)*`;
  }

  if (isDemo) {
    return "I don't have a stored answer for that yet — this is running in demo mode (no AI provider connected), so I can only cite the knowledge base. Add a real provider in Settings → AI & Voice for open-ended answers, or add the fact to the Knowledge Base.";
  }

  return `I'm unable to process your request right now as the AI provider (${providerId}) is not properly configured. Please check your API key settings in the Tools tab and ensure the provider is connected.`;
}

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
  
  const rawModel = body.model ?? 'demo';
  let providerId = body.providerId ?? 'llm-demo';
  let model = rawModel;

  // Align routing and prefix-stripping exactly with resolved agent-context LLM logic.
  // Resolves mismatched providerIds and slices off vendor prefixes (e.g. "nvidia/") where required.
  const hit = MODEL_PROVIDER_PREFIX.find((m) => rawModel.toLowerCase().startsWith(m.prefix));
  if (hit) {
    providerId = hit.provider;
    model = hit.strip ? rawModel.slice(hit.prefix.length) : rawModel;
  }

  const cfg = await resolveProviderConfig(providerId, ws, userId);
  const envKeyName = cfg.envVar || 'NVIDIA_API_KEY';
  const baseUrl = cfg.baseUrl;
  // Resolve from env first, then fall back to DB-stored key
  const apiKey = envKeyName ? await getApiKey(envKeyName) : '';
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

  // --- Demo mode: zero-config KB-aware fallback, no API key required ---
  // This is the DEFAULT_LLM selection, so chat must work out of the box; it
  // answers from the workspace knowledge base and otherwise says so plainly.
  if (providerId === 'llm-demo') {
    return NextResponse.json({ reply: generateFallbackResponse(messages, kb, 'Demo') }, { status: 200 });
  }

  // --- Ollama (local, no key required) ---
  if (providerId === 'llm-ollama') {
    const ollamaBase = baseUrl || 'http://127.0.0.1:11434/v1';
    // Validate it's not an external URL to prevent SSRF from env manipulation
    try {
      const u = new URL(ollamaBase);
      const host = u.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
      if (!isLocal && !process.env.OLLAMA_BASE_URL) {
        return NextResponse.json({ reply: 'OLLAMA_BASE_URL must point to a local Ollama instance.' }, { status: 200 });
      }
    } catch {
      return NextResponse.json({ reply: 'Invalid OLLAMA_BASE_URL in environment.' }, { status: 200 });
    }

    if (kb.length) {
      const facts = kb.slice(0, 40).map((k) => `- ${k.title}: ${k.answer}`).join('\n');
      messages.unshift({ role: 'system', content: `Knowledge base (${companyName}):\n${facts}` });
    }

    try {
      const upstream = await fetch(`${ollamaBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: 512, temperature: 0.6 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!upstream.ok) {
        return NextResponse.json({ 
          reply: generateFallbackResponse(messages, kb, 'Ollama') + '\n\n*(Ollama returned an error — is the model loaded? Run: ollama pull ' + model + ')' 
        }, { status: 502 });
      }
      const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
      return NextResponse.json({ reply: data.choices?.[0]?.message?.content?.trim() ?? 'Borga received no answer.' }, { status: 200 });
    } catch (error) {
      console.error('Ollama connection error:', error);
      // Ollama not running → graceful fallback
      return NextResponse.json({
        reply: generateFallbackResponse(messages, kb, 'Ollama') + '\n\n*(Ollama is not running locally. Start it with: ollama serve)*',
        error: 'OLLAMA_UNREACHABLE'
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
      const facts = kb.slice(0, 40).map((k) => `- ${k.title}: ${k.answer}`).join('\n');
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
  if (!apiKey) {
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
    const facts = kb.slice(0, 40).map((k) => `- ${k.title}: ${k.answer}`).join('\n');
      messages.unshift({ role: 'system', content: `Knowledge base (${companyName}):\n${facts}` });
  }

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 512, temperature: 0.6 }),
      signal: AbortSignal.timeout(45000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      console.error('LLM upstream error', upstream.status, text.slice(0, 300));
      return NextResponse.json(
        { reply: `The ${providerId.replace('llm-', '')} model returned an error (${upstream.status}). Check your API key and quota.` },
        { status: 200 },
      );
    }

    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
    const reply = data.choices?.[0]?.message?.content?.trim();
    return NextResponse.json({ reply: reply ?? 'Borga received no answer.' }, { status: 200 });
  } catch (err) {
    console.error('Borga chat error', err);
    return NextResponse.json(
      { reply: 'Borga had trouble reaching the model. Please try again shortly.' },
      { status: 200 },
    );
  }
}
