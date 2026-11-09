import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeServers, findServerByUrl, normalizeMcpUrl } from './borga/mcp-dedupe';
import type { McpServer } from './borga/data';

const srv = (id: string, url: string, over: Partial<McpServer> = {}): McpServer => ({ id, name: id, url, authType: 'none', status: 'off', lastSync: '', ...over });

test('the same server written differently is the same address', () => {
  assert.equal(normalizeMcpUrl('https://MCP.Notion.com/mcp/'), normalizeMcpUrl('https://mcp.notion.com/mcp#x'));
  assert.notEqual(normalizeMcpUrl('https://mcp.notion.com/mcp'), normalizeMcpUrl('https://mcp.notion.com/other'));
  assert.notEqual(normalizeMcpUrl('https://a.test/mcp?k=1'), normalizeMcpUrl('https://a.test/mcp?k=2'));
  assert.equal(normalizeMcpUrl('not a url'), 'not a url');
});

test('an address already registered is found, whatever the spelling', () => {
  const list = [srv('a', 'https://mcp.example.com/mcp')];
  assert.equal(findServerByUrl(list, 'https://MCP.example.com/mcp/')?.id, 'a');
  assert.equal(findServerByUrl(list, 'https://elsewhere.test/mcp'), undefined);
});

test('duplicates collapse to the connected entry with the most tools, and distinct servers are untouched', () => {
  const list = [
    srv('new-empty', 'https://mcp.example.com/mcp'),
    srv('old-connected', 'https://mcp.example.com/mcp/', { status: 'connected', toolCount: 12 }),
    srv('errored', 'https://mcp.example.com/mcp', { status: 'error' }),
    srv('other', 'https://other.test/mcp'),
  ];
  const { keep, removed } = dedupeServers(list);
  assert.deepEqual(keep.map((s) => s.id), ['old-connected', 'other']);
  assert.deepEqual(removed.map((s) => s.id).sort(), ['errored', 'new-empty']);
  assert.deepEqual(dedupeServers(keep).removed, []);
});
