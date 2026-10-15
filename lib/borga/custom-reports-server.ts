import 'server-only';
import { randomBytes } from 'crypto';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { hashApiKey, safeEqual } from './api-keys';
import { datasetOf, newCustomReportId, runCustomReport, validateCustomReport, type CustomReport, type ReportResult } from './custom-report';
import { defaultPortalExpiry } from './portal-core';

/**
 * Custom reports: per-workspace definitions + server-side execution (the
 * share links run them read-only) + share tokens minted like the client
 * portal (secret shown once, hash stored, revocable, expiring).
 */

const reportsKey = (u: string, ws: string): string => userWsKey(u, ws, 'customReports');
const shareKey = (u: string, ws: string): string => userWsKey(u, ws, 'shareTokens');

export async function loadCustomReports(u: string, ws: string): Promise<CustomReport[]> {
  const raw = (await getBorgaState<CustomReport[]>(reportsKey(u, ws)).catch(() => null)) ?? [];
  return raw.filter((r) => r && typeof r.id === 'string' && datasetOf(r.dataset));
}

export async function putCustomReport(u: string, ws: string, input: Partial<CustomReport> & { id?: string }): Promise<{ report?: CustomReport; errors?: string[] }> {
  const errors = validateCustomReport(input);
  if (errors.length) return { errors };
  const list = await loadCustomReports(u, ws);
  const now = new Date().toISOString();
  const id = typeof input.id === 'string' && input.id ? input.id : newCustomReportId();
  const prev = list.find((r) => r.id === id);
  const report: CustomReport = {
    id,
    name: input.name!.trim().slice(0, 80),
    dataset: input.dataset!,
    columns: input.columns ?? [],
    filters: input.filters ?? [],
    groupBy: input.groupBy,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  const next = prev ? list.map((r) => (r.id === id ? report : r)) : [...list, report];
  if (!(await setBorgaState(reportsKey(u, ws), next).catch(() => false))) return { errors: ['Could not save (database unavailable).'] };
  return { report };
}

export async function deleteCustomReport(u: string, ws: string, id: string): Promise<boolean> {
  const list = await loadCustomReports(u, ws);
  if (!list.some((r) => r.id === id)) return false;
  const ok = await setBorgaState(reportsKey(u, ws), list.filter((r) => r.id !== id)).catch(() => false);
  // Its share links die with it.
  const shares = (await getBorgaState<ShareTokenRow[]>(shareKey(u, ws)).catch(() => null)) ?? [];
  const live = shares.filter((t) => t.reportId !== id);
  if (live.length !== shares.length) await setBorgaState(shareKey(u, ws), live).catch(() => false);
  return ok;
}

/** Runs a report against the workspace's persisted data. Tickets live in their own rows, not the entity store. */
export async function runReportServer(u: string, ws: string, report: CustomReport): Promise<ReportResult | null> {
  const ds = datasetOf(report.dataset);
  if (!ds) return null;
  let rows: Array<Record<string, unknown>>;
  if (ds.id === 'tickets') {
    const { listTickets } = await import('./tickets-server');
    rows = (await listTickets(u, ws).catch(() => [])) as unknown as Array<Record<string, unknown>>;
  } else {
    rows = (await getBorgaState<Array<Record<string, unknown>>>(userWsKey(u, ws, ds.entity)).catch(() => null)) ?? [];
  }
  return runCustomReport(report, rows);
}

// ---------------------------------------------------------------------------
// Share links (minted like client-portal tokens)

export const SHARE_TOKEN_PREFIX = 'bst_';

export interface ShareTokenRow {
  id: string;
  reportId: string;
  reportName: string;
  hash: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export type ShareTokenPublic = Omit<ShareTokenRow, 'hash'>;

export async function mintShareLink(u: string, ws: string, reportId: string): Promise<{ record: ShareTokenPublic; secret: string } | { error: string }> {
  const reports = await loadCustomReports(u, ws);
  const report = reports.find((r) => r.id === reportId);
  if (!report) return { error: 'Report not found.' };
  const secret = `${SHARE_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  const now = new Date().toISOString();
  const record: ShareTokenRow = {
    id: `st-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    reportId,
    reportName: report.name,
    hash: hashApiKey(secret),
    prefix: `${secret.slice(0, 12)}…${secret.slice(-4)}`,
    createdAt: now,
    expiresAt: defaultPortalExpiry(),
    revokedAt: null,
  };
  const all = (await getBorgaState<ShareTokenRow[]>(shareKey(u, ws)).catch(() => null)) ?? [];
  await setBorgaState(shareKey(u, ws), [...all, record]);
  const { hash: _h, ...pub } = record;
  return { record: pub, secret };
}

export async function revokeShareLink(u: string, ws: string, id: string): Promise<boolean> {
  const all = (await getBorgaState<ShareTokenRow[]>(shareKey(u, ws)).catch(() => null)) ?? [];
  const ix = all.findIndex((t) => t.id === id);
  if (ix < 0 || all[ix].revokedAt) return false;
  all[ix] = { ...all[ix], revokedAt: new Date().toISOString() };
  await setBorgaState(shareKey(u, ws), all);
  return true;
}

export async function listShareLinks(u: string, ws: string): Promise<ShareTokenPublic[]> {
  const all = (await getBorgaState<ShareTokenRow[]>(shareKey(u, ws)).catch(() => null)) ?? [];
  return all.map(({ hash: _h, ...pub }) => pub);
}

export interface ShareBinding {
  userId: string;
  ws: string;
  token: ShareTokenRow;
}

/** Resolve a presented share token. Unknown, revoked and expired all look identical (null). */
export async function verifyShareToken(secret: string, nowIso: string = new Date().toISOString()): Promise<ShareBinding | null> {
  if (!secret.startsWith(SHARE_TOKEN_PREFIX) || secret.length < SHARE_TOKEN_PREFIX.length + 32) return null;
  const wanted = hashApiKey(secret);
  for (const k of await listBorgaKeys('u::%::ws::%::shareTokens').catch(() => [] as string[])) {
    const m = /^u::([^:]+)::ws::([^:]+)::shareTokens$/.exec(k);
    if (!m) continue;
    const rows = (await getBorgaState<ShareTokenRow[]>(k).catch(() => null)) ?? [];
    for (const r of rows) {
      if (!safeEqual(r.hash, wanted) || r.revokedAt || (r.expiresAt && r.expiresAt < nowIso.slice(0, 10))) continue;
      return { userId: m[1], ws: m[2], token: r };
    }
  }
  return null;
}

/** Read-only execution for a share link: the report's rows, never the definition's owner data. */
export async function runSharedReport(b: ShareBinding): Promise<{ reportName: string; result: ReportResult } | null> {
  const reports = await loadCustomReports(b.userId, b.ws);
  const report = reports.find((r) => r.id === b.token.reportId);
  if (!report) return null;
  const result = await runReportServer(b.userId, b.ws, report);
  if (!result) return null;
  return { reportName: report.name, result };
}
