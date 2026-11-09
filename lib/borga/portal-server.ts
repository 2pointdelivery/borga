import 'server-only';
import { randomBytes } from 'crypto';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { userWsKey, userWorkspacesKey } from './keys';
import { hashApiKey, safeEqual } from './api-keys';
import { acceptQuote, isExpired, quoteTotal, type Quote } from './quotes';
import { EMPTY_FX, rateFor, type FxRates } from './fx';
import { addNotice } from './notices';
import { emitEvent } from './emit-event';
import {
  PORTAL_TOKEN_PREFIX,
  defaultPortalExpiry,
  isPortalAcceptable,
  isPortalTokenFormat,
  isPortalTokenLive,
  isPortalVisibleQuote,
  type PortalToken,
  type PortalTokenPublic,
} from './portal-core';
import type { Customer, Invoice, Project, Workspace } from './data';

/**
 * Customer portal: login-free, token-scoped reads (own invoices + quotes)
 * and quote acceptance. Tokens are shown once at creation (only the hash is
 * stored); verification scans token rows in constant time and honours revoke
 * and expiry. A customer can never name another workspace, customer, or
 * document: every lookup is re-scoped to the token's own binding.
 */

const tokensKey = (userId: string, ws: string): string => userWsKey(userId, ws, 'portalTokens');

export interface PortalBinding {
  userId: string;
  ws: string;
  token: PortalToken;
}

/** Mint a portal link for one customer account. The secret is returned once — it cannot be read back. */
export async function createPortalToken(
  userId: string,
  ws: string,
  customerId: string,
  opts: { expiresAt?: string | null } = {},
): Promise<{ record: PortalTokenPublic; secret: string } | { error: string }> {
  const customers = (await getBorgaState<Customer[]>(userWsKey(userId, ws, 'customers')).catch(() => null)) ?? [];
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return { error: 'Customer not found.' };
  const secret = `${PORTAL_TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
  const now = new Date().toISOString();
  const record: PortalToken = {
    id: `pt-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    customerId,
    customerName: customer.name,
    hash: hashApiKey(secret),
    prefix: `${secret.slice(0, 12)}…${secret.slice(-4)}`,
    createdAt: now,
    expiresAt: opts.expiresAt === null ? null : (opts.expiresAt ?? defaultPortalExpiry()),
    revokedAt: null,
    lastUsedAt: null,
  };
  const all = (await getBorgaState<PortalToken[]>(tokensKey(userId, ws)).catch(() => null)) ?? [];
  await setBorgaState(tokensKey(userId, ws), [...all, record]);
  const { hash, ...pub } = record;
  void hash;
  return { record: pub, secret };
}

export async function listPortalTokens(userId: string, ws: string): Promise<PortalTokenPublic[]> {
  const all = (await getBorgaState<PortalToken[]>(tokensKey(userId, ws)).catch(() => null)) ?? [];
  return all.map(({ hash, ...pub }) => {
    void hash;
    return pub;
  });
}

export async function revokePortalToken(userId: string, ws: string, id: string): Promise<boolean> {
  const all = (await getBorgaState<PortalToken[]>(tokensKey(userId, ws)).catch(() => null)) ?? [];
  const ix = all.findIndex((t) => t.id === id);
  if (ix < 0 || all[ix].revokedAt) return false;
  all[ix] = { ...all[ix], revokedAt: new Date().toISOString() };
  await setBorgaState(tokensKey(userId, ws), all);
  return true;
}

/** Resolve a presented token to its owner binding. Null for bad shape, unknown, revoked or expired tokens. */
export async function verifyPortalToken(secret: string, nowIso: string = new Date().toISOString()): Promise<PortalBinding | null> {
  if (!isPortalTokenFormat(secret)) return null;
  const wanted = hashApiKey(secret);
  for (const k of await listBorgaKeys('u::%::ws::%::portalTokens').catch(() => [] as string[])) {
    const m = /^u::([^:]+)::ws::([^:]+)::portalTokens$/.exec(k);
    if (!m) continue;
    const rows = (await getBorgaState<PortalToken[]>(k).catch(() => null)) ?? [];
    for (const r of rows) {
      if (!safeEqual(r.hash, wanted) || !isPortalTokenLive(r, nowIso)) continue;
      return { userId: m[1], ws: m[2], token: r };
    }
  }
  return null;
}

async function touchToken(b: PortalBinding): Promise<void> {
  const all = (await getBorgaState<PortalToken[]>(tokensKey(b.userId, b.ws)).catch(() => null)) ?? [];
  const ix = all.findIndex((t) => t.id === b.token.id);
  if (ix < 0) return;
  all[ix] = { ...all[ix], lastUsedAt: new Date().toISOString() };
  await setBorgaState(tokensKey(b.userId, b.ws), all).catch(() => false);
}

export interface PortalInvoiceView {
  id: string;
  number: string;
  amount: number;
  status: string;
  issued: string;
  due: string;
}

export interface PortalQuoteView {
  id: string;
  number: string;
  total: number;
  status: string;
  validUntil: string;
  acceptable: boolean;
  lines: Array<{ label: string; qty: number; unitPrice: number }>;
}

