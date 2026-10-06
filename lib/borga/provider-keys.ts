import 'server-only';
import { getApiKey } from './secrets';
import { getConnection } from './connections-server';
import { getUserById } from '@/lib/auth/queries';
import { isOperator } from '@/lib/auth/signup-policy';

/**
 * Whose credentials a paid-per-use provider call is made with.
 *
 * Each company brings its own Twilio, ElevenLabs, Deepgram and Meta credentials (Integrations → Connections), and a call is made
 * with those. The deployment-wide keys (set by an operator) are a fallback for operators only, so one company cannot spend the
 * operator's credit; a deployment that wants to share them with every company says so with SHARED_PROVIDER_KEYS=allow.
 */

export async function sharedKeysAllowed(userId: string | null): Promise<boolean> {
  if ((process.env.SHARED_PROVIDER_KEYS ?? '').trim().toLowerCase() === 'allow') return true;
  if (!userId) return false;
  const user = await getUserById(userId).catch(() => null);
  return !!user && isOperator(user.email, process.env);
}

async function companyValues(userId: string | null, ws: string | null, id: 'twilio' | 'meta' | 'elevenlabs' | 'deepgram') {
  return userId && ws ? await getConnection(userId, ws, id) : null;
}

export async function elevenLabsKey(userId: string | null, ws: string | null): Promise<string> {
  const own = (await companyValues(userId, ws, 'elevenlabs'))?.apiKey;
  if (own) return own;
  return (await sharedKeysAllowed(userId)) ? getApiKey('ELEVENLABS_API_KEY') : '';
}

export async function deepgramKey(userId: string | null, ws: string | null): Promise<string> {
  const own = (await companyValues(userId, ws, 'deepgram'))?.apiKey;
  if (own) return own;
  return (await sharedKeysAllowed(userId)) ? getApiKey('DEEPGRAM_API_KEY') : '';
}

export async function twilioCredentials(userId: string | null, ws: string | null): Promise<{ sid: string; token: string; from: string } | null> {
  const own = await companyValues(userId, ws, 'twilio');
  if (own?.accountSid && own.authToken && own.phoneNumber) return { sid: own.accountSid, token: own.authToken, from: own.phoneNumber };
  if (!(await sharedKeysAllowed(userId))) return null;
  const sid = await getApiKey('TWILIO_ACCOUNT_SID');
  const token = await getApiKey('TWILIO_AUTH_TOKEN');
  const from = await getApiKey('TWILIO_FROM_PHONE');
  return sid && token && from ? { sid, token, from } : null;
}

export async function whatsappCredentials(userId: string | null, ws: string | null): Promise<{ accessToken: string; phoneNumberId: string; businessAccountId: string } | null> {
  const own = await companyValues(userId, ws, 'meta');
  if (own?.accessToken && own.whatsappPhoneNumberId) {
    return { accessToken: own.accessToken, phoneNumberId: own.whatsappPhoneNumberId, businessAccountId: own.whatsappBusinessAccountId ?? '' };
  }
  if (!(await sharedKeysAllowed(userId))) return null;
  const accessToken = await getApiKey('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  return accessToken && phoneNumberId ? { accessToken, phoneNumberId, businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '' } : null;
}
