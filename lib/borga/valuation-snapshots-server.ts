import 'server-only';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { userWsKey, userWorkspacesKey } from './keys';
import { loadFeatures } from './features-server';
import { deriveValuation, type FinanceEntry, type KnowledgeEntry, type ValuationConfig, type Workspace } from './data';
import { EMPTY_SNAPSHOTS, monthSnapshotted, takeSnapshot, type ValuationSnapshot } from './valuation-history';

/** Every workspace with a valuation snapshot store (keys only, not every row's JSON). */
export async function listValuationWorkspaces(): Promise<Array<{ userId: string; ws: string }>> {
  const out: Array<{ userId: string; ws: string }> = [];
  for (const k of await listBorgaKeys('u::%::ws::%::valuationSnapshots')) {
    const m = /^u::([^:]+)::ws::([^:]+)::valuationSnapshots$/.exec(k);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}

/** Monthly cron: one snapshot per workspace per calendar month, from live derived FMV. */
export async function sweepValuationSnapshots(): Promise<Record<string, unknown>> {
  const done: Record<string, unknown> = {};
  for (const t of await listValuationWorkspaces()) {
    try {
      if (!(await loadFeatures(t.userId, t.ws)).flags.valuation) continue;
      const key = userWsKey(t.userId, t.ws, 'valuationSnapshots');
      const existing = (await getBorgaState<ValuationSnapshot[]>(key)) ?? EMPTY_SNAPSHOTS;
      if (monthSnapshotted(existing)) { done[`${t.userId}/${t.ws}`] = { skipped: 'already snapshotted this month' }; continue; }
      const finance = (await getBorgaState<FinanceEntry[]>(userWsKey(t.userId, t.ws, 'finance'))) ?? [];
      const knowledge = (await getBorgaState<KnowledgeEntry[]>(userWsKey(t.userId, t.ws, 'knowledge'))) ?? [];
      const config = (await getBorgaState<ValuationConfig>(userWsKey(t.userId, t.ws, 'valuation'))) ?? null;
      const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(t.userId))) ?? [];
      const snap = takeSnapshot(deriveValuation(finance, knowledge, workspaces.find((w) => w.id === t.ws) ?? null, config), 'cron');
      await setBorgaState(key, [snap, ...existing].slice(0, 120));
      done[`${t.userId}/${t.ws}`] = { saved: snap.at };
    } catch (e) {
      done[`${t.userId}/${t.ws}`] = { ok: false, error: (e as Error).message };
    }
  }
  return done;
}
