import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getApiKey, signPayloadId } from '@/lib/borga/secrets';
import { setBorgaState } from '@/lib/borga/persistence';

export const runtime = 'nodejs';

const E164 = /^\+[1-9]\d{7,14}$/;
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

// Friendly voice names (as stored in ElevenLabsConfig.voice) → real ElevenLabs
// voice ids. Mirrors the maps in components/borga/use-voice.ts and
// app/api/borga/elevenlabs/route.ts.
const VOICE_NAME_TO_ID: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  antoni: 'ErXwobaYiN019PkySvjV',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  arnold: 'VR6AewLTigWG4xSOukaG',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  george: 'VR6AewLTigWG4xSOukaG',
};

function resolveVoiceId(nameOrId: string): string {
  return VOICE_NAME_TO_ID[nameOrId.toLowerCase()] ?? nameOrId ?? DEFAULT_VOICE_ID;
}

async function getTwilioCreds() {
  const sid = await getApiKey('TWILIO_ACCOUNT_SID');
  const token = await getApiKey('TWILIO_AUTH_TOKEN');
  const from = await getApiKey('TWILIO_FROM_PHONE');
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

function twilioAuth(sid: string, token: string): string {
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

export async function POST(req: Request) {
  let body: { action?: string; to?: string; message?: string; voiceId?: string; callSid?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const action = body.action ?? 'dial';
  const creds = await getTwilioCreds();

  // Real-time status poll for a call already dialed.
  if (action === 'status') {
    const callSid = (body.callSid ?? '').trim();
    if (!callSid) return NextResponse.json({ ok: false, error: 'callSid is required.' }, { status: 400 });
    if (!creds) return NextResponse.json({ ok: false, configured: false, error: 'Twilio is not configured.' });
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Calls/${callSid}.json`,
        { headers: { Authorization: twilioAuth(creds.sid, creds.token) }, signal: AbortSignal.timeout(15000) },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json({ ok: false, error: `Twilio error: ${res.status}. ${text.slice(0, 150)}` }, { status: 502 });
      }
      const data = (await res.json()) as { status?: string; duration?: string };
      return NextResponse.json({ ok: true, status: data.status ?? 'unknown', durationSec: Number(data.duration) || 0 });
    } catch (err) {
      console.error('Twilio status error:', err);
      return NextResponse.json({ ok: false, error: 'Twilio service unreachable.' }, { status: 503 });
    }
  }

  // action === 'dial' (default): place the real outbound call.
  const to = (body.to ?? '').trim();
  const message = (body.message ?? '').trim();

  if (!E164.test(to)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid phone number. Use E.164 format, e.g. +14155550142.' },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message is required.' }, { status: 400 });
  }

  if (!creds) {
    return NextResponse.json({
      ok: false,
      configured: false,
      message: 'Twilio is not configured — add Twilio Account SID, Auth Token and From Number in Integrations to place real outbound calls.',
    });
  }

  const origin = new URL(req.url).origin;
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return NextResponse.json({
      ok: false,
      configured: true,
      error: 'Twilio needs a publicly reachable URL to fetch call audio from, and this app is running on localhost. Deploy it (or tunnel it) before placing real calls.',
    });
  }

  const voiceId = resolveVoiceId((body.voiceId ?? '').trim());

  // Twilio fetches the TwiML (and then the audio) from a public URL with no
  // session cookie of ours. Rather than putting the message text in that URL
  // (leaks into server/proxy logs, and lets anyone who intercepts it request
  // arbitrary ElevenLabs synthesis on our bill), stash the payload server-side
  // under a random id and sign the id — the callback proves it's carrying a
  // URL we actually issued without needing to trust its contents.
  const callbackId = randomBytes(16).toString('hex');
  await setBorgaState(`voice_call_payload:${callbackId}`, { message, voiceId, createdAt: Date.now() });
  const sig = signPayloadId(callbackId);
  const twimlUrl = `${origin}/api/borga/voice/call/twiml?id=${callbackId}&sig=${sig}`;

  const params = new URLSearchParams();
  params.set('To', to);
  params.set('From', creds.from);
  params.set('Url', twimlUrl);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: twilioAuth(creds.sid, creds.token),
        },
        body: params.toString(),
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('Twilio call error', res.status, errText.slice(0, 200));
      return NextResponse.json(
        { ok: false, error: `Twilio error: ${res.status}. ${errText.slice(0, 100)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { sid?: string; status?: string };
    return NextResponse.json({ ok: true, callSid: data.sid, status: data.status ?? 'queued' });
  } catch (err) {
    console.error('Twilio connection error:', err);
    return NextResponse.json(
      { ok: false, error: 'Twilio service unreachable.' },
      { status: 503 },
    );
  }
}
