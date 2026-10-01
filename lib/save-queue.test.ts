import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue, canonicalJson, type SendResult } from './borga/save-queue';

type Payload = { value: unknown };

/** An in-memory stand-in for the server: same rules as POST /api/borga/data with a baseVersion. */
class FakeServer {
  rows = new Map<string, { version: number; value: unknown }>();
  sends: { id: string; base: number }[] = [];
  failNext = false;
  delayMs = 0;

  async handle(id: string, payload: Payload, base: number): Promise<SendResult> {
    this.sends.push({ id, base });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext) { this.failNext = false; return { status: 'error' }; }
    const row = this.rows.get(id);
    const currentVersion = row?.version ?? 0;
    if (currentVersion !== base) return { status: 'conflict', current: row ? { version: row.version, value: row.value } : null };
    const version = currentVersion + 1;
    this.rows.set(id, { version, value: payload.value });
    return { status: 'ok', version };
  }

  /** A write from somewhere else: another tab, another device, or an agent. */
  external(id: string, value: unknown) {
    const row = this.rows.get(id);
    this.rows.set(id, { version: (row?.version ?? 0) + 1, value });
  }
}

function tab(server: FakeServer) {
  const events = { conflicts: [] as string[], errors: [] as string[] };
  const queue = new SaveQueue<Payload>({
    send: (id, p, base) => server.handle(id, p, base),
    valueOf: (p) => p.value,
    onConflict: (id) => events.conflicts.push(id),
    onError: (id) => events.errors.push(id),
  });
  return { queue, events };
}

const ID = 'ws1|invoices';

test('sequential saves each use the version the previous one returned', async () => {
  const s = new FakeServer();
  const { queue } = tab(s);
  await queue.save(ID, { value: [1] });
  await queue.save(ID, { value: [1, 2] });
  assert.deepEqual(s.sends.map((x) => x.base), [0, 1]);
  assert.equal(queue.version(ID), 2);
  assert.deepEqual(s.rows.get(ID)?.value, [1, 2]);
});

test('quick successive edits coalesce and never conflict with each other', async () => {
  const s = new FakeServer();
  s.delayMs = 10;
  const { queue, events } = tab(s);
  const all = [1, 2, 3, 4, 5].map((n) => queue.save(ID, { value: [n] }));
  await Promise.all(all);
  assert.deepEqual(events.conflicts, []);
  assert.deepEqual(s.rows.get(ID)?.value, [5], 'the newest value wins');
  assert.ok(s.sends.length <= 2, `only the first and the newest are sent, got ${s.sends.length}`);
});

test('a stale tab is refused, the newer data survives, and the tab is blocked until reloaded', async () => {
  const s = new FakeServer();
  const a = tab(s);
  const b = tab(s);
  await a.queue.save(ID, { value: ['original'] });
  b.queue.setVersions('ws1|', { invoices: 1 }); // tab B loaded version 1
  await a.queue.save(ID, { value: ['A edited'] }); // tab A saves: version 2
  await b.queue.save(ID, { value: ['B edited from a stale copy'] });
  assert.deepEqual(s.rows.get(ID)?.value, ['A edited'], "B must not overwrite A's newer data");
  assert.deepEqual(b.events.conflicts, [ID]);
  assert.equal(b.queue.isBlocked(ID), true);
  // while blocked, further edits are not sent
  const before = s.sends.length;
  await b.queue.save(ID, { value: ['more B edits'] });
  assert.equal(s.sends.length, before);
  // after reloading the latest copy the entity saves again
  b.queue.setVersions('ws1|', { invoices: 2 });
  assert.equal(b.queue.isBlocked(ID), false);
  await b.queue.save(ID, { value: ['B edited after reload'] });
  assert.deepEqual(s.rows.get(ID)?.value, ['B edited after reload']);
});

test('a change made by an agent or another device counts as a conflict too', async () => {
  const s = new FakeServer();
  const a = tab(s);
  await a.queue.save(ID, { value: ['mine'] });
  s.external(ID, ['changed by an agent']);
  await a.queue.save(ID, { value: ['mine, edited'] });
  assert.deepEqual(a.events.conflicts, [ID]);
  assert.deepEqual(s.rows.get(ID)?.value, ['changed by an agent']);
});

