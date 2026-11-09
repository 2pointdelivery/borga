// Salt Edge Account Information API v6 (https://docs.saltedge.com/v6/): the client, and the mapping from what a bank returns to
// what Borga reconciles. Pure apart from the network: `fetch` is injected, so everything here is tested without calling Salt Edge.
//
// How a bank gets connected: we create a Salt Edge "customer" for the company, ask for a connect session (a Salt Edge widget URL),
// the user signs in to their bank there, and Salt Edge sends them back to our `return_to`. We then ask Salt Edge for that
// customer's connections, accounts and transactions with our own credentials, so nothing the browser says is trusted.

import { createSign } from 'node:crypto';

export const SALTEDGE_BASE = 'https://www.saltedge.com/api/v6';

export interface SaltEdgeCredentials {
  appId: string;
  secret: string;
  /** PEM private key: Salt Edge Live clients sign every request with it (the matching public key is uploaded in the Salt Edge dashboard). */
  privateKeyPem?: string;
}

export class SaltEdgeError extends Error {
  constructor(public status: number, public errorClass: string, message: string, public requestId?: string) {
    super(message);
    this.name = 'SaltEdgeError';
  }
}

type Fetch = typeof fetch;

export interface SaltEdgeClient {
  request<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, opts?: { query?: Record<string, string | number | undefined>; body?: unknown }): Promise<T>;
}

/** `expires_at|METHOD|full url|body`, signed with RSA-SHA256 and base64 encoded: how Salt Edge expects a Live client to sign. */
export function signRequest(privateKeyPem: string, expiresAt: number, method: string, url: string, body: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(`${expiresAt}|${method.toUpperCase()}|${url}|${body}`);
  return signer.sign(privateKeyPem, 'base64');
}

export function createSaltEdgeClient(creds: SaltEdgeCredentials, opts: { fetch?: Fetch; now?: () => number; base?: string; timeoutMs?: number } = {}): SaltEdgeClient {
  const f = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const base = opts.base ?? SALTEDGE_BASE;
  return {
    async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, o: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
      const url = new URL(`${base}${path}`);
      for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
      const body = o.body === undefined ? '' : JSON.stringify(o.body);
      const headers: Record<string, string> = { 'App-id': creds.appId, Secret: creds.secret, Accept: 'application/json', 'Content-Type': 'application/json' };
      if (creds.privateKeyPem) {
        const expiresAt = Math.floor(now() / 1000) + 60;
        headers['Expires-at'] = String(expiresAt);
        headers.Signature = signRequest(creds.privateKeyPem, expiresAt, method, url.toString(), body);
      }
      const res = await f(url.toString(), { method, headers, body: body || undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* not JSON */ }
      if (!res.ok) {
        const e = (json.error ?? {}) as { class?: string; message?: string; request_id?: string };
        throw new SaltEdgeError(res.status, e.class ?? `HTTP${res.status}`, e.message ?? `Salt Edge returned HTTP ${res.status}.`, e.request_id);
      }
      return json as T;
    },
  };
}

// ── API shapes (only the fields we use) ───────────────────────────────────────────────────────────────────────────────

export interface SeConnection {
  id: string;
  provider_code?: string;
  provider_name?: string;
  status?: string;
  country_code?: string;
  customer_id?: string;
  last_success_at?: string | null;
  next_refresh_possible_at?: string | null;
}

export interface SeAccount {
  id: string;
  connection_id?: string;
  name?: string;
  nature?: string;
  balance?: number;
  currency_code?: string;
  extra?: { iban?: string; account_number?: string; card_type?: string; client_name?: string; [k: string]: unknown };
}

export interface SeTransaction {
  id: string;
  account_id?: string;
  duplicated?: boolean;
  mode?: string;
  status?: string;
  made_on?: string;
  amount?: number;
  currency_code?: string;
  description?: string;
  category?: string;
  extra?: { payee?: string; payer?: string; posting_date?: string; [k: string]: unknown };
}

interface Page<T> {
  data: T[];
  meta?: { next_id?: string | null; next_page?: string | null };
}

const MAX_PAGES = 60;

