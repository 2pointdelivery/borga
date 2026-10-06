import 'server-only';
import { callLlm, resolveLlm, getConfiguredLlm } from './agent-context';

/**
 * Tier 1 unified brain — single entry point for every text turn.
 * Chat (/api/borga/chat), voice (Tier 3) and heartbeat (Tier 5) all call
 * through here so the provider stays behind one seam.
 *
 * Per AGENT.md: Borga, warm / plain-spoken / brief, Claude default, laptop-first.
 */

export interface BrainMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface BrainProvider {
  providerId: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export const BORGA_SYSTEM_PROMPT = `You are Borga, the orchestrator AI of an autonomous business command center. You are calm, concise and a little warm. You assist the user by delegating tasks to specialist agents, summarizing KPIs, and answering questions about their business.

When the user asks you to DO something (create a task, follow up, delegate), reply by echoing an actionable confirmation in plain language. Keep replies under ~90 words unless asked for detail. Respond conversationally in the language the user speaks.

The user is working inside one of their company workspaces; that company's knowledge base is provided when relevant. Use it to answer accurately about the company, its services and operations.`;

export async function resolveBrain(
  modelOverride?: string | null,
  ws?: string | null,
  userId?: string | null,
): Promise<BrainProvider | null> {
  if (modelOverride) return resolveLlm(modelOverride, ws, userId);
  return getConfiguredLlm(ws, userId);
}

/** Friendly, non-crashing failure text — never a stack trace to the user. */
export function brainUnavailableMessage(providerId?: string, detail?: string): string {
  if (!providerId) {
    return 'Borga has no AI provider connected. Add one in Integrations → AI & Voice for open-ended answers.';
  }
  const label = providerId.replace('llm-', '');
  // Free tiers (especially the no-account ones) throttle bursts with 429 or 402: say so, instead of a vague "trouble reaching".
  if (detail && /(402|429)/.test(detail)) {
    return `The ${label} service declined the request: you have hit its free-tier or rate limit. Wait a few seconds and try again, or pick another provider.`;
  }
  return `Borga had trouble reaching the ${label} model. Please try again shortly.`;
}

/**
 * Non-streaming turn. Never throws for transport/LLM errors — returns a
 * user-facing message instead so the loop always has a clean next prompt.
 */
export async function sendBrainTurn(
  messages: BrainMessage[],
  provider: BrainProvider | null,
): Promise<string> {
  if (!provider) return brainUnavailableMessage();
  try {
    const reply = await callLlm(messages, provider);
    return reply || 'Borga received no answer. Please try again.';
  } catch (e) {
    console.error('Brain turn failed', (e as Error).message);
    return brainUnavailableMessage(provider.providerId, (e as Error).message);
  }
}

/**
 * Streaming turn. Calls onToken per chunk; resolves to the full text.
 * Falls back to sendBrainTurn when the upstream refuses streaming.
 */
export async function streamBrainTurn(
  messages: BrainMessage[],
  provider: BrainProvider | null,
  onToken: (token: string) => void,
): Promise<string> {
  if (!provider) {
    const msg = brainUnavailableMessage();
    onToken(msg);
    return msg;
  }
  try {
    const streamed = await tryStream(provider, messages, onToken);
    if (streamed !== null) return streamed;
  } catch (e) {
    console.error('Brain stream failed, falling back', (e as Error).message);
  }
  const full = await sendBrainTurn(messages, provider);
  // sendBrainTurn already handled errors gracefully; emit once for SSE callers.
  onToken(full);
  return full;
}

async function tryStream(
  provider: BrainProvider,
  messages: BrainMessage[],
  onToken: (token: string) => void,
): Promise<string | null> {
  const { providerId, model, apiKey, baseUrl } = provider;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  let url = `${baseUrl}/chat/completions`;
  let body: Record<string, unknown> = { model, messages, max_tokens: 512, temperature: 0.6, stream: true };
  const extraHeaders: Record<string, string> = {};
  if (providerId === 'llm-claude') {
    url = `${baseUrl}/messages`;
    const system = messages.find((m) => m.role === 'system')?.content ?? BORGA_SYSTEM_PROMPT;
    const rest = messages.filter((m) => m.role !== 'system');
    body = { model, system, messages: rest, max_tokens: 512, stream: true };
    extraHeaders['anthropic-version'] = '2023-06-01';
    extraHeaders['x-api-key'] = apiKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok || !res.body) return null;
  const ctype = res.headers.get('content-type') ?? '';
  if (!ctype.includes('text/event-stream')) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let gotToken = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload) as Record<string, unknown>;
        const token =
          // OpenAI-compatible delta
          ((evt.choices as Array<{ delta?: { content?: string } }> | undefined)?.[0]?.delta?.content as string | undefined) ??
          // Claude delta
          ((evt.delta as { text?: string } | undefined)?.text as string | undefined) ??
          '';
        if (token) {
          gotToken = true;
          full += token;
          onToken(token);
        }
      } catch {
        // keep-alive / malformed chunk — ignore
      }
    }
  }
  return gotToken ? full.trim() : null;
}

/** Prepend KB facts + base system prompt to a raw history list. */
export function withSystemPrompt(
  history: BrainMessage[],
  kbFacts?: string,
  base: string = BORGA_SYSTEM_PROMPT,
): BrainMessage[] {
  const sys = kbFacts ? `${base}\n\nKnowledge base:\n${kbFacts}` : base;
  const rest = history.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: sys }, ...rest];
}
