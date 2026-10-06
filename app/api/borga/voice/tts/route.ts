import { NextResponse, NextRequest } from 'next/server';
import { paymentRequired } from '@/lib/borga/billing-server';
import { elevenLabsKey } from '@/lib/borga/provider-keys';
import { featureGate, sessionUserId } from '@/lib/borga/features-server';

export const runtime = 'nodejs';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const off = await featureGate('voice', null, null);
  if (off) return off;
  let text = '';
  let voiceId = DEFAULT_VOICE_ID;
  let ws: string | null = null;
  try {
    const body = (await req.json()) as { text?: string; voiceId?: string; ws?: string };
    text = (body.text ?? '').trim();
    voiceId = (body.voiceId ?? '').trim() || DEFAULT_VOICE_ID;
    ws = typeof body.ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.ws) ? body.ws : null;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 });
  }
  // The voice id goes into the upstream URL path, so it must be a plain id (no "../" or query), and the text is capped (it is billed per character).
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) {
    return NextResponse.json({ error: 'Invalid voice id.' }, { status: 400 });
  }
  text = text.slice(0, 2500);

  if (ws) {
    const unpaid = await paymentRequired(userId, ws);
    if (unpaid) return NextResponse.json({ error: unpaid.error }, { status: 402 });
  }
  const apiKey = await elevenLabsKey(userId, ws);
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS not configured' }, { status: 501 });
  }

  try {
    const upstream = await fetch(
      `${ELEVENLABS_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('ElevenLabs TTS error', upstream.status, errText.slice(0, 200));
      return NextResponse.json(
        { error: `ElevenLabs API error: ${upstream.status}. ${errText.slice(0, 100)}` },
        { status: 502 },
      );
    }

    const audio = await upstream.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('ElevenLabs connection error:', err);
    return NextResponse.json(
      { error: 'ElevenLabs service unreachable.' },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest) {
  const off = await featureGate('voice', null, null);
  if (off) return off;
  const url = new URL(req.url);
  const text = (url.searchParams.get('text') ?? '').trim();
  const voiceId = (url.searchParams.get('voiceId') ?? '').trim() || DEFAULT_VOICE_ID;
  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');
  headers.delete('content-length');
  const fakeReq = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, voiceId }),
  });
  return POST(fakeReq);
}
