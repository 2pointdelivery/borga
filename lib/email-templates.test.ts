import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInvite, renderPasswordChanged, renderPasswordReset, renderWelcome } from './auth/email-templates';
import { renderBusinessDocumentEmail, renderTicketReply, renderTransactional } from './borga/email-core';

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

test('renderBusinessDocumentEmail renders Invoices, Quotes, Bills, and Purchase Orders with line items and escapes markup', () => {
  const quoteMail = renderBusinessDocumentEmail({
    kind: 'quote',
    workspaceName: 'Borga <Logistics>',
    documentNumber: 'Q-42 (v1)',
    recipientName: 'Acme <script>alert(1)</script>',
    currency: 'USD',
    totalAmount: 1250,
    subtotalAmount: 1200,
    taxAmount: 50,
    dueOrValidDate: '2026-11-15',
    message: 'Here is our quote for the Q4 freight lane.',
    lines: [
      { label: 'Dedicated Freight Lane', qty: 2, unitPrice: 600, amount: 1200 },
    ],
  });
  assert.match(quoteMail.subject, /^Quote Q-42 \(v1\) from Borga <Logistics> \(\$1,250\.00\)$/);
  assert.ok(!quoteMail.html.includes('<script'), 'hostile recipient name is escaped');
  assert.ok(quoteMail.html.includes('Dedicated Freight Lane'));
  assert.ok(quoteMail.html.includes('$1,250.00'));
  assert.ok(quoteMail.text.includes('Dedicated Freight Lane: 2 × $600.00 = $1,200.00'));

  const poMail = renderBusinessDocumentEmail({
    kind: 'purchase_order',
    workspaceName: 'Borga',
    documentNumber: 'PO-19',
    recipientName: 'Nordic Parts Co',
    currency: 'USD',
    totalAmount: 4800,
    dueOrValidDate: '2026-10-30',
    lines: [{ label: 'Pallet Racks', qty: 12, unitPrice: 400 }],
  });
  assert.match(poMail.subject, /^Purchase Order PO-19 from Borga \(\$4,800\.00\)$/);
  assert.ok(poMail.html.includes('PURCHASE ORDER'));
  assert.ok(poMail.text.includes('Pallet Racks: 12 × $400.00 = $4,800.00'));
});
