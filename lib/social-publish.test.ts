import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_CHAR_LIMIT,
  CHANNEL_STRATEGY,
  authKindForToolkit,
  buildFacebookCommentArgs,
  buildFacebookPostArgs,
  buildInstagramReplyArgs,
  buildLinkedInPostArgs,
  buildTwitterPostArgs,
  extractLinkedInInfo,
  fanOutChannels,
  linkedInAuthorUrn,
  normalizeAuthorUrn,
  strategyFor,
} from './borga/social-publish';
import type { SocialChannel } from './borga/data';

const CHANNELS: SocialChannel[] = ['linkedin', 'twitter', 'facebook', 'instagram', 'tiktok', 'threads', 'youtube', 'pinterest'];

test('every channel has a strategy with an honest publishing path', () => {
  for (const c of CHANNELS) {
    const s = strategyFor(c);
    assert.equal(s.channel, c);
    if (s.mode === 'queue') {
      assert.ok(s.queueReason && s.queueReason.length > 0, `${c} explains why it queues`);
      assert.ok(s.nextStep && s.nextStep.length > 0, `${c} says what unlocks live posting`);
    }
  }
});

test('linkedin and X publish live; threads stays queued (no toolkit)', () => {
  assert.equal(strategyFor('linkedin').mode, 'live');
  assert.equal(strategyFor('linkedin').toolkit, 'linkedin');
  assert.equal(strategyFor('twitter').mode, 'live');
  assert.equal(strategyFor('threads').mode, 'queue');
  assert.match(strategyFor('threads').queueReason ?? '', /no Composio toolkit/i);
});

test('managed vs custom auth matches the live probe', () => {
  for (const t of ['linkedin', 'facebook', 'instagram', 'youtube', 'pinterest']) {
    assert.equal(authKindForToolkit(t), 'managed', t);
  }
  for (const t of ['twitter', 'buffer', 'tiktok']) {
    assert.equal(authKindForToolkit(t), 'custom', t);
  }
  assert.equal(authKindForToolkit('threads'), 'none');
  assert.ok(Object.keys(CHANNEL_STRATEGY).length >= CHANNELS.length);
});

test('post/reply arg builders match the verified Composio schemas', () => {  assert.deepEqual(buildLinkedInPostArgs('urn:li:person:1', 'Hello'), { author: 'urn:li:person:1', commentary: 'Hello' });
  assert.equal(linkedInAuthorUrn({ author_id: 'urn:li:person:1' }), 'urn:li:person:1');
  assert.equal(linkedInAuthorUrn({ authorId: 'urn:li:organization:2' }), 'urn:li:organization:2');
  assert.equal(linkedInAuthorUrn({}), '');
  assert.deepEqual(buildTwitterPostArgs('Hi'), { text: 'Hi' });
  assert.deepEqual(buildTwitterPostArgs('Hi', '123'), { text: 'Hi', reply: { in_reply_to_tweet_id: '123' } });
  assert.deepEqual(buildFacebookPostArgs('p1', 'Hi'), { page_id: 'p1', message: 'Hi', published: true });
  assert.deepEqual(buildFacebookCommentArgs('o1', 'Nice'), { object_id: 'o1', message: 'Nice' });
  assert.deepEqual(buildInstagramReplyArgs('c1', 'Thanks'), { ig_comment_id: 'c1', message: 'Thanks' });
});

test('composer character limits cover every channel', () => {
  for (const c of CHANNELS) {
    assert.ok(CHANNEL_CHAR_LIMIT[c] > 0, c);
  }
  assert.equal(CHANNEL_CHAR_LIMIT.twitter, 280);
  assert.equal(CHANNEL_CHAR_LIMIT.threads, 500);
});

test('author URN unwraps the live nested response_dict shape', () => {
  const live = { response_dict: { author_id: 'urn:li:person:Z6F21qW77a', sub: 'Z6F21qW77a' } };
  assert.equal(linkedInAuthorUrn(extractLinkedInInfo(live)), 'urn:li:person:Z6F21qW77a');
  assert.equal(linkedInAuthorUrn(extractLinkedInInfo({ data: { urn: 'urn:li:organization:2' } })), 'urn:li:organization:2');
  assert.equal(linkedInAuthorUrn(extractLinkedInInfo({})), '');
  assert.equal(linkedInAuthorUrn(extractLinkedInInfo(null)), '');
});

test('bare ids normalize to full person URNs; valid URNs pass through', () => {
  assert.equal(normalizeAuthorUrn('Z6F21qW77a'), 'urn:li:person:Z6F21qW77a');
  assert.equal(normalizeAuthorUrn('urn:li:person:Z6F21qW77a'), 'urn:li:person:Z6F21qW77a');
  assert.equal(normalizeAuthorUrn('urn:li:organization:987654321'), 'urn:li:organization:987654321');
  assert.equal(normalizeAuthorUrn('https://linkedin.com/in/x'), 'https://linkedin.com/in/x', 'non-id input is left alone');
});

test('multi-channel fan-out dedupes and queues unlinked channels', () => {
  const linked = (c: (typeof CHANNELS)[number]) => c === 'linkedin';
  const out = fanOutChannels(['linkedin', 'linkedin', 'twitter', 'threads'], linked);
  assert.deepEqual(out.live, ['linkedin']);
  assert.deepEqual(out.queued, ['twitter', 'threads']);
});
