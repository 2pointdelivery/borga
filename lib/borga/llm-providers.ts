import 'server-only';
import { getBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';

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
  'llm-ollama': { baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1', envVar: '' },
  'llm-gemini': { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', envVar: 'GEMINI_API_KEY' },
  'llm-claude': { baseUrl: 'https://api.anthropic.com/v1', envVar: 'ANTHROPIC_API_KEY' },
  'llm-openai': { baseUrl: 'https://api.openai.com/v1', envVar: 'OPENAI_API_KEY' },
  'llm-openrouter': { baseUrl: 'https://openrouter.ai/api/v1', envVar: 'OPENROUTER_API_KEY' },
  'llm-nvidia': { baseUrl: process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1', envVar: 'NVIDIA_API_KEY' },
  'llm-custom': { baseUrl: process.env.LLM_BASE_URL ?? '', envVar: 'LLM_API_KEY' },
};

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
  const fallback = DEFAULT_PROVIDER_CONFIG[providerId] ?? DEFAULT_PROVIDER_CONFIG['llm-nvidia'];
  try {
    if (ws) {
      const catalog = await getBorgaState<CatalogProviderLike[]>(userId ? userWsKey(userId, ws, 'llmCatalog') : scopedKey(ws, 'llmCatalog'));
      const entry = catalog?.find((p) => p.id === providerId);
      if (entry) {
        return {
          baseUrl: entry.baseUrl && entry.baseUrl.length > 0 ? entry.baseUrl : fallback.baseUrl,
          envVar: entry.envVar && entry.envVar.length > 0 ? entry.envVar : fallback.envVar,
        };
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return fallback;
}
