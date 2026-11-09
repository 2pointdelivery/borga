import type { Lead } from './data';
import { extractRecords } from './crm-core';

/**
 * Explee (B2B outreach) hot-lead sync: the pure half. Explee finds leads,
 * emails them and flags interested replies as "hot"; this module maps one
 * hot lead to a Borga pipeline Lead and merges batches without duplicating.
 * Fetching and persistence live in explee-server.ts; everything here is
 * pure and unit-tested, in the spirit of crm-core.
 */

export const EXPLEE_API_BASE = 'https://api.explee.com';
export const EXPLEE_HOT_LEADS_PATH = '/public/api/v1/autogtm/hot-leads';
export const EXPLEE_PROJECTS_PATH = '/public/api/v1/autogtm/projects';
/** Page size the sync asks for; the API caps it at 200. */
export const EXPLEE_PAGE_LIMIT = 200;
/** Safety cap: a 10-minute window can't honestly produce more pages than this. */
export const EXPLEE_MAX_PAGES = 5;

/** One hot lead exactly as Explee returns it (HotLeadItem in their OpenAPI schema). */
export interface ExpleeHotLead {
  person_id: string;
  campaign_id: number;
  name: string | null;
  email: string | null;
  job_title: string | null;
  company_name: string | null;
  company_domain: string | null;
  linkedin_url: string | null;
  country: string | null;
  phone: string | null;
  why_hot: string | null;
  became_hot_at: string | null;
  /** The contact asked to be removed: the row is a skeleton with nothing of the person on it. */
  erased?: boolean;
}

export function expleeHeaders(apiKey: string): Record<string, string> {
  return { Accept: 'application/json', 'X-API-Key': apiKey };
}

/** The hot-leads feed URL for one page. `since` (ISO 8601) limits it to newly-hot leads. */
export function hotLeadsUrl(since: string | null, offset = 0, limit = EXPLEE_PAGE_LIMIT): string {
  const url = new URL(EXPLEE_API_BASE + EXPLEE_HOT_LEADS_PATH);
  url.searchParams.set('limit', String(Math.min(Math.max(1, limit), EXPLEE_PAGE_LIMIT)));
  if (since) {
    const t = Date.parse(since);
    if (!Number.isNaN(t)) url.searchParams.set('since', new Date(t).toISOString());
  }
  if (offset > 0) url.searchParams.set('offset', String(offset));
  return url.href;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Tolerant single-item parse; null when nothing identifies the person. */
export function normalizeHotLead(raw: unknown): ExpleeHotLead | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const personId = str(r.person_id) ?? str(r.personId);
  const email = str(r.email);
  if (!personId && !email) return null;
  return {
    person_id: personId ?? email!,
    campaign_id: typeof r.campaign_id === 'number' ? r.campaign_id : Number(r.campaign_id) || 0,
    name: str(r.name),
    email,
    job_title: str(r.job_title),
    company_name: str(r.company_name),
    company_domain: str(r.company_domain),
    linkedin_url: str(r.linkedin_url),
    country: str(r.country),
    phone: str(r.phone),
    why_hot: str(r.why_hot),
    became_hot_at: str(r.became_hot_at),
    erased: r.erased === true,
  };
}

export interface ParsedHotLeads {
  leads: ExpleeHotLead[];
  hasMore: boolean;
  nextOffset: number | null;
}

/** Accepts the documented { leads, has_more, next_offset } shape, a bare array, or a common wrapper. */
export function parseHotLeads(json: unknown): ParsedHotLeads {
  const rows = extractRecords(json, 'leads') ?? [];
  const leads = rows.map(normalizeHotLead).filter((l): l is ExpleeHotLead => l !== null);
  const obj = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const nextOffset = typeof obj.next_offset === 'number' ? obj.next_offset : null;
  return { leads, hasMore: obj.has_more === true && nextOffset !== null, nextOffset };
}

export interface ExpleeProject {
  id: number;
  domain: string | null;
}

