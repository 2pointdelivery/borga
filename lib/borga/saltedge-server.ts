import 'server-only';
import { createHash } from 'node:crypto';
import { getBorgaState, setBorgaState } from './persistence';
import { getConnection } from './connections-server';
import {
  createConnectSession, createSaltEdgeClient, ensureCustomer, fetchFeed, listConnections, refreshConnection, removeConnection, showConnection, validReturnUrl,
  SaltEdgeError, type BankFeed, type SaltEdgeClient,
} from './saltedge';

/**
 * Salt Edge for one company. Credentials are the company's own (Connections, encrypted) or, failing that, the deployment's
 * (SALTEDGE_APP_ID, SALTEDGE_SECRET). The company's bank data is fetched here with those credentials and handed to the dashboard
 * as a plain feed; the dashboard merges it into the bank accounts and statement lines it already owns, so this file never writes them.
 */

interface StoredConnection {
  id: string;
  institution: string;
  providerCode?: string;
  status?: string;
  connectedAt: string;
  lastSyncAt?: string;
  fromDate: string;
  accounts: number;
}

interface SaltEdgeState {
  customerId?: string;
  /** The date the last connect session asked the bank to go back to. */
  pendingFromDate?: string;
  connections: StoredConnection[];
}

const stateKey = (u: string, ws: string) => `t::${u}::${ws}::saltedge`;
const load = async (u: string, ws: string): Promise<SaltEdgeState> => (await getBorgaState<SaltEdgeState>(stateKey(u, ws))) ?? { connections: [] };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export class SaltEdgeUserError extends Error {}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface ResolvedCredentials {
  appId: string;
  secret: string;
  privateKeyPem?: string;
  source: 'workspace' | 'platform';
}

