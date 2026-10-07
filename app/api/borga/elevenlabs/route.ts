import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId } from '@/lib/borga/keys';
import { elevenLabsKey } from '@/lib/borga/provider-keys';
import { featureGate } from '@/lib/borga/features-server';
import { LEGACY_VOICE_IDS, resolveVoiceRef } from '@/lib/borga/voice-ids';

export const runtime = 'nodejs';

// TTS is billed on the owner's ElevenLabs key, so this route takes the
// dashboard session instead of being callable anonymously.
async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  const uid = await verifySessionToken(token);
  return uid && isValidUserId(uid) ? uid : null;
}

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

const VOICE_IDS = LEGACY_VOICE_IDS;

function resolveVoiceId(voiceName: string): string {
  return resolveVoiceRef(voiceName) ?? LEGACY_VOICE_IDS.rachel;
}

// Generate a realistic call script that the agent would say during the call
function generateCallScript(params: { agentName: string; contact: string; leadName: string; note?: string; companyName?: string }): string {
  const { agentName, leadName, note, companyName = 'the company' } = params;
  return [
    `Hello, this is ${agentName} calling from ${companyName}.`,
    `I'm reaching out to ${leadName} regarding a potential partnership opportunity.`,
    note ? `Specifically, ${note}` : `We would love to discuss how ${companyName}'s solutions can help your business grow.`,
    'Please feel free to call us back or reply to our email. Have a wonderful day.',
  ].join(' ');
}

// Validate ElevenLabs API key format
function isValidApiKey(key: string): boolean {
  return typeof key === 'string' && key.trim().length >= 20;
}

// Fetch available voices from ElevenLabs API
async function fetchAvailableVoices(apiKey: string): Promise<Record<string, string>> {
  try {
    const response = await fetch(`${ELEVENLABS_BASE}/voices`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      console.warn('Failed to fetch voices from ElevenLabs, using defaults');
      return VOICE_IDS;
    }
    
    const data = await response.json();
    const voices: Record<string, string> = {};
    
    if (data.voices && Array.isArray(data.voices)) {
      data.voices.forEach((voice: any) => {
        if (voice.voice_id && voice.name) {
          voices[voice.name.toLowerCase()] = voice.voice_id;
        }
      });
    }
    
    return { ...VOICE_IDS, ...voices };
  } catch (error) {
    console.warn('Error fetching ElevenLabs voices:', error);
    return VOICE_IDS;
  }
}

export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const off = await featureGate('voice', null, null);
  if (off) return off;
  let body: {
    text?: string;
    voice?: string;
    agentName?: string;
    contact?: string;
    leadName?: string;
    note?: string;
    companyName?: string;
    action?: string;
    ws?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const action = body.action ?? 'tts';
  const voice = body.voice ?? 'rachel';
  const companyName = (body.companyName ?? 'the company').slice(0, 80);
  const wsForKey = typeof body.ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.ws) ? body.ws : null;
  const apiKey = await elevenLabsKey(userId, wsForKey);

  if (action === 'script') {
    // Generate a call script without audio (works without API key)
    const script = generateCallScript({
      agentName: body.agentName ?? 'Borga',
      contact: body.contact ?? '',
      leadName: body.leadName ?? body.contact ?? 'there',
      note: body.note,
      companyName,
    });
    return NextResponse.json({ ok: true, action: 'script', script });
  }

  if (action === 'voices') {
    // Return available voices
    if (!apiKey || !isValidApiKey(apiKey)) {
      return NextResponse.json({ 
        ok: false, 
        error: 'Valid ElevenLabs API key required to fetch voices.',
        voices: VOICE_IDS 
      }, { status: 400 });
    }
    
    const voices = await fetchAvailableVoices(apiKey);
    return NextResponse.json({ ok: true, action: 'voices', voices });
  }

  if (action === 'tts') {
    const text = body.text ?? generateCallScript({
      agentName: body.agentName ?? 'Borga',
      contact: body.contact ?? '',
      leadName: body.leadName ?? 'there',
      note: body.note,
      companyName,
    });
    if (!apiKey || !isValidApiKey(apiKey)) {
      return NextResponse.json({
        ok: false,
        action: 'tts',
        error: 'Valid ElevenLabs API key required for text-to-speech. Configure ELEVENLABS_API_KEY in your environment.',
        script: text,
      }, { status: 400 });
    }

    const voiceId = resolveVoiceId(voice);
    if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) {
      return NextResponse.json({ ok: false, action: 'tts', error: 'Invalid voice id.' }, { status: 400 });
    }

    try {
      const upstream = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '');
        console.error('ElevenLabs TTS error', upstream.status, errText.slice(0, 200));
        
        // Handle specific error cases
        if (upstream.status === 401) {
          return NextResponse.json({
            ok: false,
            action: 'tts',
            error: 'Invalid ElevenLabs API key. Please check your credentials.',
            script: text,
          }, { status: 401 });
        }
        
        if (upstream.status === 429) {
          return NextResponse.json({
            ok: false,
            action: 'tts',
            error: 'ElevenLabs quota exceeded. Please check your usage limits.',
            script: text,
          }, { status: 429 });
        }
        
        return NextResponse.json({
          ok: false,
          action: 'tts',
          error: `ElevenLabs API error: ${upstream.status}. ${errText.slice(0, 100)}`,
          script: text,
        }, { status: 502 });
      }

      // Return audio as base64 so client can play it
      const audioBuffer = await upstream.arrayBuffer();
      const base64 = Buffer.from(audioBuffer).toString('base64');
      
      // Detect MIME type from response headers
      const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg';
      
      return NextResponse.json({ 
        ok: true, 
        action: 'tts', 
        mode: 'elevenlabs', 
        audio: base64, 
        mimeType: contentType, 
        script: text,
        voiceId: voiceId 
      });
    } catch (err) {
      console.error('ElevenLabs connection error:', err);
      return NextResponse.json({
        ok: false,
        action: 'tts',
        error: 'ElevenLabs service unreachable. Please check your network connection and API status.',
        script: text,
      }, { status: 503 });
    }
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
