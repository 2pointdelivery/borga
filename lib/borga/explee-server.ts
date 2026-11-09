import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { getConnection } from './connections-server';
import { userWsKey } from './keys';
import { loadSettings } from './heartbeat-settings';
import { assignOwner } from './lead-assign';
import { addNotice } from './notices';
import type { Lead, ProactiveNotice } from './data';
import {
  EXPLEE_MAX_PAGES, expleeHeaders, hotLeadsUrl,
  parseHotLeads, hotLeadToLead, mergeHotLeads, nextCursor, type ExpleeHotLead,
} from './explee-core';

/**
 * Explee hot-lead sync, server side: fetch the feed with the workspace's own
 * credentials (or the deployment-wide EXPLEE_API_KEY fallback), merge every new
 * hot lead into the pipeline, remember the newest became_hot_at as the `since`
 * cursor, and post a notice when leads land. The sync job in sync-registry.ts
 * runs this every 10 minutes; the browser tick and the cron endpoint both
 * drive that job so a locally-run workspace syncs while the dashboard is open.
 */

const FETCH_TIMEOUT_MS = 15_000;
const cursorKey = (u: string, ws: string) => `t::${u}::${ws}::explee::cursor`;

export interface ExpleeCredentials {
  apiKey: string;
  projectId?: string;
  source: 'workspace' | 'platform';
}

/** Workspace connection first; the deployment-wide env key is the fallback (same pattern as Salt Edge). */
export async function resolveExpleeCredentials(u: string, ws: string): Promise<ExpleeCredentials | null> {
  const own = await getConnection(u, ws, 'explee');
  if (own?.apiKey) return { apiKey: own.apiKey, projectId: own.projectId, source: 'workspace' };
  const apiKey = (process.env.EXPLEE_API_KEY ?? '').trim();
  return apiKey ? { apiKey, projectId: (process.env.EXPLEE_PROJECT_ID ?? '').trim() || undefined, source: 'platform' } : null;
}

function httpError(status: number): string {
  if (status === 401 || status === 403) return `Explee rejected the API key (HTTP ${status}).`;
  if (status === 429) return 'Explee is rate limiting us (HTTP 429). Try again shortly.';
  return `Explee answered HTTP ${status}.`;
}

export type HotLeadsFetch =
  | { ok: true; leads: ExpleeHotLead[]; hasMore: boolean; nextOffset: number | null }
  | { ok: false; error: string; status?: number };

/** One page of the feed. `since` (the stored cursor) limits it to newly-hot leads. */
export async function fetchHotLeads(apiKey: string, since: string | null, offset = 0, f: typeof fetch = fetch): Promise<HotLeadsFetch> {
  try {
    const res = await f(hotLeadsUrl(since, offset), { headers: expleeHeaders(apiKey), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, status: res.status, error: httpError(res.status) };
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { ok: false, error: 'Explee did not return JSON.' };
    }
    const parsed = parseHotLeads(json);
    return { ok: true, ...parsed };
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.name === 'TimeoutError' ? 'Explee did not answer within 15 seconds.' : err.message };
  }
}

/** Connection test: prove the key, and the project id when one was saved. (Lives in provider-tests.ts with the other live checks.) */

export interface ExpleeSyncResult {
  ran: boolean;
  skipped?: string;
  added?: number;
  updated?: number;
  cursor?: string | null;
}

function noticeForAdded(added: number, names: string[], at: string): ProactiveNotice {
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
  return {
    id: `n-explee-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: added === 1 ? 'New hot lead from Explee' : `${added} new hot leads from Explee`,
    body: shown ? `${shown} ${added === 1 ? 'is' : 'are'} now in the sales pipeline.` : 'They are now in the sales pipeline.',
    severity: 'info',
    source: 'scheduler',
    createdAt: at,
    readAt: null,
  };
}

/**
 * One sync pass for one workspace. The cursor only advances after the merge
 * succeeds, so a failed run refetches the same window — and the crmId/e-mail
 * matching in mergeHotLeads makes even a double-import a no-op, never a duplicate.
 */
export async function runExpleeSync(u: string, ws: string): Promise<ExpleeSyncResult> {
  const creds = await resolveExpleeCredentials(u, ws);
  if (!creds) return { ran: false, skipped: 'Explee is not connected yet.' };

  const since = (await getBorgaState<string>(cursorKey(u, ws))) ?? null;
  const batch: ExpleeHotLead[] = [];
  let hasMore = true;
  let offset = 0;
  for (let page = 0; hasMore && page < EXPLEE_MAX_PAGES; page++) {
    const r = await fetchHotLeads(creds.apiKey, since, offset);
    if (!r.ok) throw new Error(r.error);
    batch.push(...r.leads);
    hasMore = r.hasMore;
    offset = r.nextOffset ?? 0;
  }

  if (batch.length) {
    const settings = await loadSettings(ws, u);
    const rules = settings?.leadAssignmentRules ?? [];
    const existing = (await getBorgaState<Lead[]>(userWsKey(u, ws, 'leads'))) ?? [];
    const nowIso = new Date().toISOString();
    const incoming = batch
      .map((h) => hotLeadToLead(h, nowIso, { ownerId: assignOwner(rules, { stage: 'qualified', source: 'Explee', value: 0 }, existing) ?? 'a-sales' }))
      .filter((l): l is Lead => l !== null);
    const { next, summary } = mergeHotLeads(existing, incoming);
    if (summary.added || summary.updated) {
      await setBorgaState(userWsKey(u, ws, 'leads'), next);
      if (summary.added) {
        const addedSet = new Set(summary.addedIds);
        const names = incoming.filter((l) => addedSet.has(l.id)).map((l) => l.company || l.name);
        await addNotice(noticeForAdded(summary.added, names, nowIso), ws, u);
      }
    }
    const cursor = nextCursor(batch, since);
    if (cursor !== since) await setBorgaState(cursorKey(u, ws), cursor);
    return { ran: true, added: summary.added, updated: summary.updated, cursor };
  }

  return { ran: true, added: 0, updated: 0, cursor: since };
}
