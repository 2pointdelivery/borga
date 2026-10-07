import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { featureGate, sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { elevenLabsKey, fishCredentials } from '@/lib/borga/provider-keys';
import { getConnection } from '@/lib/borga/connections-server';
import { parseVoices, type VoiceInfo } from '@/lib/borga/voice-ids';

export const runtime = 'nodejs';

const cache = new Map<string, { at: number; voices: VoiceInfo[] }>();
const TTL_MS = 10 * 60_000;

/**
 * GET ?ws= -> whether this company can speak with ElevenLabs, and the voices its account really has.
 *
 * "Configured" means a key is available (the company's own, else the deployment's for an operator) and ElevenLabs accepted it. The
 * dashboard uses this, not a saved flag, to decide between the ElevenLabs voice and the browser's voice, so what the person sees is
 * what will actually happen.
 */
export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  const off = await featureGate('voice', userId, ws);
  if (off) return off;

  const fish = !!(await fishCredentials(userId, ws));
  const key = await elevenLabsKey(userId, ws);
  if (!key) return NextResponse.json({ ok: true, fish, configured: false, source: null, voices: [] });
  const source = (await getConnection(userId, ws, 'elevenlabs'))?.apiKey ? 'company' : 'shared';

  const ck = createHash('sha256').update(key).digest('hex');
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS && new URL(req.url).searchParams.get('refresh') !== '1') {
    return NextResponse.json({ ok: true, fish, configured: true, source, voices: hit.voices });
  }
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: true, fish, configured: false, keyInvalid: true, source, voices: [], error: 'ElevenLabs rejected the API key. Check it was copied in full.' });
    }
    if (!res.ok) return NextResponse.json({ ok: true, fish, configured: true, source, voices: hit?.voices ?? [], error: `ElevenLabs answered ${res.status}. Try again shortly.` });
    const voices = parseVoices(await res.json());
    cache.set(ck, { at: Date.now(), voices });
    return NextResponse.json({ ok: true, fish, configured: true, source, voices });
  } catch {
    return NextResponse.json({ ok: true, fish, configured: true, source, voices: hit?.voices ?? [], error: 'Could not reach ElevenLabs. Try again shortly.' });
  }
}
