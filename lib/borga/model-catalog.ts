import { RETIRED_LLM_PROVIDERS, type LlmModelInfo, type LlmModelTier, type LlmProvider } from './data';

/**
 * Free-tier LLM providers and the logic that turns a provider's live /models response into catalog entries.
 * Pure (no I/O) so it can be unit tested; the network call lives in app/api/borga/llm-models.
 *
 * The directory https://freellm.net/free-llm-api-keys lists providers that hand out free API keys. It has no
 * API of its own, so what we load are the models each of those providers reports for the user's own key.
 */

export const FREELLM_DIRECTORY_URL = 'https://freellm.net/free-llm-api-keys';

export interface FreeProviderPreset {
  id: string;
  label: string;
  /** Signup page. Absent for local tools that have no signup (e.g. a CLI you install). */
  signupUrl?: string;
  /**
   * all: every listed model can be used on the free tier (rate limited). priced: free ones are marked by price (OpenRouter).
   * credits: free starter credits. flagged: the provider marks which models need an account (LLM7 `usage_based_only`).
   */
  free: 'all' | 'priced' | 'credits' | 'flagged';
  /** The model list is public, so models can be loaded before a key is added (a key is still needed to use them, unless keyless). */
  keyOptional?: boolean;
  /** Works with no account and no API key at all, for the list and for chat. */
  keyless?: boolean;
  /** Runs on the user's own machine: listed from the local server, never through the public-URL guard. */
  local?: boolean;
  /** Shown on the card: what the user is trading for "free". */
  warning?: string;
  note: string;
}

const COMMUNITY_WARNING = 'Community-run free service with no account: your prompts go to a third party and it can change or go away. Do not send confidential company data.';

export const FREE_LLM_PROVIDERS: FreeProviderPreset[] = [
  { id: 'llm-pollinations', label: 'Pollinations', signupUrl: 'https://pollinations.ai', free: 'all', keyOptional: true, keyless: true, warning: COMMUNITY_WARNING, note: 'No key needed. Anonymous tier, rate limited' },
  { id: 'llm-llm7', label: 'LLM7', signupUrl: 'https://llm7.io', free: 'flagged', keyOptional: true, keyless: true, warning: COMMUNITY_WARNING, note: 'No key needed for the models marked free; the rest need an account' },
  { id: 'llm-muse', label: 'Muse', free: 'all', keyOptional: true, keyless: true, local: true, note: 'Runs on your own computer via the Muse CLI: free and private. Install it first: /bin/bash -c "$(curl -fsSL https://dev.meta.ai/cli/install-opencode.sh)"' },
  { id: 'llm-openrouter', label: 'OpenRouter', signupUrl: 'https://openrouter.ai/keys', free: 'priced', keyOptional: true, note: 'List is public; only models priced at zero (":free") are free. A free key is needed to chat' },
  { id: 'llm-nvidia', label: 'NVIDIA NIM', signupUrl: 'https://build.nvidia.com', free: 'credits', keyOptional: true, note: 'List is public; a free key with starter credits is needed to chat' },
  { id: 'llm-sambanova', label: 'SambaNova', signupUrl: 'https://cloud.sambanova.ai', free: 'all', keyOptional: true, note: 'List is public; a free key is needed to chat. Rate limited' },
  { id: 'llm-groq', label: 'Groq', signupUrl: 'https://console.groq.com/keys', free: 'all', note: 'Free tier, rate limited. The live list needs your free key' },
  { id: 'llm-gemini', label: 'Google Gemini', signupUrl: 'https://aistudio.google.com/apikey', free: 'all', note: 'Free tier in Google AI Studio. The live list needs your free key' },
  { id: 'llm-cerebras', label: 'Cerebras', signupUrl: 'https://cloud.cerebras.ai', free: 'all', note: 'Free tier, rate limited. The live list needs your free key' },
  { id: 'llm-mistral', label: 'Mistral', signupUrl: 'https://console.mistral.ai/api-keys', free: 'all', note: 'Free "Experiment" plan. The live list needs your free key' },
];

/**
 * Model search used by the dropdown: every typed word must appear in the model's name, id or tag (case-insensitive). A fuzzy
 * match lets unrelated ids through ("llama 70b" also matched "mistral-7b-instruct"). An empty query matches everything.
 */
