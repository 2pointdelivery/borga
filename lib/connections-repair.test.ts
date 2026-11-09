import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_CONNECTIONS, repairConnections, type AppConnection } from './borga/data';
import { appKey } from '../components/borga/use-connection-actions';

const demo: AppConnection = { id: 'cn-demo', type: 'llm', provider: 'demo', label: 'Demo (no key)', status: 'connected', account: '', scopes: 'chat completions — always on', lastSync: 'Just now' };
const gmail: AppConnection = { id: 'cn-gmail', type: 'tool', provider: 'gmail', label: 'Gmail', status: 'connected', account: 'OAuth authorized', lastSync: 'Just now' };

test('the retired "Demo (no key)" connection is removed and everything else is kept as it was', () => {
  const r = repairConnections([demo, gmail]);
  assert.equal(r.changed, true);
  assert.deepEqual(r.connections, [gmail]);
  assert.equal(r.connections[0], gmail, 'a real connection is the same object, not rewritten');
});

test('a list without retired cards is left alone, and nothing saved means the starter list', () => {
  const clean = repairConnections([gmail]);
  assert.equal(clean.changed, false);
  assert.equal(repairConnections(undefined).connections, INITIAL_CONNECTIONS);
  assert.equal(repairConnections(null).changed, false);
  assert.ok(!INITIAL_CONNECTIONS.some((c) => c.id === 'cn-demo' || /demo/i.test(c.label)), 'new companies never get it');
});

test('a retired local-model connection goes too, by id or by provider', () => {
  assert.equal(repairConnections([{ ...demo, id: 'cn-ollama', provider: 'ollama', label: 'Ollama' }, gmail]).connections.length, 1);
  assert.equal(repairConnections([{ ...demo, id: 'cn-x', provider: 'demo' }, gmail]).connections.length, 1, 'an llm card whose provider is retired');
});

test('the same app is recognised however its name is spelled', () => {
  assert.equal(appKey('google-calendar'), appKey('googlecalendar'));
  assert.equal(appKey('Google_Calendar'), appKey('google-calendar'));
  assert.notEqual(appKey('gmail'), appKey('outlook'));
});
