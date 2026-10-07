import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPostPreview } from './borga/safe-markdown';

test('angle brackets in user text are escaped, never rendered', () => {
  const out = renderPostPreview('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'), out);
  assert.ok(out.includes('&lt;script&gt;'), out);
});

test('link URLs cannot break out of the href attribute', () => {
  const out = renderPostPreview('[x](https://"onmouseover="alert(1))');
  assert.ok(!out.includes('onmouseover="alert(1)"'), out);
  assert.ok(!/href="[^"]*"[^>]*on\w+=/i.test(out), out);
});

test('javascript: links are not linkified', () => {
  const out = renderPostPreview('[x](javascript:alert(1))');
  assert.ok(!out.includes('<a '), out);
});

test('quotes in plain text render safely', () => {
  const out = renderPostPreview('say "hi"');
  assert.ok(out.includes('say &quot;hi&quot;'), out);
});

test('basic marks still work after escaping', () => {
  assert.ok(renderPostPreview('**bold**').includes('<strong>bold</strong>'));
  assert.ok(renderPostPreview('[docs](https://x.test/y)').includes('<a href="https://x.test/y"'));
  assert.ok(renderPostPreview('- a\n- b').includes('<ul'));
  assert.ok(renderPostPreview('> q').includes('<blockquote'));
});