export interface PortalView {
  company: string;
  customer: string;
  invoices: PortalInvoiceView[];
  quotes: PortalQuoteView[];
}

/** Everything one customer may see: their invoices and non-draft quotes, nothing else. */
export async function portalView(b: PortalBinding, todayIso: string = new Date().toISOString().slice(0, 10)): Promise<PortalView | null> {
  const { userId: u, ws } = b;
  const [workspaces, customers, invoices, quotes] = await Promise.all([
    getBorgaState<Workspace[]>(userWorkspacesKey(u)).catch(() => null),
    getBorgaState<Customer[]>(userWsKey(u, ws, 'customers')).catch(() => null),
    getBorgaState<Invoice[]>(userWsKey(u, ws, 'invoices')).catch(() => null),
    getBorgaState<Quote[]>(userWsKey(u, ws, 'quotes')).catch(() => null),
  ]);
  const customer = (customers ?? []).find((c) => c.id === b.token.customerId);
  if (!customer) return null;
  await touchToken(b).catch(() => undefined);
  return {
    company: workspaces?.find((w) => w.id === ws)?.name ?? 'Your vendor',
    customer: customer.name,
    invoices: (invoices ?? [])
      .filter((i) => i.customerId === customer.id && !i.voidedAt)
      .map((i) => ({ id: i.id, number: i.number, amount: i.amount, status: i.status, issued: i.issued, due: i.due })),
    quotes: (quotes ?? [])
      .filter((q) => q.customerId === customer.id && isPortalVisibleQuote(q.status))
      .map((q) => ({
        id: q.id,
        number: q.number,
        total: quoteTotal(q),
        status: isExpired(q, todayIso) && q.status !== 'converted' ? 'expired' : q.status,
        validUntil: q.validUntil,
        acceptable: isPortalAcceptable(q.status, q.validUntil, todayIso) && !q.convertedInvoiceId,
        lines: q.lines.map((l) => ({ label: l.label, qty: l.qty, unitPrice: l.unitPrice })),
      })),
  };
}

/** A customer accepting their own sent, unexpired quote: invoice (+project) drafted, owner notified. */
export async function acceptQuoteAsCustomer(
  b: PortalBinding,
  quoteId: string,
  todayIso: string = new Date().toISOString().slice(0, 10),
): Promise<{ ok: boolean; invoiceId?: string; projectId?: string; total?: number; error?: string }> {
  const { userId: u, ws } = b;
  const quotes = (await getBorgaState<Quote[]>(userWsKey(u, ws, 'quotes')).catch(() => null)) ?? [];
  const q = quotes.find((x) => x.id === quoteId);
  if (!q || q.customerId !== b.token.customerId) return { ok: false, error: 'Quote not found.' };
  if (!isPortalAcceptable(q.status, q.validUntil, todayIso) || q.convertedInvoiceId) {
    return { ok: false, error: 'This quote can no longer be accepted.' };
  }
  const invoices = (await getBorgaState<Invoice[]>(userWsKey(u, ws, 'invoices')).catch(() => null)) ?? [];
  const projects = (await getBorgaState<Project[]>(userWsKey(u, ws, 'projects')).catch(() => null)) ?? [];
  try {
    const projectId = `p-${Date.now().toString(36)}`;
    const invoiceNumber = `INV-${invoices.length + 1}`;
    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(u)).catch(() => null)) ?? [];
    const wsCurrency = (workspaces.find((w) => w.id === ws)?.currency ?? 'USD').toUpperCase();
    const fx = (await getBorgaState<FxRates>(userWsKey(u, ws, 'fxRates')).catch(() => null)) ?? EMPTY_FX;
    const docCcy = (q.currency ?? '').toUpperCase();
    const fxRate = docCcy && docCcy !== wsCurrency ? rateFor(fx, docCcy, wsCurrency) : 1;
    const { quote, invoice, project } = acceptQuote(q, { invoiceNumber, projectId, wsCurrency, fxRate: fxRate ?? undefined });
    await setBorgaState(userWsKey(u, ws, 'quotes'), quotes.map((x) => (x.id === q.id ? quote : x)));
    await setBorgaState(userWsKey(u, ws, 'invoices'), [{ ...invoice, id: invoice.id }, ...invoices]);
    await setBorgaState(userWsKey(u, ws, 'projects'), [{ ...project, id: projectId }, ...projects]);
    await emitEvent(u, ws, 'quote.accepted', { quoteId: q.id, invoiceId: invoice.id, projectId, total: invoice.amount }).catch(() => undefined);
    await addNotice(
      {
        id: `n-portal-${q.id}-${Date.now().toString(36)}`,
        title: `Customer accepted ${q.number}`,
        body: `${b.token.customerName} accepted quote ${q.number} in the portal — invoice ${invoiceNumber} drafted.`,
        severity: 'noteworthy',
        source: 'scheduler',
        createdAt: new Date().toISOString(),
        readAt: null,
      },
      ws,
      u,
    ).catch(() => undefined);
    return { ok: true, invoiceId: invoice.id, projectId, total: invoice.amount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not accept the quote.' };
  }
}
