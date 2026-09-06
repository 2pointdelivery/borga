import { NextResponse } from 'next/server';
import { getApiKey } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

export async function POST(req: Request) {
  let text = '';
  let voiceId = DEFAULT_VOICE_ID;
  try {
    const body = (await req.json()) as { text?: string; voiceId?: string };
    text = (body.text ?? '').trim();
    voiceId = (body.voiceId ?? '').trim() || DEFAULT_VOICE_ID;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 });
  }

  const apiKey = await getApiKey('ELEVENLABS_API_KEY');
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = (url.searchParams.get('text') ?? '').trim();
  const voiceId = (url.searchParams.get('voiceId') ?? '').trim() || DEFAULT_VOICE_ID;
  const fakeReq = new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId }),
  });
  return POST(fakeReq);
}
