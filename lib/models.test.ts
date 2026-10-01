import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelList, mergeLoadedModels, repairCatalog, presetFor, FREE_LLM_PROVIDERS } from './borga/model-catalog';
import type { LlmProvider } from './borga/data';

// Shapes follow each provider's documented /models response.
const OPENROUTER = {
  data: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', context_length: 131072, pricing: { prompt: '0', completion: '0' } },
    { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek: R1 (free)', context_length: 163840, pricing: { prompt: '0', completion: '0' } },
    { id: 'someorg/zero-priced-no-suffix', name: 'Zero Priced', context_length: 32000, pricing: { prompt: '0', completion: '0' } },
    { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' } },
    { id: 'openai/text-embedding-3-small', name: 'Embedding', pricing: { prompt: '0.00000002', completion: '0' } },
  ],
};

const GROQ = {
  object: 'list',
  data: [
    { id: 'llama-3.3-70b-versatile', object: 'model', context_window: 131072 },
    { id: 'llama-3.1-8b-instant', object: 'model', context_window: 131072 },
    { id: 'whisper-large-v3', object: 'model', context_window: 448 },
    { id: 'meta-llama/llama-guard-4-12b', object: 'model', context_window: 131072 },
    { id: 'playai-tts', object: 'model' },
  ],
};

const GEMINI_COMPAT = {
  object: 'list',
  data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/gemini-2.5-pro' }, { id: 'models/text-embedding-004' }, { id: 'models/imagen-4.0-generate' }],
};

const GEMINI_NATIVE = {
  models: [
    { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/embedding-001', displayName: 'Embedding', inputTokenLimit: 2048, supportedGenerationMethods: ['embedContent'] },
  ],
};

test('OpenRouter: only zero-priced models are free; paid and non-chat models are dropped by default', () => {
  const r = parseModelList('llm-openrouter', OPENROUTER);
  assert.deepEqual(r.models.map((m) => m.id).sort(), ['deepseek/deepseek-r1:free', 'meta-llama/llama-3.3-70b-instruct:free', 'someorg/zero-priced-no-suffix']);
  assert.ok(r.models.every((m) => m.tier === 'free'));
  assert.equal(r.total, 5);
  assert.equal(r.skipped, 2);
});

test('OpenRouter: labels lose the "(free)" suffix and context is reported in thousands', () => {
  const m = parseModelList('llm-openrouter', OPENROUTER).models.find((x) => x.id.startsWith('meta-llama'))!;
  assert.equal(m.label, 'Meta: Llama 3.3 70B Instruct');
  assert.equal(m.contextK, 131);
  assert.equal(m.tag, 'powerful');
  assert.equal(parseModelList('llm-openrouter', OPENROUTER).models.find((x) => x.id.includes('r1'))!.tag, 'reasoning');
});

test('OpenRouter with freeOnly off keeps paid models marked as paid', () => {
  const r = parseModelList('llm-openrouter', OPENROUTER, { freeOnly: false });
  assert.equal(r.models.find((m) => m.id === 'openai/gpt-4o')!.tier, 'paid');
  assert.ok(!r.models.some((m) => m.id.includes('embedding')));
  assert.equal(r.models[0].tier, 'free');
});

test('Groq: every chat model is on the free tier; speech and safety models are dropped', () => {
  const r = parseModelList('llm-groq', GROQ);
  assert.deepEqual(r.models.map((m) => m.id).sort(), ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
  assert.ok(r.models.every((m) => m.tier === 'free'));
  assert.equal(r.models.find((m) => m.id === 'llama-3.1-8b-instant')!.tag, 'fast');
});

test('Gemini compat: the models/ prefix is removed so the id works in chat completions', () => {
  const r = parseModelList('llm-gemini', GEMINI_COMPAT);
  assert.deepEqual(r.models.map((m) => m.id).sort(), ['gemini-2.5-flash', 'gemini-2.5-pro']);
});

test('Gemini native listing: models that cannot generate content are dropped and names are used', () => {
  const r = parseModelList('llm-gemini', GEMINI_NATIVE);
  assert.deepEqual(r.models.map((m) => [m.id, m.label, m.contextK]), [['gemini-2.0-flash', 'Gemini 2.0 Flash', 1049]]);
});

test('NVIDIA models are marked as credits, not free', () => {
  const r = parseModelList('llm-nvidia', { data: [{ id: 'meta/llama-3.3-70b-instruct' }] });
  assert.equal(r.models[0].tier, 'credits');
});

test('malformed payloads give an empty result instead of throwing', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { data: 'nope' }, { data: [null, 5, {}] }]) {
    assert.deepEqual(parseModelList('llm-groq', bad).models, []);
  }
});

test('duplicates collapse and free models sort before others', () => {
  const r = parseModelList('llm-openrouter', { data: [{ id: 'a/x', pricing: { prompt: '1', completion: '1' } }, { id: 'b/y:free' }, { id: 'b/y:free' }] }, { freeOnly: false });
  assert.deepEqual(r.models.map((m) => m.id), ['b/y:free', 'a/x']);
});

test('merging replaces stale free models, keeps paid and hand-added ones and the selected model', () => {
  const existing = [
    { id: 'old-free', label: 'Old free', tier: 'free' as const },
    { id: 'selected-old', label: 'Selected', tier: 'free' as const },
    { id: 'my-paid', label: 'Paid', tier: 'paid' as const },
    { id: 'same', label: 'Same (old label)', tier: 'free' as const },
  ];
  const loaded = [{ id: 'same', label: 'Same', tier: 'free' as const }, { id: 'new', label: 'New', tier: 'free' as const }];
  const merged = mergeLoadedModels(existing, loaded, ['selected-old']);
  assert.deepEqual(merged.map((m) => m.id), ['same', 'new', 'selected-old', 'my-paid']);
  assert.equal(merged[0].label, 'Same');
});

const seed = (id: string, baseUrl = ''): LlmProvider => ({ id, label: id, baseUrl, accent: '#000', models: [] });

test('repairing a stored catalog adds new providers before the custom entry and fixes the Gemini URL', () => {
  const stored = [seed('llm-groq'), seed('llm-gemini', 'https://generativelanguage.googleapis.com/v1beta'), seed('llm-custom')];
  const fixed = repairCatalog(stored, [seed('llm-groq'), seed('llm-cerebras'), seed('llm-custom')]);
  assert.deepEqual(fixed.map((p) => p.id), ['llm-groq', 'llm-gemini', 'llm-cerebras', 'llm-custom']);
  assert.equal(fixed[1].baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  // already-correct URLs and a repaired catalog stay unchanged
  assert.equal(repairCatalog(fixed, [seed('llm-cerebras')])[1].baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(repairCatalog(fixed, fixed).length, fixed.length);
});

test('every free-provider preset has a signup link and a unique id', () => {
  assert.equal(new Set(FREE_LLM_PROVIDERS.map((p) => p.id)).size, FREE_LLM_PROVIDERS.length);
  for (const p of FREE_LLM_PROVIDERS) assert.match(p.signupUrl, /^https:\/\//);
  assert.equal(presetFor('llm-openrouter')?.keyOptional, true);
  assert.equal(presetFor('llm-claude'), undefined);
});
