import { NextResponse } from 'next/server';
import { getApiKey } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

const CLOUD_PROVIDERS = [
  { id: 'llm-nvidia', label: 'NVIDIA NIM', envKey: 'NVIDIA_API_KEY' },
  { id: 'llm-gemini', label: 'Gemini', envKey: 'GEMINI_API_KEY' },
  { id: 'llm-claude', label: 'Claude', envKey: 'ANTHROPIC_API_KEY' },
  { id: 'llm-openai', label: 'OpenAI', envKey: 'OPENAI_API_KEY' },
  { id: 'llm-openrouter', label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY' },
  { id: 'llm-groq', label: 'Groq', envKey: 'GROQ_API_KEY' },
] as const;

async function probeOllama(): Promise<boolean> {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  // Strip /v1 suffix to get the base Ollama URL for the health check
  const ollamaRoot = base.replace(/\/v1\/?$/, '');
  try {
    const res = await fetch(`${ollamaRoot}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function isCustomConfigured(): boolean {
  const url = process.env.LLM_BASE_URL ?? '';
  const key = process.env.LLM_API_KEY ?? '';
  const badUrls = ['example', 'placeholder', ''];
  const badKeys = ['xxx', 'placeholder', 'your-key', ''];
  try {
    new URL(url);
    return !badUrls.includes(url.toLowerCase()) && !badKeys.includes(key.toLowerCase());
  } catch {
    return false;
  }
}

export async function GET() {
  const [cloudKeys, ollamaUp] = await Promise.all([
    Promise.all(CLOUD_PROVIDERS.map((p) => getApiKey(p.envKey).then((v) => ({ id: p.id, label: p.label, configured: !!v })))),
    probeOllama(),
  ]);

  const providers = [
    { id: 'llm-demo', label: 'Demo (no key)', configured: true },
    ...cloudKeys,
    { id: 'llm-ollama', label: 'Ollama (local)', configured: ollamaUp },
    { id: 'llm-custom', label: 'Custom endpoint', configured: isCustomConfigured() },
  ];

  return NextResponse.json({ providers });
}
