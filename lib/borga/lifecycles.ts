/**
 * Company lifecycles — the single, pure source of truth for how each record
 * moves between states, and for the states that are DERIVED rather than stored.
 *
 * Why this exists: before this module the app kept the same knowledge in
 * dozens of places — `status === 'overdue'` here, `due < today` there, ticket
 * transitions in tickets-server.ts, quote expiry in quotes.ts — so an AI agent
 * could move a `won` lead back to `new`, the browser and the cron disagreed
 * about which invoices were overdue, and there was no one place to change a
 * rule. Everything below is pure (no I/O, isomorphic), so the browser, the
 * server and the agent runtime all read the exact same table.
 *
 * Compatibility rule: unknown kinds and unknown "from" states are allowed
 * (returned as `undefined` / `true`), so legacy rows and future fields never
 * get blocked by a table the code has not learned yet.
 */

import type { Invoice, InvoiceStatus, Bill, InviteStatus } from './data';
import { TRANSITIONS as TICKET_TRANSITIONS } from './tickets';
import { isExpired as quoteIsExpired, type Quote, type QuoteStatus } from './quotes';

export type LifecycleKind =
  | 'invoice' | 'bill' | 'quote' | 'task' | 'lead'
  | 'booking' | 'approval' | 'ticket' | 'invite';

export interface Lifecycle {
  /** Every state the record may hold, in rough chronological order. */
  states: readonly string[];
  /** Allowed one-step moves: from → the states it may become. */
  transitions: Record<string, readonly string[]>;
  /** States from which no further move is expected (reopen still validated). */
  terminal: readonly string[];
}

const INVOICE: Lifecycle = {
  states: ['draft', 'sent', 'overdue', 'paid'],
  transitions: {
    draft: ['sent'],
    sent: ['paid', 'overdue'],
    // `overdue` is normally DERIVED (see effectiveInvoiceStatus); a row may
    // still carry it explicitly, and from there it only settles to `paid`.
    overdue: ['paid'],
    paid: [],
  },
  terminal: ['paid'],
};

const BILL: Lifecycle = {
  states: ['unpaid', 'scheduled', 'paid'],
  transitions: { unpaid: ['scheduled', 'paid'], scheduled: ['paid'], paid: [] },
  terminal: ['paid'],
};

const QUOTE: Lifecycle = {
  states: ['draft', 'sent', 'accepted', 'expired', 'converted'],
  transitions: {
    draft: ['sent'],
    sent: ['accepted', 'expired', 'converted'],
    accepted: ['converted'],
    expired: [],
    converted: [],
  },
  terminal: ['converted'],
};

const TASK: Lifecycle = {
  states: ['todo', 'in-progress', 'done'],
  // Reopening is legitimate (a done task that needs more work), but a task may
  // never skip straight past in-progress into done from nowhere, and done is
  // the only "finished" state.
  transitions: { todo: ['in-progress', 'done'], 'in-progress': ['todo', 'done'], done: ['todo', 'in-progress'] },
  terminal: [],
};

const LEAD: Lifecycle = {
  states: ['new', 'qualified', 'proposal', 'won', 'lost'],
  // A won or lost deal does not silently slide back to `new`; reopening means
  // deliberately re-qualifying it.
  transitions: {
    new: ['qualified', 'won', 'lost'],
    qualified: ['proposal', 'won', 'lost'],
    proposal: ['won', 'lost'],
    won: ['qualified'],
    lost: ['qualified'],
  },
  terminal: [],
};

const BOOKING: Lifecycle = {
  states: ['pending', 'confirmed', 'in-transit', 'delivered', 'cancelled'],
  transitions: {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['in-transit', 'cancelled'],
    'in-transit': ['delivered', 'cancelled'],
    delivered: [],
    cancelled: [],
  },
  terminal: ['delivered', 'cancelled'],
};

const APPROVAL: Lifecycle = {
  states: ['pending', 'approved', 'rejected'],
  transitions: { pending: ['approved', 'rejected'], approved: [], rejected: [] },
  terminal: ['approved', 'rejected'],
};

const INVITE: Lifecycle = {
  states: ['pending', 'accepted', 'revoked', 'expired'],
  transitions: { pending: ['accepted', 'revoked', 'expired'], accepted: [], revoked: [], expired: [] },
  terminal: ['accepted', 'revoked', 'expired'],
};

/** Tickets keep their Jira-style table in tickets.ts; this re-exposes it as the single source. */
const TICKET: Lifecycle = {
  states: ['open', 'in-progress', 'pending', 'resolved', 'closed'],
  transitions: TICKET_TRANSITIONS as unknown as Record<string, readonly string[]>,
  terminal: ['closed'],
};

export const LIFECYCLES: Record<LifecycleKind, Lifecycle> = {
  invoice: INVOICE,
  bill: BILL,
  quote: QUOTE,
  task: TASK,
  lead: LEAD,
  booking: BOOKING,
  approval: APPROVAL,
  ticket: TICKET,
  invite: INVITE,
};

