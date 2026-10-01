import { NextResponse, type NextRequest } from 'next/server';
import { getApiKey } from '@/lib/borga/secrets';
import { DEFAULT_PROVIDER_CONFIG, resolveProviderConfig } from '@/lib/borga/llm-providers';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';

export const runtime = 'nodejs';

const PLACEHOLDER_URLS = ['example', 'placeholder', ''];
const PLACEHOLDER_KEYS = ['xxx', 'placeholder', 'your-key', ''];

async function ollamaUp(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Which providers can actually be called right now. Honours keys saved in the dashboard
 * (not just process.env) and the workspace's own catalog overrides when ?ws= is given.
 * Custom endpoint: URL and key both come from the secret store, with a base URL override.
 */
export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  const wsParam = new URL(req.url).searchParams.get('ws');
  const ws = userId && isValidWsId(wsParam) ? wsParam : null;

  const providers = await Promise.all(
    Object.keys(DEFAULT_PROVIDER_CONFIG).map(async (id) => {
      if (id === 'llm-demo') return { id, configured: true };
      const cfg = await resolveProviderConfig(id, ws, userId);
      if (id === 'llm-ollama') {
        const base = (await getApiKey('OLLAMA_BASE_URL')) || cfg.baseUrl;
        return { id, configured: await ollamaUp(base) };
      }
      if (id === 'llm-custom') {
        const url = (await getApiKey('LLM_BASE_URL')) || cfg.baseUrl;
        const key = cfg.envVar ? await getApiKey(cfg.envVar) : '';
        let valid = false;
        try {
          new URL(url);
          valid = !PLACEHOLDER_URLS.includes(url.toLowerCase());
        } catch {
          valid = false;
        }
        return { id, configured: valid && !PLACEHOLDER_KEYS.includes(key.toLowerCase()) };
      }
      return { id, configured: !!cfg.baseUrl && (!cfg.envVar || !!(await getApiKey(cfg.envVar))) };
    }),
  );
  return NextResponse.json({ providers });
}
