import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedNext, canTransition, isTerminalState,
  isInvoiceOverdue, isOpenReceivable, isOpenPayable,
  effectiveInvoiceStatus, effectiveQuoteStatus, effectiveInviteStatus,
  lifecyclePrompt,
} from './borga/lifecycles';

const TODAY = '2026-06-15';

test('allowed moves are legal, everything else is refused', () => {
  assert.equal(canTransition('task', 'todo', 'in-progress'), true);
  assert.equal(canTransition('task', 'todo', 'done'), true);
  assert.equal(canTransition('lead', 'won', 'new'), false);
  assert.equal(canTransition('lead', 'won', 'qualified'), true);
  assert.equal(canTransition('invoice', 'draft', 'paid'), false);
  assert.equal(canTransition('invoice', 'sent', 'overdue'), true);
  assert.equal(canTransition('approval', 'approved', 'rejected'), false);
  assert.equal(canTransition('booking', 'pending', 'delivered'), false);
});

test('no-op and unknown kinds/states never block (forward compatible)', () => {
  assert.equal(canTransition('task', 'todo', 'todo'), true);
  assert.equal(canTransition('task', 'weird', 'done'), true); // unknown from-state
  // @ts-expect-error deliberately unknown kind for the compatibility contract
  assert.equal(canTransition('mystery', 'a', 'b'), true);
  assert.equal(allowedNext('task', 'nonexistent'), undefined);
});

test('terminal states are declared', () => {
  assert.equal(isTerminalState('approval', 'approved'), true);
  assert.equal(isTerminalState('approval', 'pending'), false);
  assert.equal(isTerminalState('invoice', 'paid'), true);
  assert.equal(isTerminalState('lead', 'won'), false); // can reopen to qualified
});

test('ticket transitions come from the ticket table (single source of truth)', () => {
  assert.equal(canTransition('ticket', 'open', 'closed'), true);
  assert.equal(canTransition('ticket', 'closed', 'open'), true);
  assert.equal(canTransition('ticket', 'resolved', 'pending'), false);
});

test('invoice overdue is derived, never stored: due day is not late', () => {
  const base = { voidedAt: undefined as string | undefined, due: '2026-06-01' };
  assert.equal(isInvoiceOverdue({ status: 'sent', ...base }, TODAY), true);
  assert.equal(isInvoiceOverdue({ status: 'sent', voidedAt: undefined, due: TODAY }, TODAY), false);
  assert.equal(isInvoiceOverdue({ status: 'sent', voidedAt: undefined, due: '2026-07-01' }, TODAY), false);
  assert.equal(isInvoiceOverdue({ status: 'draft', ...base }, TODAY), false);
  assert.equal(isInvoiceOverdue({ status: 'paid', ...base }, TODAY), false);
  assert.equal(isInvoiceOverdue({ status: 'sent', voidedAt: '2026-05-01', due: '2026-06-01' }, TODAY), false);
});

test('effectiveInvoiceStatus shows overdue for sent+past-due and corrects a stale row', () => {
  assert.equal(effectiveInvoiceStatus({ status: 'sent', voidedAt: undefined, due: '2026-06-01' }, TODAY), 'overdue');
  assert.equal(effectiveInvoiceStatus({ status: 'paid', voidedAt: undefined, due: '2026-06-01' }, TODAY), 'paid');
  assert.equal(effectiveInvoiceStatus({ status: 'draft', voidedAt: undefined, due: '2026-06-01' }, TODAY), 'draft');
  assert.equal(effectiveInvoiceStatus({ status: 'overdue', voidedAt: undefined, due: '2026-07-01' }, TODAY), 'sent');
  assert.equal(effectiveInvoiceStatus({ status: 'sent', voidedAt: undefined, due: '2026-07-01' }, TODAY), 'sent');
});

test('open receivables/payables exclude draft, paid and voided', () => {
  assert.equal(isOpenReceivable({ status: 'sent', voidedAt: undefined }), true);
  assert.equal(isOpenReceivable({ status: 'overdue', voidedAt: undefined }), true);
  assert.equal(isOpenReceivable({ status: 'draft', voidedAt: undefined }), false);
  assert.equal(isOpenReceivable({ status: 'sent', voidedAt: 'x' }), false);
  assert.equal(isOpenPayable({ status: 'unpaid' }), true);
  assert.equal(isOpenPayable({ status: 'scheduled' }), true);
  assert.equal(isOpenPayable({ status: 'paid' }), false);
});

test('quote expiry is derived from validUntil (delegates to quotes.ts)', () => {
  assert.equal(effectiveQuoteStatus({ status: 'sent', validUntil: '2026-06-01' }, TODAY), 'expired');
  assert.equal(effectiveQuoteStatus({ status: 'sent', validUntil: '2026-07-01' }, TODAY), 'sent');
  assert.equal(effectiveQuoteStatus({ status: 'accepted', validUntil: '2026-06-01' }, TODAY), 'accepted');
  assert.equal(effectiveQuoteStatus({ status: 'converted', validUntil: '2026-06-01' }, TODAY), 'converted');
});

test('invite expiry is derived from expiresAt', () => {
  assert.equal(effectiveInviteStatus({ status: 'pending', expiresAt: '2026-06-01' }, TODAY), 'expired');
  assert.equal(effectiveInviteStatus({ status: 'pending', expiresAt: '2026-07-01' }, TODAY), 'pending');
  assert.equal(effectiveInviteStatus({ status: 'accepted', expiresAt: '2026-06-01' }, TODAY), 'accepted');
});

test('the prompt cheat-sheet names the derived states so agents do not set them', () => {
  const p = lifecyclePrompt();
  assert.match(p, /overdue.*DERIVED/i);
  assert.match(p, /won\|lost/);
  assert.match(p, /ticket/i);
});
