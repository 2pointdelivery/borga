import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKER_OPEN_MS,
  breakerAllows,
  breakerRecord,
  containerTag,
  docPassages,
  flattenProfile,
  kbDoc,
  memoryDoc,
  outboxDelayMs,
  pickFacts,
  redactEmails,
  ticketDoc,
} from './borga/supermemory-core';

test('container tag is valid, per user+workspace, and rejects unsafe ids', () => {
  const tag = containerTag('2cb01a20-6a87-453a-9cf5-f3e9a762df87', 'ws-5ef3d59f');
  assert.match(tag, /^[a-zA-Z0-9_:-]+$/);
  assert.ok(tag.length <= 100);
  assert.notEqual(tag, containerTag('2cb01a20-6a87-453a-9cf5-f3e9a762df87', 'ws-other'));
  assert.notEqual(tag, containerTag('someone-else', 'ws-5ef3d59f'));
  assert.throws(() => containerTag('bad user', 'ws-1'));
  assert.throws(() => containerTag('u', 'x'.repeat(120)));
});

test('memory documents are tagged, deduplicated by customId, and size-limited', () => {
  const d = memoryDoc('t', { id: 'm1', content: 'x'.repeat(20_000), kind: 'fact', tags: ['a', 'b'], agentId: 'a1', agentName: 'Borga' });
  assert.equal(d.taskType, 'memory');
  assert.equal(d.customId, 'mem:m1');
  assert.ok(d.content.length <= 10_000);
  assert.deepEqual(d.metadata, { source: 'agent-memory', agentId: 'a1', kind: 'fact', tags: ['a', 'b'] });
  assert.ok((d.entityContext ?? '').length <= 1500);
});

test('knowledge entries use superrag and a stable customId', () => {
  const d = kbDoc('t', { id: 'k1', title: 'Refund policy', answer: '30 days.' });
  assert.equal(d.taskType, 'superrag');
  assert.equal(d.customId, 'kb:k1');
  assert.equal(d.content, 'Refund policy\n\n30 days.');
  assert.equal(d.metadata.source, 'kb');
});

test('ticket documents never carry customer contact details', () => {
  const d = ticketDoc('t', {
    id: 'SUP-7', subject: 'Cannot log in', description: 'User jane@client.test cannot log in', type: 'incident', priority: 'high', status: 'resolved', labels: ['auth'], resolvedAt: '2026-10-01T00:00:00Z',
    comments: [
      { kind: 'system', body: 'Ticket created via email.' },
      { kind: 'email-in', body: 'Please call me, I am bob@x.test' },
      { kind: 'public', body: 'Reset your password at the link.' },
    ],
  });
  assert.ok(!/@/.test(d.content), d.content);
  assert.match(d.content, /\[email\]/);
  assert.ok(!d.content.includes('Ticket created via email'), 'system lines are noise');
  assert.match(d.content, /Resolution thread/);
  assert.equal(d.customId, 'ticket:SUP-7');
  assert.equal(d.metadata.source, 'ticket');
  assert.equal(redactEmails('a@b.co and c.d+e@f-g.org'), '[email] and [email]');
});

test('pickFacts keeps current facts, drops forgotten/superseded, dedupes, ranks by score', () => {
  const out = pickFacts(
    [
      { memory: 'Prefers email', score: 0.4 },
      { memory: 'Prefers phone', score: 0.9, isLatest: true },
      { memory: 'Old fact', score: 0.99, isLatest: false },
      { memory: 'Gone', score: 0.95, isForgotten: true },
      { memory: '  prefers   PHONE ', score: 0.5 },
    ],
    5,
  );
  assert.deepEqual(out, ['Prefers phone', 'Prefers email']);
  assert.equal(pickFacts([{ memory: 'a', score: 1 }, { memory: 'b', score: 0.9 }], 1).length, 1);
});

test('docPassages prefers matching chunks, falls back to content/summary, drops empties', () => {
  const p = docPassages(
    [
      { documentId: '1', title: 'A', score: 0.9, chunks: [{ content: 'chunk one' }, { content: 'chunk two' }] },
      { documentId: '2', title: null, score: 0.8, content: 'whole doc', metadata: { title: 'From meta' } },
      { documentId: '3', title: 'Empty', score: 0.7 },
    ],
    5,
  );
  assert.equal(p.length, 2);
  assert.equal(p[0].text, 'chunk one\nchunk two');
  assert.equal(p[1].title, 'From meta');
});

test('profile flattening puts static facts first and de-duplicates', () => {
  const facts = flattenProfile(
    { dynamic: [{ memory: 'Working on Q4 plan', isStatic: false }, { memory: 'Based in Accra', isStatic: false }], static: [{ memory: 'Based in Accra', isStatic: true }, { memory: 'Logistics company', isStatic: true }] },
    10,
  );
  assert.deepEqual(facts, ['Based in Accra', 'Logistics company', 'Working on Q4 plan']);
  assert.deepEqual(flattenProfile(undefined, 5), []);
});

test('circuit breaker opens after 3 failures and recovers; outbox delay doubles to a cap', () => {
  let b = { failures: 0, openUntil: 0 };
  const t0 = 1_000_000;
  b = breakerRecord(b, false, t0);
  b = breakerRecord(b, false, t0);
  assert.equal(breakerAllows(b, t0), true);
  b = breakerRecord(b, false, t0);
  assert.equal(breakerAllows(b, t0 + 1), false);
  assert.equal(breakerAllows(b, t0 + BREAKER_OPEN_MS), true);
  assert.equal(breakerRecord(b, true, t0).failures, 0);
  assert.equal(outboxDelayMs(1), 60_000);
  assert.equal(outboxDelayMs(3), 240_000);
  assert.equal(outboxDelayMs(30), 3_600_000);
});
