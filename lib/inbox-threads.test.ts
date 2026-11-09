import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThreads, threadKeyOf, addressOf, threadMatchesFolder, itemMatchesFolder } from './borga/inbox-threads';

const ITEM = (over: Partial<Parameters<typeof buildThreads>[0][number]>) => ({
  id: over.id ?? 'x', channel: 'email' as const, contactKey: '', contactName: '', body: 'hi',
  status: 'sent' as const, at: '2026-10-10T10:00:00.000Z', ...over,
});

test('threads group per contact and keep newest activity first', () => {
  const threads = buildThreads([
    ITEM({ id: 'a', contactKey: 'ada@acme.com', contactName: 'Ada Lovelace', body: 'older', at: '2026-10-01T10:00:00.000Z' }),
    ITEM({ id: 'b', contactKey: 'bo@corp.io', contactName: 'Bo', at: '2026-10-09T10:00:00.000Z' }),
    ITEM({ id: 'c', contactKey: 'ada@acme.com', contactName: 'Ada Lovelace', channel: 'whatsapp', body: 'newer', at: '2026-10-10T09:00:00.000Z' }),
  ]);
  assert.equal(threads.length, 2);
  assert.equal(threads[0].contactName, 'Ada Lovelace'); // newest activity
  assert.equal(threads[0].items.length, 2);
  assert.equal(threads[0].items[0].id, 'c'); // newest item first
  assert.deepEqual(threads[0].channels.sort(), ['email', 'whatsapp']);
});

test('addressOf reads Name <email>, bare emails and phones', () => {
  assert.deepEqual(addressOf('Ada <ada@acme.com>'), { name: 'Ada', address: 'ada@acme.com' });
  assert.deepEqual(addressOf('ada@acme.com'), { name: 'ada@acme.com', address: 'ada@acme.com' });
  assert.equal(addressOf('Bo +1 555 0100').address, '+1 555 0100');
});

test('threadKeyOf falls back through key → detail → name', () => {
  assert.equal(threadKeyOf({ contactKey: 'K', contactDetail: '', contactName: '', channel: 'email' }), 'k');
  assert.equal(threadKeyOf({ contactKey: '', contactDetail: 'ada@acme.com', contactName: 'Ada', channel: 'email' }), 'ada@acme.com');
  assert.equal(threadKeyOf({ contactKey: '', contactDetail: 'not an address', contactName: 'Ada', channel: 'email' }), 'ada');
});

test('folders: failed/drafts/scheduled filter both levels', () => {
  const threads = buildThreads([
    ITEM({ id: 'ok', contactKey: 'a@x.io', contactName: 'A', status: 'sent' }),
    ITEM({ id: 'bad', contactKey: 'a@x.io', contactName: 'A', status: 'failed' }),
    ITEM({ id: 'draft', contactKey: 'b@x.io', contactName: 'B', status: 'draft' }),
  ]);
  const failedThread = threads.find((t) => t.key === 'a@x.io')!;
  const draftThread = threads.find((t) => t.key === 'b@x.io')!;
  assert.equal(threadMatchesFolder(failedThread, 'failed'), true);
  assert.equal(threadMatchesFolder(draftThread, 'failed'), false);
  assert.equal(threadMatchesFolder(draftThread, 'drafts'), true);
  assert.equal(itemMatchesFolder(ITEM({ status: 'draft' }), 'drafts'), true);
  assert.equal(itemMatchesFolder(ITEM({ status: 'sent' }), 'sent'), true);
});