export function matchesModelSearch(haystack: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = haystack.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const presetFor = (providerId: string): FreeProviderPreset | undefined => FREE_LLM_PROVIDERS.find((p) => p.id === providerId);

// Models that are not chat models (embeddings, speech, moderation, image generation) cannot drive an agent.
const NOT_CHAT = /(embed|whisper|tts|rerank|moderation|guard|dall-e|stable-diffusion|transcrib|speech|imagen|veo|\baqa\b|audio|orpheus)/i;

interface RawModel {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  context_length?: unknown;
  context_window?: unknown;
  max_model_len?: unknown;
  inputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown } | null;
  /** LLM7: chat, image, video, audio_to_text, ... */
  model_type?: unknown;
  /** LLM7: true when the model needs an account (credits), false when it works anonymously. */
  usage_based_only?: unknown;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function tagFor(id: string): string | undefined {
  const s = id.toLowerCase();
  if (/(^|[-/_:.])(r1|qwq)|reason|thinking|\bo[134]\b/.test(s)) return 'reasoning';
  if (/coder|code|codestral|devstral/.test(s)) return 'coding';
  if (/405b|120b|70b|72b|large|ultra|-pro\b|opus/.test(s)) return 'powerful';
  if (/flash|mini|nano|instant|lite|-8b|-7b|-3b|-1b|small|haiku/.test(s)) return 'fast';
  return undefined;
}

export interface ParsedModels {
  models: LlmModelInfo[];
  /** Models seen in the response. */
  total: number;
  /** Models dropped because they are not chat models, or (OpenRouter) not free. */
  skipped: number;
}

/**
 * Turns a provider's /models payload (OpenAI-style `{data:[...]}`, or Gemini's `{models:[...]}`) into catalog entries.
 * With freeOnly (the default) paid OpenRouter models are dropped; providers whose whole free tier is "everything listed"
 * keep every chat model.
 */
export function parseModelList(providerId: string, payload: unknown, opts: { freeOnly?: boolean } = {}): ParsedModels {
  const freeOnly = opts.freeOnly !== false;
  const preset = presetFor(providerId);
  const root = payload as { data?: unknown; models?: unknown } | unknown[] | null;
  const list: unknown[] = Array.isArray(root) ? root : Array.isArray(root?.data) ? (root.data as unknown[]) : Array.isArray(root?.models) ? (root.models as unknown[]) : [];

  const out = new Map<string, LlmModelInfo>();
  let skipped = 0;
  for (const item of list) {
    const m = (item && typeof item === 'object' ? item : {}) as RawModel;
    const rawId = typeof m.id === 'string' ? m.id : typeof m.name === 'string' ? m.name : '';
    const id = rawId.replace(/^models\//, '').trim();
    if (!id) continue;

    if (NOT_CHAT.test(id)) { skipped++; continue; }
    if (typeof m.model_type === 'string' && m.model_type !== 'chat') { skipped++; continue; }
    if (Array.isArray(m.supportedGenerationMethods) && !m.supportedGenerationMethods.includes('generateContent')) { skipped++; continue; }

    let tier: LlmModelTier;
    if (preset?.free === 'priced') {
      const priceKnown = m.pricing && m.pricing.prompt !== undefined && m.pricing.completion !== undefined;
      const free = id.endsWith(':free') || (priceKnown && num(m.pricing?.prompt) === 0 && num(m.pricing?.completion) === 0);
      tier = free ? 'free' : 'paid';
    } else if (preset?.free === 'flagged') {
      // LLM7: only models the provider itself marks as not usage-based work without an account.
      tier = m.usage_based_only === false ? 'free' : 'paid';
    } else {
      tier = preset?.free === 'credits' ? 'credits' : preset ? 'free' : 'paid';
    }
    if (freeOnly && tier === 'paid') { skipped++; continue; }

    const label = String((typeof m.display_name === 'string' && m.display_name) || (typeof m.displayName === 'string' && m.displayName) || (typeof m.name === 'string' && !m.name.startsWith('models/') && m.name) || id)
      .replace(/\s*\(free\)\s*$/i, '');
    // context_window is a number for most providers and { tokens } for LLM7
    const cw = m.context_window && typeof m.context_window === 'object' ? (m.context_window as { tokens?: unknown }).tokens : m.context_window;
    const ctx = num(m.context_length) ?? num(cw) ?? num(m.max_model_len) ?? num(m.inputTokenLimit);
    const info: LlmModelInfo = { id, label, tier };
    if (ctx && ctx >= 1000) info.contextK = Math.round(ctx / 1000);
    const tag = tagFor(id);
    if (tag) info.tag = tag;
    out.set(id, info);
  }

  const order: Record<string, number> = { free: 0, credits: 1, paid: 2 };
  const models = [...out.values()].sort((a, b) => (order[a.tier] ?? 3) - (order[b.tier] ?? 3) || a.label.localeCompare(b.label));
  return { models, total: list.length, skipped };
}

/**
 * Replaces a provider's free and credit models with the freshly loaded ones. Paid or hand-added models are kept, and so
 * are ids in `keep` (the model currently selected as the default), so a retired model never disappears from under a user.
 */
export function mergeLoadedModels(existing: LlmModelInfo[], loaded: LlmModelInfo[], keep: string[] = []): LlmModelInfo[] {
  const loadedIds = new Set(loaded.map((m) => m.id));
  const kept = existing.filter((m) => !loadedIds.has(m.id) && (m.tier === 'paid' || keep.includes(m.id)));
  return [...loaded, ...kept];
}

/**
 * Brings a stored (per-workspace) catalog up to date with the seed: drops
 * retired providers, adds providers that did not exist when the workspace
 * saved its catalog, and repairs the Gemini base URL (chat completions need
 * the /openai compatibility path).
 */
export function repairCatalog(stored: LlmProvider[], seed: LlmProvider[]): LlmProvider[] {
  const live = stored.filter((p) => !RETIRED_LLM_PROVIDERS.includes(p.id));
  const have = new Set(live.map((p) => p.id));
  const fixed = live.map((p) => (p.id === 'llm-gemini' && /\/v1beta\/?$/.test(p.baseUrl) ? { ...p, baseUrl: p.baseUrl.replace(/\/?$/, '/openai') } : p));
  const missing = seed.filter((p) => !have.has(p.id));
  if (!missing.length) return fixed;
  const customAt = fixed.findIndex((p) => p.id === 'llm-custom');
  return customAt >= 0 ? [...fixed.slice(0, customAt), ...missing, ...fixed.slice(customAt)] : [...fixed, ...missing];
}