async function paginate<T>(client: SaltEdgeClient, path: string, query: Record<string, string | number | undefined>): Promise<T[]> {
  const out: T[] = [];
  let fromId: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await client.request<Page<T>>('GET', path, { query: { ...query, from_id: fromId } });
    out.push(...(Array.isArray(page.data) ? page.data : []));
    const next = page.meta?.next_id;
    if (!next || next === fromId) break;
    fromId = String(next);
  }
  return out;
}

/** The customer for a company. The identifier is ours and stable; if it already exists (a retry, a second server) we look it up. */
export async function ensureCustomer(client: SaltEdgeClient, identifier: string): Promise<string> {
  try {
    const r = await client.request<{ data: { customer_id?: string; id?: string } }>('POST', '/customers', { body: { data: { identifier } } });
    const id = r.data.customer_id ?? r.data.id;
    if (!id) throw new SaltEdgeError(502, 'BadResponse', 'Salt Edge did not return a customer id.');
    return String(id);
  } catch (e) {
    if (!(e instanceof SaltEdgeError) || !/duplicat/i.test(e.errorClass)) throw e;
    const all = await paginate<{ id?: string; customer_id?: string; identifier?: string }>(client, '/customers', {});
    const hit = all.find((c) => c.identifier === identifier);
    if (!hit) throw e;
    return String(hit.customer_id ?? hit.id);
  }
}

export interface ConnectSessionInput {
  customerId: string;
  returnTo: string;
  /** Earliest transaction date to ask the bank for. */
  fromDate: string;
  locale?: string;
  providerCode?: string;
  countryCode?: string;
  /** Show Salt Edge's fake test banks (test clients only). */
  includeFakeProviders?: boolean;
  customFields?: Record<string, string>;
}

export async function createConnectSession(client: SaltEdgeClient, i: ConnectSessionInput): Promise<{ connectUrl: string; expiresAt?: string }> {
  const data: Record<string, unknown> = {
    customer_id: i.customerId,
    consent: { scopes: ['accounts', 'transactions'], from_date: i.fromDate },
    attempt: { fetch_scopes: ['accounts', 'transactions'], return_to: i.returnTo, locale: i.locale ?? 'en', store_credentials: true, ...(i.customFields ? { custom_fields: i.customFields } : {}) },
  };
  if (i.providerCode) data.provider = { code: i.providerCode };
  if (i.countryCode) data.country_code = i.countryCode;
  if (i.includeFakeProviders) data.include_fake_providers = true;
  const r = await client.request<{ data: { connect_url?: string; expires_at?: string } }>('POST', '/connections/connect', { body: { data } });
  if (!r.data.connect_url) throw new SaltEdgeError(502, 'BadResponse', 'Salt Edge did not return a connect URL.');
  return { connectUrl: r.data.connect_url, expiresAt: r.data.expires_at };
}

export const listConnections = (c: SaltEdgeClient, customerId: string) => paginate<SeConnection>(c, '/connections', { customer_id: customerId });
export const listAccounts = (c: SaltEdgeClient, connectionId: string) => paginate<SeAccount>(c, '/accounts', { connection_id: connectionId });
export const listTransactions = (c: SaltEdgeClient, connectionId: string, accountId: string, fromDate?: string) =>
  paginate<SeTransaction>(c, '/transactions', { connection_id: connectionId, account_id: accountId, from_date: fromDate, per_page: 500 });

export async function showConnection(c: SaltEdgeClient, connectionId: string): Promise<SeConnection> {
  return (await c.request<{ data: SeConnection }>('GET', `/connections/${encodeURIComponent(connectionId)}`)).data;
}

