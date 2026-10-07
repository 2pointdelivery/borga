import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId } from '@/lib/borga/keys';
import { paymentRequired } from '@/lib/borga/billing-server';
import { deepgramKey } from '@/lib/borga/provider-keys';
import { featureGate } from '@/lib/borga/features-server';

export const runtime = 'nodejs';

// Audio is billed per second on the owner's Deepgram key, so this route takes
// the dashboard session (like every other /api/borga route) instead of being
// callable anonymously. Bodies are capped well above any voice command.
const MAX_AUDIO_BYTES = 15_000_000;

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  const uid = await verifySessionToken(token);
  return uid && isValidUserId(uid) ? uid : null;
}

/**
 * Tier 3 ears seam: "give me audio, get back text".
 * Forwards to Deepgram when DEEPGRAM_API_KEY is configured (server-side only,
 * never in code or the client). Without a key it answers 501 STT_NOT_CONFIGURED
 * so the client falls back to browser SpeechRecognition — voice keeps working.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const off = await featureGate('voice', null, null);
  if (off) return off;
  if (Number(req.headers.get('content-length') ?? 0) > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio too large (15 MB max).' }, { status: 413 });
  }
  const wsParam = req.nextUrl.searchParams.get('ws');
  const sttWs = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  if (sttWs) {
    const unpaid = await paymentRequired(userId, sttWs);
    if (unpaid) return NextResponse.json({ error: unpaid.error }, { status: 402 });
  }
  const apiKey = await deepgramKey(userId, sttWs);
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
  if (audio.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'Audio too large (15 MB max).' }, { status: 413 });
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