/** Projects list for the connection test: proves the key and (optionally) the project id. */
export function parseProjects(json: unknown): ExpleeProject[] {
  const rows = extractRecords(json, 'projects') ?? [];
  const out: ExpleeProject[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const rec = r as Record<string, unknown>;
    const id = typeof rec.id === 'number' ? rec.id : Number(rec.id);
    if (!Number.isFinite(id)) continue;
    out.push({ id, domain: str(rec.domain) });
  }
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/**
 * A hot lead becomes a pipeline Lead: stage "qualified" (they replied with real
 * interest), priority P1, value 0 until someone prices the deal, and the reply
 * kept word for word in `hotWhy` so the rep can see why it is hot.
 */
export function hotLeadToLead(h: ExpleeHotLead, nowIso: string, defaults: { ownerId?: string } = {}): Lead | null {
  if (h.erased) return null;
  const name = h.name ?? h.email;
  if (!name) return null;
  const crmId = `explee-${h.person_id}`;
  return {
    id: `ld-explee-${slug(h.person_id)}`,
    crmId,
    name,
    company: h.company_name ?? '',
    email: h.email ?? '',
    phone: h.phone ?? '',
    value: 0,
    stage: 'qualified',
    source: 'Explee',
    ownerId: defaults.ownerId ?? 'a-sales',
    priority: 'P1',
    createdAt: h.became_hot_at ?? nowIso,
    lastContactAt: h.became_hot_at ?? nowIso,
    hotWhy: h.why_hot ?? undefined,
    explee: {
      jobTitle: h.job_title ?? undefined,
      companyDomain: h.company_domain ?? undefined,
      linkedinUrl: h.linkedin_url ?? undefined,
      country: h.country ?? undefined,
      campaignId: h.campaign_id ? String(h.campaign_id) : undefined,
      becameHotAt: h.became_hot_at ?? undefined,
    },
  };
}

export interface HotLeadMergeSummary {
  added: number;
  updated: number;
  unchanged: number;
  /** Ids (Borga's) of the records this batch created, in batch order. */
  addedIds: string[];
}

const lc = (s: string) => s.trim().toLowerCase();

/** Field order matters here: a JSON round-trip (MySQL) may reorder keys, so compare values, not strings. */
const expleeSig = (e: Lead['explee']) => (e ? [e.jobTitle, e.companyDomain, e.linkedinUrl, e.country, e.campaignId, e.becameHotAt].join('|') : null);

/**
 * Upserts hot leads into the pipeline. Match order: Explee person id, then
 * e-mail + company (so a lead captured by hand from the same person merges
 * instead of duplicating). Contact fields refresh when Explee has more than
 * we do, and a fresh `hotWhy` always wins — but a stage the team already set
 * (proposal, won, lost) is theirs and is never reset.
 */
export function mergeHotLeads(existing: Lead[], incoming: Lead[]): { next: Lead[]; summary: HotLeadMergeSummary } {
  const next = existing.map((l) => ({ ...l }));
  const summary: HotLeadMergeSummary = { added: 0, updated: 0, unchanged: 0, addedIds: [] };
  for (const inc of incoming) {
    let idx = next.findIndex((l) => !!inc.crmId && l.crmId === inc.crmId);
    if (idx < 0 && inc.email) idx = next.findIndex((l) => !l.crmId?.startsWith('explee-') && lc(l.email) === lc(inc.email) && (!inc.company || !l.company || lc(l.company) === lc(inc.company)));
    if (idx < 0) {
      next.unshift(inc);
      summary.added++;
      summary.addedIds.push(inc.id);
      continue;
    }
    const cur = next[idx];
    let changed = false;
    const set = <K extends 'name' | 'company' | 'email' | 'phone' | 'hotWhy'>(k: K, v: string | undefined) => {
      if (v && cur[k] !== v) {
        (cur as unknown as Record<string, string>)[k] = v;
        changed = true;
      }
    };
    set('name', inc.name);
    set('company', inc.company);
    set('email', inc.email);
    set('phone', inc.phone);
    set('hotWhy', inc.hotWhy);
    if (expleeSig(cur.explee) !== expleeSig(inc.explee)) {
      cur.explee = inc.explee;
      changed = true;
    }
    if (cur.crmId !== inc.crmId) {
      cur.crmId = inc.crmId;
      changed = true;
    }
    if (inc.lastContactAt && inc.lastContactAt > (cur.lastContactAt ?? '')) {
      cur.lastContactAt = inc.lastContactAt;
      changed = true;
    }
    if (changed) summary.updated++;
    else summary.unchanged++;
  }
  return { next, summary };
}

/**
 * The next `since` cursor: the newest became_hot_at in a batch, never moving
 * backwards (the feed is newest-first, but a null-aware max is safer than
 * trusting order). Stays null when nothing is dated.
 */
export function nextCursor(leads: ExpleeHotLead[], prev: string | null): string | null {
  let max = prev;
  for (const l of leads) {
    if (!l.became_hot_at) continue;
    if (!max || Date.parse(l.became_hot_at) > Date.parse(max)) max = l.became_hot_at;
  }
  return max;
}
