import type { Approval, ApprovalHistory } from './data';

/**
 * Approval chains: who decides, who they handed it to, and what happens when
 * nobody decides in time. Pure; the store applies it to the queue, and a cron
 * sweep escalates the overdue. Single-user honest: the "team" is names from
 * the roster — delegation is an explicit, history-trailed hand-off, and
 * escalation raises an urgent notice so nothing waits silently.
 */

export function currentHolder(a: Pick<Approval, 'assignee' | 'delegatedTo'>): string | null {
  return (a.delegatedTo ?? '').trim() || (a.assignee ?? '').trim() || null;
}

function stamp(by: string, action: ApprovalHistory['action'], note?: string): ApprovalHistory {
  return { at: new Date().toISOString(), by, action, ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}) };
}

/**
 * Hand a pending approval to someone else. Only the current holder (or the
 * owner when nobody is assigned) may delegate; the chain stays pending and
 * the hand is recorded. Returns the updated approval or an error message.
 */
export function delegate(
  a: Approval,
  from: string,
  to: string,
  note?: string,
  opts: { ownerOverride?: boolean } = {},
): { approval?: Approval; error?: string } {
  if (a.status !== 'pending') return { error: 'Only pending approvals can be delegated.' };
  const holder = currentHolder(a);
  const who = from.trim();
  if (!who) return { error: 'Name who is handing it over.' };
  if (holder && holder.toLowerCase() !== who.toLowerCase() && !opts.ownerOverride) {
    return { error: `${holder} holds this approval, not ${who}.` };
  }
  const dest = to.trim();
  if (!dest) return { error: 'Name who it goes to.' };
  if (holder && dest.toLowerCase() === holder.toLowerCase()) return { error: 'It is already theirs.' };
  return {
    approval: {
      ...a,
      delegatedTo: dest,
      history: [...(a.history ?? []), stamp(opts.ownerOverride && holder && holder.toLowerCase() !== who.toLowerCase() ? `${who} (owner)` : who, 'delegated', note || `Handed to ${dest}`)],
    },
  };
}

export type Decision = 'approved' | 'rejected';

/**
 * Decide a pending approval. The current holder (or the owner when nobody is
 * assigned) decides; anyone else is refused with the holder's name. Records
 * the decision in history. Executing the gated action (payment, send, …)
 * stays with the caller — this only moves the state.
 */
export function decide(
  a: Approval,
  by: string,
  decision: Decision,
  note?: string,
  opts: { ownerOverride?: boolean } = {},
): { approval?: Approval; error?: string } {
  if (a.status !== 'pending') return { error: `Already ${a.status}.` };
  const holder = currentHolder(a);
  const who = by.trim();
  if (!who) return { error: 'Name who decides.' };
  const override = !!holder && holder.toLowerCase() !== who.toLowerCase() && opts.ownerOverride;
  if (holder && holder.toLowerCase() !== who.toLowerCase() && !opts.ownerOverride) {
    return { error: `Waiting on ${holder}, not ${who}.` };
  }
  return {
    approval: {
      ...a,
      status: decision,
      history: [...(a.history ?? []), stamp(override ? `${who} (owner)` : who, decision, note)],
    },
  };
}

/** Past due and still pending with somewhere to escalate to. */
export function escalationDue(a: Approval, nowMs: number = Date.now()): boolean {
  if (a.status !== 'pending' || a.escalatedAt) return false;
  if (!(a.escalateTo ?? '').trim() || !a.dueAt) return false;
  const due = Date.parse(a.dueAt);
  return Number.isFinite(due) && due <= nowMs;
}

/** Escalate once: the holder becomes escalateTo, recorded in history. Idempotent via escalatedAt. */
export function escalate(a: Approval, now: Date = new Date()): Approval | null {
  if (!escalationDue(a, now.getTime())) return null;
  const to = (a.escalateTo ?? '').trim();
  return {
    ...a,
    delegatedTo: to,
    escalatedAt: now.toISOString(),
    history: [...(a.history ?? []), { at: now.toISOString(), by: 'system', action: 'escalated', note: `Undecided past ${a.dueAt}; moved to ${to}` }],
  };
}
