'use client';

import type { Ticket, TicketSummary, TicketSettings } from './tickets';

export type ClientSettings = TicketSettings & { hasImapPassword: boolean; inboundToken: string; inboundUrl: string };

interface Envelope {
  ok: boolean;
  error?: string;
  issues?: string[];
}

async function call<T extends Envelope>(ws: string, init?: { body: unknown }, extraQuery = ''): Promise<T> {
  const url = `/api/borga/tickets?ws=${encodeURIComponent(ws)}${extraQuery}`;
  try {
    const res = await fetch(
      url,
      init
        ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' }, body: JSON.stringify(init.body) }
        : { cache: 'no-store' },
    );
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok && !json.error) return { ...json, ok: false, error: `Request failed (${res.status})` };
    return json;
  } catch {
    return { ok: false, error: 'Network error' } as T;
  }
}

export const ticketsApi = {
  list: (ws: string) => call<Envelope & { tickets: TicketSummary[]; settings: ClientSettings }>(ws),
  get: (ws: string, id: string) => call<Envelope & { ticket: Ticket }>(ws, undefined, `&id=${encodeURIComponent(id)}`),
  create: (ws: string, ticket: Record<string, unknown>, actor: string) => call<Envelope & { ticket: Ticket }>(ws, { body: { action: 'create', ticket, actor } }),
  update: (ws: string, id: string, patch: Record<string, unknown>, actor: string) => call<Envelope & { ticket: Ticket }>(ws, { body: { action: 'update', id, patch, actor } }),
  comment: (ws: string, id: string, kind: 'public' | 'internal', body: string, actor: string, setStatus?: string) =>
    call<Envelope & { ticket: Ticket }>(ws, { body: { action: 'comment', id, kind, body, actor, setStatus } }),
  saveSettings: (ws: string, settings: Record<string, unknown>, opts: { imapPassword?: string; regenerateToken?: boolean } = {}) =>
    call<Envelope & { settings: ClientSettings }>(ws, { body: { action: 'saveSettings', settings, ...opts } }),
  similar: (ws: string, id: string) => call<Envelope & { enabled: boolean; similar: Array<{ ticketId: string; title: string; excerpt: string; score: number }> }>(ws, { body: { action: 'similar', id } }),
  pollMailbox: (ws: string) => call<Envelope & { fetched: number; created: number; replied: number }>(ws, { body: { action: 'pollMailbox' } }),
  /** Delete a closed/resolved ticket (the server refuses active ones to keep SLA history auditable). */
  remove: (ws: string, id: string, actor: string) => call<Envelope & { deleted: string }>(ws, { body: { action: 'delete', id, actor } }),
};