test('when the server already holds exactly what this tab is saving, the version is adopted without a conflict', async () => {
  const s = new FakeServer();
  const a = tab(s);
  await a.queue.save(ID, { value: [{ id: 1, name: 'x' }] });
  // a server route wrote the same content (with keys in another order, as MySQL JSON does)
  s.external(ID, [{ name: 'x', id: 1 }]);
  await a.queue.save(ID, { value: [{ id: 1, name: 'x' }] });
  assert.deepEqual(a.events.conflicts, []);
  assert.equal(a.queue.version(ID), 2);
  await a.queue.save(ID, { value: [{ id: 1, name: 'y' }] });
  assert.deepEqual(a.events.conflicts, []);
  assert.deepEqual(s.rows.get(ID)?.value, [{ id: 1, name: 'y' }]);
});

test('a first save conflicts when the row appeared meanwhile with different content, and agrees when it is identical', async () => {
  const s = new FakeServer();
  s.external(ID, ['someone else created it']);
  const a = tab(s);
  await a.queue.save(ID, { value: ['mine'] }); // base 0, row exists with other content
  assert.deepEqual(a.events.conflicts, [ID]);
  const b = tab(s);
  await b.queue.save(ID, { value: ['someone else created it'] });
  assert.deepEqual(b.events.conflicts, []);
  assert.equal(b.queue.version(ID), 1);
});

test('a network error is not a conflict and does not block; the next save sends the newest value', async () => {
  const s = new FakeServer();
  const a = tab(s);
  await a.queue.save(ID, { value: [1] });
  s.failNext = true;
  await a.queue.save(ID, { value: [2] });
  assert.deepEqual(a.events.errors, [ID]);
  assert.equal(a.queue.isBlocked(ID), false);
  await a.queue.save(ID, { value: [3] });
  assert.deepEqual(s.rows.get(ID)?.value, [3]);
  assert.deepEqual(a.events.conflicts, []);
});

test('two tabs saving from the same version: exactly one wins, the other is told', async () => {
  const s = new FakeServer();
  s.delayMs = 5;
  const a = tab(s);
  const b = tab(s);
  a.queue.setVersions('ws1|', { invoices: 0 });
  b.queue.setVersions('ws1|', { invoices: 0 });
  await Promise.all([a.queue.save(ID, { value: ['from A'] }), b.queue.save(ID, { value: ['from B'] })]);
  assert.equal(a.events.conflicts.length + b.events.conflicts.length, 1);
  assert.equal(s.rows.get(ID)?.version, 1);
});

test('a rejected save is dropped quietly: no error hook, no conflict, no block', async () => {
  const events = { conflicts: 0, errors: 0 };
  const sent: number[] = [];
  const queue = new SaveQueue<Payload>({
    send: async (_id, _p, base) => { sent.push(base); return sent.length === 1 ? { status: 'rejected' } : { status: 'ok', version: 1 }; },
    valueOf: (p) => p.value,
    onConflict: () => { events.conflicts++; },
    onError: () => { events.errors++; },
  });
  await queue.save(ID, { value: ['too big'] });
  assert.deepEqual(events, { conflicts: 0, errors: 0 });
  assert.equal(queue.isBlocked(ID), false);
  await queue.save(ID, { value: ['small'] });
  assert.deepEqual(sent, [0, 0], 'the next save is sent from the same version');
});

test('entities are independent: a conflict on one does not block another', async () => {
  const s = new FakeServer();
  const a = tab(s);
  await a.queue.save('ws1|goals', { value: [1] });
  s.external('ws1|goals', ['other']);
  await a.queue.save('ws1|goals', { value: [2] });
  assert.equal(a.queue.isBlocked('ws1|goals'), true);
  await a.queue.save('ws1|tasks', { value: ['t'] });
  assert.equal(a.queue.isBlocked('ws1|tasks'), false);
  assert.deepEqual(s.rows.get('ws1|tasks')?.value, ['t']);
});

test('setVersions replaces only its own scope', () => {
  const s = new FakeServer();
  const { queue } = tab(s);
  queue.setVersions('ws1|', { goals: 4 });
  queue.setVersions('ws2|', { goals: 9 });
  queue.setVersions('ws1|', { tasks: 2 });
  assert.equal(queue.version('ws1|goals'), 0, 'old ws1 entries are dropped');
  assert.equal(queue.version('ws1|tasks'), 2);
  assert.equal(queue.version('ws2|goals'), 9);
});

test('canonicalJson ignores key order and undefined fields but not content', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] }), canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }));
  assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: '1' }));
  assert.equal(canonicalJson(null), 'null');
});
