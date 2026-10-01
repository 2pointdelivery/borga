// One-off check of the REAL Supermemory API with your key. Writes a few documents under a throwaway
// container tag, searches them, then deletes everything it created.
//
//   SUPERMEMORY_API_KEY=sm_... node scripts/smoke-supermemory.mjs
//
// Memory facts are extracted asynchronously, so the semantic-memory search may be empty for a minute;
// the script waits and reports what it saw instead of failing on that.
const KEY = process.env.SUPERMEMORY_API_KEY;
const BASE = (process.env.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai').replace(/\/+$/, '');
if (!KEY) { console.error('Set SUPERMEMORY_API_KEY first.'); process.exit(1); }

const tag = `borga_smoke_${Date.now()}`;
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!cond) process.exitCode = 1; };

try {
  let r = await call('POST', '/v3/documents/list', { containerTags: [tag], limit: 1 });
  ok('key accepted (list)', r.status === 200, `HTTP ${r.status}`);

  r = await call('POST', '/v3/documents', { content: 'Refunds are issued within 14 days to the original payment method.', containerTag: tag, customId: 'kb:smoke1', taskType: 'superrag', metadata: { source: 'kb', title: 'Refund policy' } });
  ok('add knowledge doc (superrag)', r.status === 200, JSON.stringify(r.json).slice(0, 80));
  r = await call('POST', '/v3/documents', { content: 'Acme prefers invoices on the first of the month.', containerTag: tag, customId: 'mem:smoke1', taskType: 'memory', metadata: { source: 'agent-memory', kind: 'fact', tags: ['billing'] } });
  ok('add memory doc (memory)', r.status === 200, JSON.stringify(r.json).slice(0, 80));

  let docs = [];
  for (let i = 0; i < 18 && !docs.length; i++) {
    await sleep(5000);
    r = await call('POST', '/v3/search', { q: 'refund policy', containerTag: tag, limit: 3, filters: { AND: [{ key: 'source', value: 'kb' }] }, onlyMatchingChunks: true });
    docs = r.json?.results ?? [];
    process.stdout.write('.');
  }
  console.log('');
  ok('document search returns the knowledge doc (filtered by metadata source)', docs.length > 0, docs[0] ? `title=${docs[0].title} chunks=${docs[0].chunks?.length}` : 'nothing indexed within 90s');

  r = await call('POST', '/v4/search', { q: 'when does Acme want invoices', containerTag: tag, limit: 5 });
  ok('memory search endpoint responds', r.status === 200, `${r.json?.results?.length ?? 0} facts (extraction may still be running)`);
  r = await call('POST', '/v4/profile', { containerTag: tag });
  ok('profile endpoint responds', r.status === 200, `buckets: ${Object.keys(r.json?.buckets ?? {}).join(',') || '(none yet)'}`);

  r = await call('DELETE', '/v3/documents/' + encodeURIComponent('kb:smoke1'));
  ok('delete by customId', r.status === 204 || r.status === 200, `HTTP ${r.status}`);
} finally {
  const r = await call('DELETE', '/v3/container-tags/' + encodeURIComponent(tag));
  console.log(`cleanup: container ${tag} deleted (HTTP ${r.status})`);
}
