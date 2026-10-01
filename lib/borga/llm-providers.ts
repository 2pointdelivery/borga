import 'server-only';
import { getBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { getApiKey, realEnv } from './secrets';

// Providers whose base URL the user may set in the dashboard (stored in the secret store), not only in process.env.
const URL_KEY: Record<string, string> = { 'llm-custom': 'LLM_BASE_URL', 'llm-ollama': 'OLLAMA_BASE_URL' };

export interface ProviderConfig {
  baseUrl: string;
  /** Env var (server-side) holding the API key — never exposed to the client. */
  envVar: string;
}

/**
 * Authoritative fallback map. Used when a workspace has not overridden a
 * provider in its DB-backed `llmCatalog`. Mirrors the seed in `lib/borga/data`.
 */
export const DEFAULT_PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  'llm-demo': { baseUrl: '', envVar: '' },
  'llm-groq': { baseUrl: 'https://api.groq.com/openai/v1', envVar: 'GROQ_API_KEY' },
  'llm-ollama': { baseUrl: realEnv('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434/v1', envVar: '' },
  'llm-gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', envVar: 'GEMINI_API_KEY' },
  'llm-claude': { baseUrl: 'https://api.anthropic.com/v1', envVar: 'ANTHROPIC_API_KEY' },
  'llm-openai': { baseUrl: 'https://api.openai.com/v1', envVar: 'OPENAI_API_KEY' },
  'llm-openrouter': { baseUrl: 'https://openrouter.ai/api/v1', envVar: 'OPENROUTER_API_KEY' },
  'llm-cerebras': { baseUrl: 'https://api.cerebras.ai/v1', envVar: 'CEREBRAS_API_KEY' },
  'llm-sambanova': { baseUrl: 'https://api.sambanova.ai/v1', envVar: 'SAMBANOVA_API_KEY' },
  'llm-mistral': { baseUrl: 'https://api.mistral.ai/v1', envVar: 'MISTRAL_API_KEY' },
  'llm-nvidia': { baseUrl: realEnv('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1', envVar: 'NVIDIA_API_KEY' },
  'llm-custom': { baseUrl: realEnv('LLM_BASE_URL'), envVar: 'LLM_API_KEY' },
};

/** Catalogs saved before the fix still carry the bare /v1beta URL, which answers 404 for chat completions. */
function fixGeminiUrl(providerId: string, url: string): string {
  return providerId === 'llm-gemini' && /\/v1beta\/?$/.test(url) ? url.replace(/\/?$/, '/openai') : url;
}

export interface CatalogProviderLike {
  id: string;
  baseUrl?: string;
  envVar?: string;
}

/**
 * Resolve a provider's base URL + API-key env var.
 *
 * Resolution order (so each company can fully customise without code changes):
 *   1. The workspace's DB-backed `llmCatalog` override (per-company dynamic).
 *   2. The server env default for that provider id.
 *   3. The global fallback map above.
 */
export async function resolveProviderConfig(
  providerId: string,
  ws?: string | null,
  userId?: string | null,
): Promise<ProviderConfig> {
  const base = DEFAULT_PROVIDER_CONFIG[providerId] ?? DEFAULT_PROVIDER_CONFIG['llm-nvidia'];
  // The default map is evaluated at import time from process.env; a URL saved in the dashboard must win over it.
  const savedUrl = URL_KEY[providerId] ? await getApiKey(URL_KEY[providerId]).catch(() => '') : '';
  const fallback: ProviderConfig = { ...base, baseUrl: savedUrl || base.baseUrl };
  try {
    if (ws) {
      const catalog = await getBorgaState<CatalogProviderLike[]>(userId ? userWsKey(userId, ws, 'llmCatalog') : scopedKey(ws, 'llmCatalog'));
      const entry = catalog?.find((p) => p.id === providerId);
      if (entry) {
        return {
          // A URL saved on the provider card (custom endpoint / Ollama) wins: the seeded catalog entry would otherwise shadow it.
          baseUrl: savedUrl || fixGeminiUrl(providerId, entry.baseUrl && entry.baseUrl.length > 0 ? entry.baseUrl : fallback.baseUrl),
          envVar: entry.envVar && entry.envVar.length > 0 ? entry.envVar : fallback.envVar,
        };
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return fallback;
}