/**
 * The states a record may move to next. `undefined` means the kind or the
 * current state is unknown to this module — callers should allow the move.
 */
export function allowedNext(kind: LifecycleKind, from: string): readonly string[] | undefined {
  return LIFECYCLES[kind]?.transitions[from];
}

/** Whether a one-step move is legal. Permissive: unknown kind/state → true; no-op → true. */
export function canTransition(kind: LifecycleKind, from: string, to: string): boolean {
  if (from === to) return true;
  const next = allowedNext(kind, from);
  if (next === undefined) return true;
  return next.includes(to);
}

/** Whether a state is a recognized terminal state for the kind. */
export function isTerminalState(kind: LifecycleKind, state: string): boolean {
  return LIFECYCLES[kind]?.terminal.includes(state) ?? false;
}

// ---------------------------------------------------------------------------
// Derived state — the "virtual" states that are computed from a date, never
// stored. Centralising these is what makes the browser, the cron and the agent
// agree on which invoices are overdue and which quotes have expired.
// ---------------------------------------------------------------------------

const today = (nowIso?: string): string => (nowIso ?? new Date().toISOString()).slice(0, 10);
const dateOnly = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');

/** Invoices/bills that still represent money owed (not draft, not paid, not voided). */
export function isOpenReceivable(inv: Pick<Invoice, 'status' | 'voidedAt'>): boolean {
  return !inv.voidedAt && (inv.status === 'sent' || inv.status === 'overdue');
}

/** Bills that still represent money the company owes. */
export function isOpenPayable(bill: Pick<Bill, 'status'>): boolean {
  return bill.status === 'unpaid' || bill.status === 'scheduled';
}

/**
 * An issued invoice past its due date. Mirrors the automation sweep's rule
 * (lib/borga/automation-core.ts:overdueInvoices): void invoices are never
 * overdue; only `sent`/`overdue` ones qualify; the due day itself is not late.
 */
export function isInvoiceOverdue(inv: Pick<Invoice, 'status' | 'voidedAt' | 'due'>, nowIso?: string): boolean {
  if (!isOpenReceivable(inv)) return false;
  const due = dateOnly(inv.due);
  return !!due && due < today(nowIso);
}

/** Same rule for bills, once they carry a due date. */
export function isBillOverdue(bill: Pick<Bill, 'status' | 'due'>, nowIso?: string): boolean {
  if (!isOpenPayable(bill)) return false;
  const due = dateOnly(bill.due);
  return !!due && due < today(nowIso);
}

/** The status a viewer should see: `overdue` when the date says so, else the stored status. */
export function effectiveInvoiceStatus(inv: Pick<Invoice, 'status' | 'voidedAt' | 'due'>, nowIso?: string): InvoiceStatus {
  if (inv.status === 'paid' || inv.status === 'draft' || inv.voidedAt) return inv.status;
  if (isInvoiceOverdue(inv, nowIso)) return 'overdue';
  // A row stored as `overdue` whose date is not actually past is really `sent`.
  return inv.status === 'overdue' ? 'sent' : inv.status;
}

/** Quote status with `expired` derived from validUntil (quotes.ts:isExpired). */
export function effectiveQuoteStatus(q: Pick<Quote, 'status' | 'validUntil'>, nowIso?: string): QuoteStatus {
  return q.status === 'sent' && quoteIsExpired(q as Quote, today(nowIso)) ? 'expired' : q.status;
}

/** Invite status with `expired` derived from expiresAt. */
export function effectiveInviteStatus(i: { status: InviteStatus; expiresAt?: string }, nowIso?: string): InviteStatus {
  if (i.status !== 'pending') return i.status;
  const exp = dateOnly(i.expiresAt);
  return exp && exp < today(nowIso) ? 'expired' : i.status;
}

/**
 * A compact, model-readable cheat-sheet injected into every agent prompt so
 * the fleet plans inside the same rules the tools enforce (and learns that
 * `overdue`/`expired` are derived, not settable).
 */
export function lifecyclePrompt(): string {
  return [
    '## Lifecycles (valid moves only — the update tools refuse anything else and return the allowed next states)',
    '- Task: todo → in-progress → done (reopening to todo/in-progress is allowed).',
    '- Lead: new → qualified → proposal → won|lost. A won/lost deal may only reopen to qualified, never back to new.',
    '- Ticket: open ↔ in-progress/pending → resolved → closed; a closed ticket reopens to open.',
    '- Invoice: draft → sent → paid. "overdue" is DERIVED from the due date (sent and past due) — never set it by hand.',
    '- Quote: draft → sent → accepted/converted. "expired" is DERIVED from validUntil.',
    '- Bill: unpaid → scheduled → paid. Approval: pending → approved|rejected (final).',
  ].join('\n');
}
