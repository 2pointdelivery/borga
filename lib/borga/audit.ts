import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';

/**
 * Workspace save audit: who saved what, when, at which version. Best effort
 * and never in the way — appended fire-and-forget after a successful data
 * save, capped so the row stays small. Answers "did my edit land, and what
 * changed while I was away" without reading the whole database.
 */

export interface AuditEntry {
  at: string;
  entity: string;
  version: number | null;
  by: string;
}

const MAX_AUDIT = 200;

export const auditKey = (u: string, ws: string): string => `t::${u}::${ws}::audit`;

export async function appendAudit(u: string, ws: string, entity: string, version: number | null): Promise<void> {
  const cur = (await getBorgaState<AuditEntry[]>(auditKey(u, ws)).catch(() => null)) ?? [];
  const entry: AuditEntry = { at: new Date().toISOString(), entity, version, by: u };
  await setBorgaState(auditKey(u, ws), [entry, ...cur].slice(0, MAX_AUDIT)).catch(() => false);
}

export async function readAudit(u: string, ws: string): Promise<AuditEntry[]> {
  return (await getBorgaState<AuditEntry[]>(auditKey(u, ws)).catch(() => null)) ?? [];
}