export async function resolveCredentials(u: string, ws: string): Promise<ResolvedCredentials | null> {
  const own = await getConnection(u, ws, 'saltedge');
  const pem = (process.env.SALTEDGE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n') || undefined;
  if (own?.appId && own.secret) return { appId: own.appId, secret: own.secret, privateKeyPem: pem, source: 'workspace' };
  const appId = (process.env.SALTEDGE_APP_ID ?? '').trim();
  const secret = (process.env.SALTEDGE_SECRET ?? '').trim();
  return appId && secret ? { appId, secret, privateKeyPem: pem, source: 'platform' } : null;
}

async function clientFor(u: string, ws: string, inject?: SaltEdgeClient): Promise<SaltEdgeClient> {
  if (inject) return inject;
  const c = await resolveCredentials(u, ws);
  if (!c) throw new SaltEdgeUserError('Salt Edge is not set up. Add your App ID and Secret under Connections first.');
  // a stand-in server (scripts/fake-saltedge.mjs) for development; never honoured in production, so no setting can send real credentials elsewhere
  const base = process.env.NODE_ENV !== 'production' ? (process.env.SALTEDGE_BASE_URL ?? '').trim() || undefined : undefined;
  return createSaltEdgeClient(c, { base });
}

export async function saltEdgeStatus(u: string, ws: string) {
  const [creds, state] = await Promise.all([resolveCredentials(u, ws), load(u, ws)]);
  return {
    configured: !!creds,
    source: creds?.source ?? null,
    signed: !!creds?.privateKeyPem,
    testBanks: process.env.SALTEDGE_FAKE_PROVIDERS === 'true',
    connections: state.connections,
  };
}

/** Salt Edge's own record of this company. The identifier is ours and stable but reveals nothing about the account. */
const identifierFor = (u: string, ws: string) => `borga-${createHash('sha256').update(`${u}:${ws}`).digest('hex').slice(0, 24)}`;

export interface ConnectOptions {
  returnTo: string;
  daysBack?: number;
  countryCode?: string;
  providerCode?: string;
  locale?: string;
}

export async function startConnect(u: string, ws: string, o: ConnectOptions, inject?: SaltEdgeClient): Promise<{ connectUrl: string; expiresAt?: string }> {
  if (!validReturnUrl(o.returnTo)) throw new SaltEdgeUserError('The return address must be https (or localhost).');
  const client = await clientFor(u, ws, inject);
  const state = await load(u, ws);
  const customerId = state.customerId ?? (await ensureCustomer(client, identifierFor(u, ws)));
  const days = Math.min(730, Math.max(1, Math.floor(o.daysBack ?? 90)));
  const fromDate = isoDay(Date.now() - days * 86_400_000);
  const session = await createConnectSession(client, {
    customerId, returnTo: o.returnTo, fromDate, locale: o.locale?.slice(0, 5) ?? 'en',
    providerCode: o.providerCode && /^[a-z0-9_]{2,80}$/.test(o.providerCode) ? o.providerCode : undefined,
    countryCode: o.countryCode && /^[A-Za-z]{2}$/.test(o.countryCode) ? o.countryCode.toUpperCase() : undefined,
    includeFakeProviders: process.env.SALTEDGE_FAKE_PROVIDERS === 'true',
    customFields: { workspace: ws },
  });
  await setBorgaState(stateKey(u, ws), { ...state, customerId, pendingFromDate: fromDate });
  return session;
}

export interface CompletedConnect {
  feed: BankFeed;
  connection: StoredConnection;
}

/** The user is back from the bank. Find the connection they just made, from Salt Edge, and read its accounts and transactions. */
export async function completeConnect(u: string, ws: string, o: { connectionId?: string; currency: string }, inject?: SaltEdgeClient): Promise<CompletedConnect> {
  if (o.connectionId !== undefined && !ID.test(o.connectionId)) throw new SaltEdgeUserError('That connection id is not valid.');
  const client = await clientFor(u, ws, inject);
  const state = await load(u, ws);
  if (!state.customerId) throw new SaltEdgeUserError('No bank connection was started for this company.');
  const theirs = await listConnections(client, state.customerId);
  // never trust the id in the address bar: it must be one of this company's own connections at Salt Edge
  const conn = (o.connectionId && theirs.find((c) => String(c.id) === o.connectionId)) || (!o.connectionId ? theirs.filter((c) => !state.connections.some((s) => s.id === String(c.id))).pop() ?? theirs[theirs.length - 1] : undefined);
  if (!conn) throw new SaltEdgeUserError('Salt Edge has no such connection for this company yet. If you just signed in to your bank, wait a moment and try again.');
  if (conn.status && !['active'].includes(String(conn.status).toLowerCase())) {
    throw new SaltEdgeUserError(`The connection to ${conn.provider_name ?? 'the bank'} is ${conn.status}. Connect the bank again.`);
  }
  const fromDate = state.pendingFromDate ?? isoDay(Date.now() - 90 * 86_400_000);
  const feed = await fetchFeed(client, { id: String(conn.id), provider_name: conn.provider_name }, o.currency, fromDate);
  const record: StoredConnection = {
    id: String(conn.id), institution: feed.institution, providerCode: conn.provider_code, status: conn.status, connectedAt: new Date().toISOString(),
    lastSyncAt: new Date().toISOString(), fromDate, accounts: feed.accounts.length,
  };
  await setBorgaState(stateKey(u, ws), { ...state, connections: [...state.connections.filter((c) => c.id !== record.id), record] });
  return { feed, connection: record };
}

/** Ask the bank for newer data, then read what Salt Edge has. New data from the refresh shows up on the next sync. */
export async function syncConnection(u: string, ws: string, o: { connectionId: string; currency: string }, inject?: SaltEdgeClient): Promise<CompletedConnect & { refresh: { ok: boolean; message?: string } }> {
  if (!ID.test(o.connectionId)) throw new SaltEdgeUserError('That connection id is not valid.');
  const state = await load(u, ws);
  const rec = state.connections.find((c) => c.id === o.connectionId);
  if (!rec) throw new SaltEdgeUserError('That bank is not connected for this company.');
  const client = await clientFor(u, ws, inject);
  const live = await showConnection(client, rec.id);
  if (live.status && String(live.status).toLowerCase() !== 'active') {
    throw new SaltEdgeUserError(`The connection to ${rec.institution} is ${live.status}: it needs the user to sign in to the bank again.`);
  }
  const refresh = await refreshConnection(client, rec.id);
  // read a little before the last sync, so a transaction the bank posted late is not missed (lines already imported are skipped by id)
  const since = rec.lastSyncAt ? isoDay(Date.parse(rec.lastSyncAt) - 14 * 86_400_000) : rec.fromDate;
  const feed = await fetchFeed(client, { id: rec.id, provider_name: rec.institution }, o.currency, since < rec.fromDate ? rec.fromDate : since);
  const updated: StoredConnection = { ...rec, status: live.status, lastSyncAt: new Date().toISOString(), accounts: feed.accounts.length };
  await setBorgaState(stateKey(u, ws), { ...state, connections: state.connections.map((c) => (c.id === rec.id ? updated : c)) });
  return { feed, connection: updated, refresh };
}

export async function disconnectBank(u: string, ws: string, connectionId: string, inject?: SaltEdgeClient): Promise<void> {
  if (!ID.test(connectionId)) throw new SaltEdgeUserError('That connection id is not valid.');
  const state = await load(u, ws);
  if (!state.connections.some((c) => c.id === connectionId)) throw new SaltEdgeUserError('That bank is not connected for this company.');
  const client = await clientFor(u, ws, inject);
  await removeConnection(client, connectionId);
  await setBorgaState(stateKey(u, ws), { ...state, connections: state.connections.filter((c) => c.id !== connectionId) });
}

/** A message safe to show: Salt Edge errors carry a readable message, anything else is ours. */
export function userMessage(e: unknown): { status: number; message: string } {
  if (e instanceof SaltEdgeUserError) return { status: 400, message: e.message };
  if (e instanceof SaltEdgeError) return { status: e.status === 401 || e.status === 403 ? 502 : 502, message: `Salt Edge: ${e.message}${e.requestId ? ` (request ${e.requestId})` : ''}` };
  return { status: 502, message: 'Could not reach Salt Edge. Try again in a moment.' };
}
