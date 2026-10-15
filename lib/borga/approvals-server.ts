import 'server-only';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { addNotice } from './notices';
import { escalate } from './approval-chain';
import type { Approval } from './data';

/**
 * Approval escalation sweep: pending approvals past their due date move to
 * their escalation target once, with an urgent notice so the wait is visible.
 * Runs from cron (all workspaces with approvals) and on demand from the
 * scheduler's `escalations` action.
 */

const approvalsKey = (u: string, ws: string): string => userWsKey(u, ws, 'approvals');

export async function listApprovalWorkspaces(): Promise<Array<{ userId: string; ws: string }>> {
  const keys = await listBorgaKeys('u::%::ws::%::approvals').catch(() => []);
  const out: Array<{ userId: string; ws: string }> = [];
  for (const k of keys) {
    const m = /^u::([^:]+)::ws::([^:]+)::approvals$/.exec(k);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}

export interface EscalationResult {
  checked: number;
  escalated: Array<{ id: string; title: string; to: string }>;
}

/** Escalate overdue pending approvals once each. Never throws. */
export async function sweepApprovalEscalations(u: string, ws: string, now: Date = new Date()): Promise<EscalationResult> {
  const out: EscalationResult = { checked: 0, escalated: [] };
  try {
    const approvals = (await getBorgaState<Approval[]>(approvalsKey(u, ws)).catch(() => null)) ?? [];
    out.checked = approvals.filter((a) => a.status === 'pending').length;
    let changed = false;
    const next = approvals.map((a) => {
      const e = escalate(a, now);
      if (!e) return a;
      changed = true;
      out.escalated.push({ id: e.id, title: e.title, to: (e.escalateTo ?? '').trim() });
      return e;
    });
    if (!changed) return out;
    await setBorgaState(approvalsKey(u, ws), next).catch(() => false);
    for (const e of out.escalated) {
      await addNotice(
        {
          id: `n-escalate-${e.id}-${now.getTime()}`,
          title: `Approval escalated — ${e.title}`,
          body: `Undecided past its due date, so it moved to ${e.to}.`,
          severity: 'urgent',
          source: 'scheduler',
          createdAt: now.toISOString(),
          readAt: null,
        },
        ws,
        u,
      ).catch(() => undefined);
    }
  } catch (e) {
    console.error('[approvals] escalation sweep failed', (e as Error).message);
  }
  return out;
}
