import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_INSTRUCTIONS, personaInstructions } from './borga/agent-personas';
import { AGENTS } from './borga/data';

test('every persona on the lineup has operating instructions', () => {
  assert.ok(AGENTS.length > 0);
  for (const a of AGENTS) {
    const content = personaInstructions(a);
    assert.ok(content && content.length > 80, `${a.name} (${a.persona}) has no persona instruction`);
  }
});

test('the map covers every persona key the seed uses', () => {
  const keys = new Set(Object.keys(PERSONA_INSTRUCTIONS));
  for (const a of AGENTS) assert.ok(keys.has(a.persona ?? ''), a.persona);
});

test('operating instructions are role-shaped, never empty strings', () => {
  for (const [key, text] of Object.entries(PERSONA_INSTRUCTIONS)) {
    assert.ok(text.trim().length > 80, key);
    assert.ok(text.includes('You'), key);
  }
});
