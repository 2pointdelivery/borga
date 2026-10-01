import { NextResponse } from 'next/server';
import { getApiKey } from '@/lib/borga/secrets';
import { featureGate } from '@/lib/borga/features-server';

export const runtime = 'nodejs';

/**
 * Tier 3 ears seam: "give me audio, get back text".
 * Forwards to Deepgram when DEEPGRAM_API_KEY is configured (server-side only,
 * never in code or the client). Without a key it answers 501 STT_NOT_CONFIGURED
 * so the client falls back to browser SpeechRecognition — voice keeps working.
 */
export async function POST(req: Request) {
  const off = await featureGate('voice', null, null);
  if (off) return off;
  const apiKey = await getApiKey('DEEPGRAM_API_KEY');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'STT_NOT_CONFIGURED', message: 'Deepgram is not configured. Falling back to browser recognition.' },
      { status: 501 },
    );
  }

  let audio: ArrayBuffer;
  let mime = 'audio/webm';
  try {
    const ctype = req.headers.get('content-type') ?? '';
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('audio');
      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: 'audio field is required.' }, { status: 400 });
      }
      audio = await file.arrayBuffer();
      mime = file.type || mime;
    } else {
      audio = await req.arrayBuffer();
      if (ctype) mime = ctype.split(';')[0].trim() || mime;
    }
  } catch {
    return NextResponse.json({ error: 'Invalid audio body.' }, { status: 400 });
  }
  if (!audio.byteLength) {
    return NextResponse.json({ error: 'Empty audio.' }, { status: 400 });
  }

  try {
    const upstream = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: { 'Content-Type': mime, Authorization: `Token ${apiKey}` },
      body: audio,
      signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      console.error('Deepgram STT error', upstream.status, t.slice(0, 200));
      return NextResponse.json({ error: `Deepgram error ${upstream.status}.` }, { status: 502 });
    }
    const data = (await upstream.json()) as {
      results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    };
    const transcript =
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
    return NextResponse.json({ transcript }, { status: 200 });
  } catch (err) {
    console.error('Deepgram unreachable', err);
    return NextResponse.json({ error: 'Transcription service unreachable.' }, { status: 503 });
  }
}
