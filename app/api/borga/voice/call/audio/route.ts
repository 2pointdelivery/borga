import { NextResponse } from 'next/server';
import { getBorgaState } from '@/lib/borga/persistence';
import { getApiKey, verifyPayloadSignature } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

/**
 * Streams the real ElevenLabs audio for a specific outbound call — fetched
 * by Twilio's <Play> verb (../twiml), so it must work without our session
 * cookie. Authenticated by the signed `id` instead (see secrets.ts), and the
 * message text itself never appears in a URL, only server-side storage.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const sig = url.searchParams.get('sig') ?? '';

  if (!id || !sig || !verifyPayloadSignature(id, sig)) {
    return NextResponse.json({ error: 'Invalid or expired call audio link.' }, { status: 403 });
  }
  const payload = await getBorgaState<{ message: string; voiceId: string }>(`voice_call_payload:${id}`);
  if (!payload) {
    return NextResponse.json({ error: 'Call audio not found — it may have already been played.' }, { status: 404 });
  }

  const apiKey = await getApiKey('ELEVENLABS_API_KEY');
  if (!apiKey) {
    return NextResponse.json({ error: 'ElevenLabs is not configured.' }, { status: 501 });
  }

  try {
    const upstream = await fetch(
      `${ELEVENLABS_BASE}/text-to-speech/${payload.voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
        body: JSON.stringify({ text: payload.message, model_id: 'eleven_multilingual_v2' }),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('ElevenLabs call-audio error', upstream.status, errText.slice(0, 200));
      return NextResponse.json({ error: `ElevenLabs API error: ${upstream.status}` }, { status: 502 });
    }
    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        // No caching — this URL is single-use-ish and tied to one call.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('ElevenLabs connection error:', err);
    return NextResponse.json({ error: 'ElevenLabs service unreachable.' }, { status: 503 });
  }
}