/** Asks the bank for newer data. The data arrives later, so the caller reads it with a later call. */
export async function refreshConnection(c: SaltEdgeClient, connectionId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await c.request('POST', `/connections/${encodeURIComponent(connectionId)}/refresh`, { body: { data: { attempt: { fetch_scopes: ['accounts', 'transactions'] } } } });
    return { ok: true };
  } catch (e) {
    if (e instanceof SaltEdgeError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function removeConnection(c: SaltEdgeClient, connectionId: string): Promise<void> {
  try {
    await c.request('DELETE', `/connections/${encodeURIComponent(connectionId)}`);
  } catch (e) {
    if (e instanceof SaltEdgeError && e.status === 404) return; // already gone
    throw e;
  }
}

// ── mapping to Borga's bank model ─────────────────────────────────────────────────────────────────────────────────────

export type FeedAccountKind = 'checking' | 'savings' | 'credit-card';

export interface FeedAccount {
  externalId: string;
  name: string;
  institution: string;
  currency: string;
  last4: string;
  kind: FeedAccountKind;
  balance: number;
}

export interface FeedTransaction {
  externalId: string;
  accountExternalId: string;
  dateIso: string;
  description: string;
  /** Negative = money out, as everywhere in Borga. */
  amount: number;
}

export interface BankFeed {
  connectionId: string;
  institution: string;
  accounts: FeedAccount[];
  transactions: FeedTransaction[];
  /** Pending or duplicated lines that were left out, so the screen can say so. */
  skipped: { pending: number; duplicated: number; invalid: number };
}

const KIND: Record<string, FeedAccountKind> = { savings: 'savings', credit_card: 'credit-card', card: 'credit-card', credit: 'credit-card' };

const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function mapAccount(a: SeAccount, institution: string, fallbackCurrency: string): FeedAccount {
  const num = a.extra?.account_number ?? a.extra?.iban ?? '';
  const digits = String(num).replace(/\s+/g, '');
  return {
    externalId: String(a.id),
    name: (a.name ?? '').trim() || 'Bank account',
    institution,
    currency: (a.currency_code ?? fallbackCurrency).toUpperCase(),
    last4: digits.length >= 4 ? digits.slice(-4) : '0000',
    kind: KIND[(a.nature ?? '').toLowerCase()] ?? 'checking',
    balance: Number.isFinite(a.balance) ? Number(a.balance) : 0,
  };
}

/** One transaction, or why it was left out. Pending lines can still change or disappear, so they are not reconciled. */
export function mapTransaction(t: SeTransaction): { txn?: FeedTransaction; skip?: 'pending' | 'duplicated' | 'invalid' } {
  if (t.duplicated) return { skip: 'duplicated' };
  if ((t.status ?? '').toLowerCase() === 'pending') return { skip: 'pending' };
  const date = isIsoDate(t.made_on) ? t.made_on : isIsoDate(t.extra?.posting_date) ? t.extra?.posting_date : undefined;
  if (!t.id || !date || typeof t.amount !== 'number' || !Number.isFinite(t.amount) || t.amount === 0 || !t.account_id) return { skip: 'invalid' };
  const text = (t.description ?? '').replace(/\s+/g, ' ').trim() || String(t.extra?.payee ?? t.extra?.payer ?? '').replace(/\s+/g, ' ').trim() || (t.category ?? '').replace(/_/g, ' ') || 'Bank transaction';
  return { txn: { externalId: String(t.id), accountExternalId: String(t.account_id), dateIso: date, description: text.slice(0, 200), amount: Math.round(t.amount * 100) / 100 } };
}

/** Everything the bank has for one connection since `fromDate`, in Borga's shape. */
export async function fetchFeed(client: SaltEdgeClient, connection: Pick<SeConnection, 'id' | 'provider_name'>, fallbackCurrency: string, fromDate?: string): Promise<BankFeed> {
  const institution = connection.provider_name || 'Bank';
  const rawAccounts = await listAccounts(client, connection.id);
  const feed: BankFeed = { connectionId: connection.id, institution, accounts: rawAccounts.map((a) => mapAccount(a, institution, fallbackCurrency)), transactions: [], skipped: { pending: 0, duplicated: 0, invalid: 0 } };
  const seen = new Set<string>();
  for (const a of rawAccounts) {
    for (const t of await listTransactions(client, connection.id, String(a.id), fromDate)) {
      const m = mapTransaction({ ...t, account_id: t.account_id ?? String(a.id) });
      if (m.skip) { feed.skipped[m.skip]++; continue; }
      if (m.txn && !seen.has(m.txn.externalId)) { seen.add(m.txn.externalId); feed.transactions.push(m.txn); }
    }
  }
  feed.transactions.sort((x, y) => x.dateIso.localeCompare(y.dateIso) || x.externalId.localeCompare(y.externalId));
  return feed;
}

/** Whether an https (or localhost) address is acceptable as the page Salt Edge sends the user back to. */
export function validReturnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}
