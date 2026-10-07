import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_VOICE_IDS, describeVoice, parseVoices, resolveVoiceRef, voiceInList } from './borga/voice-ids';

test('every first name has its own real id (George and Arnold used to share one)', () => {
  const ids = Object.values(LEGACY_VOICE_IDS);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(resolveVoiceRef('george'), resolveVoiceRef('arnold'));
  assert.equal(resolveVoiceRef('George'), 'JBFqnCBsd6RMkjVDRZzb');
});

test('a stored voice is a first name or a real id, and anything else is not sent to ElevenLabs', () => {
  assert.equal(resolveVoiceRef('21m00Tcm4TlvDq8ikWAM'), '21m00Tcm4TlvDq8ikWAM');
  assert.equal(resolveVoiceRef('../etc/passwd'), undefined);
  assert.equal(resolveVoiceRef('nobody'), undefined);
  assert.equal(resolveVoiceRef(''), undefined);
  assert.equal(resolveVoiceRef(undefined), undefined);
});

test('the voice list from ElevenLabs is parsed, sorted and stripped of anything unusable', () => {
  const voices = parseVoices({
    voices: [
      { voice_id: 'zzzzzzzzzz', name: 'Zed', category: 'cloned', labels: { gender: 'male', accent: 'british', use_case: 'narration' }, preview_url: 'https://x.test/a.mp3' },
      { voice_id: 'aaaaaaaaaa', name: ' Amy ', labels: {}, preview_url: 'http://insecure.test/a.mp3' },
      { voice_id: 'bad id!', name: 'Broken' },
      { voice_id: 'cccccccccc' },
      null,
    ],
  });
  assert.deepEqual(voices.map((v) => v.name), ['Amy', 'Zed']);
  assert.equal(voices[0].previewUrl, undefined);
  assert.equal(voices[0].category, 'premade');
  assert.equal(voices[1].previewUrl, 'https://x.test/a.mp3');
  assert.equal(describeVoice(voices[1]), 'male, british, narration');
  assert.deepEqual(parseVoices({}), []);
  assert.deepEqual(parseVoices('nope'), []);
});

test('a saved voice counts as present when the account has it, by id or by its old name', () => {
  const list = [{ id: 'JBFqnCBsd6RMkjVDRZzb' }];
  assert.equal(voiceInList('george', list), true);
  assert.equal(voiceInList('JBFqnCBsd6RMkjVDRZzb', list), true);
  assert.equal(voiceInList('rachel', list), false);
});

import { PROVIDERS } from './borga/providers';
import { runProviderTest } from './borga/provider-tests';

test('Fish Audio has a place for the key and the voice id, and its check reports the real answer', async () => {
  const def = PROVIDERS.find((p) => p.id === 'fish');
  assert.deepEqual(def?.fields.map((f) => f.key), ['apiKey', 'voiceId']);
  const reply = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch;
  assert.match((await runProviderTest('fish', { apiKey: 'k' }, reply(401))).message, /rejected/);
  assert.equal((await runProviderTest('fish', { apiKey: 'k' }, reply(200))).ok, true);
  const missingVoice = (async (url: string) => new Response('{}', { status: String(url).includes('/model/') ? 404 : 200 })) as unknown as typeof fetch;
  assert.match((await runProviderTest('fish', { apiKey: 'k', voiceId: 'abcdef123456' }, missingVoice)).message, /no voice/);
});

test('an ElevenLabs key that cannot read the account but can list voices passes the check', async () => {
  const f = (async (url: string) => new Response('{}', { status: String(url).endsWith('/user') ? 401 : 200 })) as unknown as typeof fetch;
  const r = await runProviderTest('elevenlabs', { apiKey: 'sk_x' }, f);
  assert.equal(r.ok, true);
  const rejected = (async () => new Response(JSON.stringify({ detail: { message: 'Invalid API key' } }), { status: 401 })) as unknown as typeof fetch;
  const bad = await runProviderTest('elevenlabs', { apiKey: 'sk_x' }, rejected);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Invalid API key/);
});
