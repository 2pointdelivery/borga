import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInvite, renderPasswordChanged, renderPasswordReset, renderWelcome } from './auth/email-templates';
import { renderTicketReply, renderTransactional } from './borga/email-core';

const URL_OK = 'https://app.example.com/reset?token=abc123';

test('the reset email carries the link in both the HTML and the plain-text part', () => {
  const m = renderPasswordReset({ name: 'Ada', resetUrl: URL_OK });
  assert.equal(m.subject, 'Reset your Borga password');
  assert.ok(m.html.includes(`href="${URL_OK}"`));
  assert.ok(m.text.includes(URL_OK), 'text-only clients must get the link too');
  assert.ok(m.text.includes('1 hour'));
  assert.ok(!/<[a-z][^>]*>/i.test(m.text), 'the text part has no markup');
});

test('a hostile name cannot inject markup or headers', () => {
  const evil = '</h1><script>alert(1)</script>\r\nBcc: attacker@example.com';
  for (const m of [
    renderPasswordReset({ name: evil, resetUrl: URL_OK }),
    renderPasswordChanged({ name: evil, signInUrl: 'https://app.example.com/login' }),
    renderWelcome({ name: evil, companyName: evil, appUrl: 'https://app.example.com/app' }),
    renderInvite({ inviteeEmail: evil, inviterName: evil, signupUrl: URL_OK, expiresDays: 7 }),
  ]) {
    assert.ok(!m.html.includes('<script'), 'script is escaped');
    assert.ok(!/[\r\n]/.test(m.subject), 'no line break in the subject');
  }
});

test('only http(s) links become a button', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'https://x.com/"onmouseover="y']) {
    const r = renderTransactional({ brand: 'B', preheader: 'p', title: 't', paragraphs: ['x'], cta: { label: 'Go', url: bad }, reason: 'r' });
    assert.ok(!r.html.includes('href='), `no link for ${bad}`);
    assert.ok(!r.text.includes('Go:'), `no text link for ${bad}`);
  }
});

test('the password-changed notice says every device was signed out', () => {
  const m = renderPasswordChanged({ name: 'Ada', signInUrl: 'https://app.example.com/login' });
  assert.ok(m.text.includes('signed out'));
  assert.ok(m.html.includes('https://app.example.com/login'));
});

test('invite and welcome read well', () => {
  const inv = renderInvite({ inviteeEmail: 'new@acme.com', inviterName: 'Kofi', signupUrl: URL_OK, expiresDays: 7 });
  assert.ok(inv.text.includes('Kofi invited new@acme.com'));
  assert.ok(inv.text.includes('7 days'));
  const w = renderWelcome({ name: 'Ada', companyName: "Ada's Company", appUrl: 'https://app.example.com/app' });
  assert.ok(w.subject.startsWith('Welcome to Borga'));
  assert.ok(w.html.includes('Ada&#39;s Company'));
});

test('a support reply keeps the typed text, links it, and escapes everything else', () => {
  const m = renderTicketReply({ body: 'Hi <b>Sam</b>,\r\nSee https://help.acme.com/a?x=1&y=2. Thanks!', companyName: 'Acme "Support"', ticketRef: 'TKT-12' });
  assert.ok(!m.html.includes('<b>Sam'), 'typed markup is escaped');
  assert.ok(m.html.includes('<br>'), 'line breaks kept');
  assert.ok(m.html.includes('href="https://help.acme.com/a?x=1&amp;y=2"'), 'link without the trailing full stop');
  assert.ok(m.html.includes('</a>.'), 'full stop stays outside the link');
  assert.ok(m.text.includes('TKT-12') && m.text.includes('Hi <b>Sam</b>'), 'text part is the message as typed');
  assert.ok(m.html.includes('Acme &quot;Support&quot;'));
});
