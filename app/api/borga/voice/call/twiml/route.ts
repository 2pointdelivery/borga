import { NextResponse } from 'next/server';
import { getBorgaState } from '@/lib/borga/persistence';
import { verifyPayloadSignature } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * TwiML Twilio fetches once the outbound call connects (the `Url` param on
 * the Calls.json request in ../route.ts). No session cookie is available —
 * Twilio's own servers make this request — so this is authenticated instead
 * by the signed `id`, which only our own dial step could have produced.
 * Plays the real ElevenLabs audio via <Play> (../audio) instead of Twilio's
 * own <Say> voice, so the call sounds like the agent's configured voice.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const sig = url.searchParams.get('sig') ?? '';

  if (!id || !sig || !verifyPayloadSignature(id, sig)) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>', {
      status: 403,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
  const payload = await getBorgaState<{ message: string; voiceId: string }>(`voice_call_payload:${id}`);
  if (!payload) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>', {
      status: 404,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  const audioUrl = new URL('/api/borga/voice/call/audio', url.origin);
  audioUrl.searchParams.set('id', id);
  audioUrl.searchParams.set('sig', sig);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${xmlEscape(audioUrl.toString())}</Play></Response>`;
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } });
}

// Twilio can be configured to POST instead of GET when fetching the Url.
export async function POST(req: Request) {
  return GET(req);
}
