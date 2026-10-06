import 'server-only';
import { getBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { getApiKey, realEnv } from './secrets';
import { presetFor } from './model-catalog';

// Providers whose base URL the user may set in the dashboard (stored in the secret store), not only in process.env.
const URL_KEY: Record<string, string> = { 'llm-custom': 'LLM_BASE_URL', 'llm-muse': 'MUSE_BASE_URL' };

export interface ProviderConfig {
  baseUrl: string;
  /** Env var (server-side) holding the API key — never exposed to the client. */
  envVar: string;
  /** For providers that need no account but still expect some bearer value (LLM7 accepts a placeholder). */
  anonymousKey?: string;
}

/**
 * Authoritative fallback map. Used when a workspace has not overridden a
 * provider in its DB-backed `llmCatalog`. Mirrors the seed in `lib/borga/data`.
 */
export const DEFAULT_PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  'llm-muse': { baseUrl: realEnv('MUSE_BASE_URL') || '', envVar: '' },
  'llm-groq': { baseUrl: 'https://api.groq.com/openai/v1', envVar: 'GROQ_API_KEY' },
  'llm-gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', envVar: 'GEMINI_API_KEY' },
  'llm-claude': { baseUrl: 'https://api.anthropic.com/v1', envVar: 'ANTHROPIC_API_KEY' },
  'llm-openai': { baseUrl: 'https://api.openai.com/v1', envVar: 'OPENAI_API_KEY' },
  'llm-openrouter': { baseUrl: 'https://openrouter.ai/api/v1', envVar: 'OPENROUTER_API_KEY' },
  'llm-cerebras': { baseUrl: 'https://api.cerebras.ai/v1', envVar: 'CEREBRAS_API_KEY' },
  'llm-sambanova': { baseUrl: 'https://api.sambanova.ai/v1', envVar: 'SAMBANOVA_API_KEY' },
  'llm-mistral': { baseUrl: 'https://api.mistral.ai/v1', envVar: 'MISTRAL_API_KEY' },
  'llm-nvidia': { baseUrl: realEnv('NVIDIA_BASE_URL') || 'https://integrate.api.nvidia.com/v1', envVar: 'NVIDIA_API_KEY' },
  'llm-custom': { baseUrl: realEnv('LLM_BASE_URL'), envVar: 'LLM_API_KEY' },
  // No account and no key: community-run free services (verified to answer chat completions anonymously).
  'llm-pollinations': { baseUrl: 'https://text.pollinations.ai/openai', envVar: '' },
  'llm-llm7': { baseUrl: 'https://api.llm7.io/v1', envVar: '', anonymousKey: 'unused' },
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
  // Keyless providers never inherit another provider's key requirement through a catalog entry.
  const keyless = !!presetFor(providerId)?.keyless;
  try {
    if (ws) {
      const catalog = await getBorgaState<CatalogProviderLike[]>(userId ? userWsKey(userId, ws, 'llmCatalog') : scopedKey(ws, 'llmCatalog'));
      const entry = catalog?.find((p) => p.id === providerId);
      if (entry) {
        return {
          // A URL saved on the provider card (custom endpoint / Muse) wins: the seeded catalog entry would otherwise shadow it.
          baseUrl: savedUrl || fixGeminiUrl(providerId, entry.baseUrl && entry.baseUrl.length > 0 ? entry.baseUrl : fallback.baseUrl),
          envVar: keyless ? '' : entry.envVar && entry.envVar.length > 0 ? entry.envVar : fallback.envVar,
          anonymousKey: fallback.anonymousKey,
        };
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return fallback;
}

/**
 * The key to send for a provider: the saved/env key, or for a keyless provider its anonymous placeholder (or nothing).
 * Every caller (chat, agents, Test, model loading) goes through this so keyless providers behave the same everywhere.
 */
export async function resolveApiKey(cfg: ProviderConfig): Promise<string> {
  if (cfg.envVar) return getApiKey(cfg.envVar);
  return cfg.anonymousKey ?? '';
}
