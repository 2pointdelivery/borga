/**
 * Voice identity, in one place. Pure (no I/O).
 *
 * A voice is stored as its real ElevenLabs voice id. Companies set up before that stored a first name instead ("george", "rachel"),
 * and three separate copies of the name-to-id table had drifted (two of them gave "george" the id of "arnold"). This is the one table;
 * everything that speaks goes through resolveVoiceRef().
 */

/** ElevenLabs' original premade voices by the first name they were stored under. */
export const LEGACY_VOICE_IDS: Record<string, string> = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  domi: 'AZnzlk1XvdvUeBnXmlld',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  antoni: 'ErXwobaYiN019PkySvjV',
  elli: 'MF3mGyEYCl7XYWbV9V6O',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  arnold: 'VR6AewLTigWG4xSOukaG',
  adam: 'pNInz6obpgDQGcFmaJgB',
  sam: 'yoZ06aMxZJJ28mfd3POQ',
  george: 'JBFqnCBsd6RMkjVDRZzb',
};

/** The shape of a real ElevenLabs voice id. */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9]{8,40}$/;

/** A stored voice (a real id, or a legacy first name) as the real voice id to send to ElevenLabs. Undefined when it is neither. */
export function resolveVoiceRef(ref: string | null | undefined): string | undefined {
  const v = (ref ?? '').trim();
  if (!v) return undefined;
  const legacy = LEGACY_VOICE_IDS[v.toLowerCase()];
  if (legacy) return legacy;
  return VOICE_ID_PATTERN.test(v) ? v : undefined;
}

export interface VoiceInfo {
  id: string;
  name: string;
  /** "premade", "cloned", "generated", "professional"... */
  category: string;
  gender?: string;
  accent?: string;
  age?: string;
  useCase?: string;
  description?: string;
  /** A short ElevenLabs-hosted sample, so a voice can be heard without spending characters. */
  previewUrl?: string;
}

/** The voices out of ElevenLabs' GET /v1/voices answer. Anything without a real id and a name is dropped. */
export function parseVoices(payload: unknown): VoiceInfo[] {
  const list = (payload as { voices?: unknown })?.voices;
  if (!Array.isArray(list)) return [];
  const out: VoiceInfo[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as { voice_id?: unknown; name?: unknown; category?: unknown; labels?: Record<string, unknown>; description?: unknown; preview_url?: unknown };
    const id = typeof v.voice_id === 'string' ? v.voice_id : '';
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    if (!VOICE_ID_PATTERN.test(id) || !name) continue;
    const label = (k: string) => (typeof v.labels?.[k] === 'string' ? (v.labels[k] as string) : undefined);
    out.push({
      id,
      name: name.slice(0, 60),
      category: typeof v.category === 'string' ? v.category : 'premade',
      gender: label('gender'),
      accent: label('accent'),
      age: label('age'),
      useCase: label('use_case') ?? label('usecase'),
      description: (typeof v.description === 'string' ? v.description : label('description'))?.slice(0, 160),
      previewUrl: typeof v.preview_url === 'string' && /^https:\/\//.test(v.preview_url) ? v.preview_url : undefined,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** "Warm, female, American" style one-liner for a picker. */
export function describeVoice(v: Pick<VoiceInfo, 'gender' | 'accent' | 'age' | 'useCase' | 'category'>): string {
  const bits = [v.gender, v.accent, v.age, v.useCase?.replace(/_/g, ' ')].filter(Boolean) as string[];
  return bits.length ? bits.join(', ') : v.category;
}

/** True when a stored voice is one the company's account actually has (by real id or by legacy name). */
export function voiceInList(ref: string | null | undefined, voices: Array<Pick<VoiceInfo, 'id'>>): boolean {
  const id = resolveVoiceRef(ref);
  return !!id && voices.some((v) => v.id === id);
}
