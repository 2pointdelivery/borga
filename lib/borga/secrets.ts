import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { getBorgaState, setBorgaState } from './persistence';

// Allowlist of env vars that can be set via the UI config API.
// Deliberately excludes infrastructure vars like DATABASE_URL, BORGA_SECRET_KEY.
export const CONFIGURABLE_KEYS = [
  { envVar: 'GROQ_API_KEY', label: 'Groq', hint: 'console.groq.com — free tier', kind: 'key' as const },
  { envVar: 'NVIDIA_API_KEY', label: 'NVIDIA NIM', hint: 'build.nvidia.com', kind: 'key' as const },
  { envVar: 'GEMINI_API_KEY', label: 'Google Gemini', hint: 'aistudio.google.com/apikey', kind: 'key' as const },
  { envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic Claude', hint: 'console.anthropic.com', kind: 'key' as const },
  { envVar: 'OPENAI_API_KEY', label: 'OpenAI', hint: 'platform.openai.com/api-keys', kind: 'key' as const },
  { envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter', hint: 'openrouter.ai/keys', kind: 'key' as const },
  { envVar: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', hint: 'elevenlabs.io/app/api-key', kind: 'key' as const },
  { envVar: 'DEEPGRAM_API_KEY', label: 'Deepgram', hint: 'console.deepgram.com — speech-to-text for push-to-talk', kind: 'key' as const },
  { envVar: 'COMPOSIO_API_KEY', label: 'Composio', hint: 'composio.dev — API key for toolkits', kind: 'key' as const },
  { envVar: 'WIGOLO_BASE_URL', label: 'Wigolo web research', hint: 'default: http://127.0.0.1:3333 — run "npx wigolo serve"', kind: 'url' as const },
  { envVar: 'WIGOLO_API_TOKEN', label: 'Wigolo API token', hint: 'only needed if wigolo is bound past loopback', kind: 'key' as const },
  { envVar: 'WHATSAPP_ACCESS_TOKEN', label: 'WhatsApp', hint: 'Meta Business API — Access token', kind: 'key' as const },
  { envVar: 'TWILIO_ACCOUNT_SID', label: 'Twilio Account SID', hint: 'console.twilio.com — required for real outbound calls', kind: 'key' as const },
  { envVar: 'TWILIO_AUTH_TOKEN', label: 'Twilio Auth Token', hint: 'console.twilio.com — required for real outbound calls', kind: 'key' as const },
  { envVar: 'TWILIO_FROM_PHONE', label: 'Twilio From Number', hint: 'E.164 format, e.g. +14155550100 — your Twilio caller ID', kind: 'url' as const },
  { envVar: 'BORGA_ADMIN_TOKEN', label: 'Borga Engine', hint: 'Authentication token for orchestration engine', kind: 'key' as const },
  { envVar: 'COMPANY_ENGINE_API_KEY', label: 'Company Engine (deployment key)', hint: 'Optional fallback key for the company API; each company can save its own under AI Platform → Company Engine', kind: 'key' as const },
  { envVar: 'LLM_BASE_URL', label: 'Custom LLM base URL', hint: 'e.g. http://localhost:8000/v1', kind: 'url' as const },
  { envVar: 'LLM_API_KEY', label: 'Custom LLM API key', hint: 'Bearer token for custom endpoint', kind: 'key' as const },
  { envVar: 'OLLAMA_BASE_URL', label: 'Ollama base URL', hint: 'default: http://127.0.0.1:11434/v1', kind: 'url' as const },
  { envVar: 'SUPERMEMORY_API_KEY', label: 'Supermemory (deployment key)', hint: 'console.supermemory.ai/keys. Optional; a workspace can also save its own under Connections', kind: 'key' as const },
  { envVar: 'SMTP_HOST', label: 'SMTP Host', hint: 'e.g. smtp.gmail.com or smtp.sendgrid.net', kind: 'url' as const },
  { envVar: 'SMTP_PORT', label: 'SMTP Port', hint: '587 (STARTTLS) or 465 (SSL)', kind: 'key' as const },
  { envVar: 'SMTP_USER', label: 'SMTP Username', hint: 'Account / API user', kind: 'key' as const },
  { envVar: 'SMTP_PASS', label: 'SMTP Password', hint: 'App password or API key', kind: 'key' as const },
  { envVar: 'SMTP_SECURE', label: 'SMTP Secure', hint: 'Set "true" for port 465 (SSL)', kind: 'key' as const },
  { envVar: 'EMAIL_FROM', label: 'From Address', hint: 'e.g. Borga <noreply@yourdomain.com>', kind: 'url' as const },
] as const;

export type ConfigurableEnvVar = typeof CONFIGURABLE_KEYS[number]['envVar'];

const ALLOWED_SET = new Set<string>(CONFIGURABLE_KEYS.map((k) => k.envVar));

export function isAllowedKey(envVar: string): envVar is ConfigurableEnvVar {
  return ALLOWED_SET.has(envVar);
}

// AES-256-GCM encryption. Key derived from BORGA_SECRET_KEY (64-char hex),
// or falls back to a SHA-256 of DATABASE_URL so no extra config is required.
function encKey(): Buffer {
  const raw = process.env.BORGA_SECRET_KEY ?? '';
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  // A key derived from DATABASE_URL is guessable by anyone who has the URL; development only.
  if (process.env.NODE_ENV === 'production') throw new Error('BORGA_SECRET_KEY (64 hex characters) must be set in production');
  const seed = process.env.DATABASE_URL ?? 'borga-secrets-please-set-BORGA_SECRET_KEY-in-env';
  return createHash('sha256').update(seed).digest();
}

/**
 * Signs an opaque server-generated id so a webhook callback (e.g. Twilio
 * fetching call audio) can prove it's carrying a URL we actually issued,
 * without needing our own session cookie — which a third-party webhook
 * caller can never present. Never sign attacker-supplied free text; only
 * sign ids we generated ourselves and can look up server-side.
 */
export function signPayloadId(id: string): string {
  return createHmac('sha256', encKey()).update(id).digest('hex');
}

export function verifyPayloadSignature(id: string, sig: string): boolean {
  const expected = signPayloadId(id);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: 12B iv | 16B tag | N bytes ciphertext → base64
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(ciphertext: string): string {
  try {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', encKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function maskValue(val: string, kind: 'key' | 'url'): string {
  if (kind === 'url') {
    // Show full URL for non-sensitive config
    return val.length > 60 ? val.slice(0, 57) + '…' : val;
  }
  if (val.length <= 8) return '****';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

// ---

type SecretStore = Record<string, string>; // envVar → encrypted base64

async function loadStore(): Promise<SecretStore> {
  return (await getBorgaState<SecretStore>('api_secrets')) ?? {};
}

async function saveStore(store: SecretStore): Promise<boolean> {
  return setBorgaState('api_secrets', store);
}

/** Template values from .env.example ("example", "xxx", "your-...") must not shadow a value saved in the dashboard. */
const PLACEHOLDERS = new Set(['example', 'xxx', 'placeholder', 'changeme', 'change-me', 'none', 'null']);
export function realEnv(envVar: string): string {
  const v = (process.env[envVar] ?? '').trim();
  return !v || PLACEHOLDERS.has(v.toLowerCase()) || /^your[-_ ]/i.test(v) ? '' : v;
}

/** Resolve an API key: a real process.env value takes precedence over the DB. */
export async function getApiKey(envVar: string): Promise<string> {
  const fromEnv = realEnv(envVar);
  if (fromEnv) return fromEnv;
  try {
    const store = await loadStore();
    const enc = store[envVar];
    return enc ? decryptSecret(enc) : '';
  } catch {
    return '';
  }
}

export type KeyStatus = {
  envVar: string;
  label: string;
  hint: string;
  kind: 'key' | 'url';
  configured: boolean;
  source: 'env' | 'db' | 'none';
  masked: string | null;
};

/** Get status of all configurable keys (masked values, sources). */
export async function listKeyStatuses(): Promise<KeyStatus[]> {
  const store = await loadStore();
  return CONFIGURABLE_KEYS.map((cfg) => {
    const fromEnv = realEnv(cfg.envVar);
    if (fromEnv) {
      return { ...cfg, configured: true, source: 'env' as const, masked: maskValue(fromEnv, cfg.kind) };
    }
    const enc = store[cfg.envVar];
    if (enc) {
      const val = decryptSecret(enc);
      return { ...cfg, configured: !!val, source: 'db' as const, masked: val ? maskValue(val, cfg.kind) : null };
    }
    return { ...cfg, configured: false, source: 'none' as const, masked: null };
  });
}

/** Persist a key to the DB (encrypted). */
export async function setApiKey(envVar: string, value: string): Promise<boolean> {
  if (!isAllowedKey(envVar)) return false;
  const store = await loadStore();
  store[envVar] = encryptSecret(value);
  return saveStore(store);
}

/** Remove a DB-stored key. Has no effect on .env values. */
export async function deleteApiKey(envVar: string): Promise<boolean> {
  if (!isAllowedKey(envVar)) return false;
  const store = await loadStore();
  delete store[envVar];
  return saveStore(store);
}
