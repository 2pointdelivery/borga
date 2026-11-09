import type { Customer, Lead, LeadStage, CustomerStatus } from './data';

/**
 * Turning whatever a company's CRM/API returns into Borga customers and deals.
 * CRMs disagree on field names, so extraction is alias-based and tolerant: a record is skipped
 * (and counted) only when it has no usable id or name. Pure and unit-tested.
 */

type Raw = Record<string, unknown>;

export interface CrmCustomer {
  crmId: string;
  name: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  addressLine: string;
  city: string;
  state: string;
  country: string;
  status: CustomerStatus;
}

export interface CrmLead {
  crmId: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  value: number;
  stage: LeadStage;
  source: string;
}

/** Reads "a.b.c" paths from nested objects. */
function at(raw: unknown, path: string): unknown {
  let cur: unknown = raw;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const obj = cur as Raw;
    const key = Object.keys(obj).find((k) => k.toLowerCase() === part.toLowerCase());
    cur = key === undefined ? undefined : obj[key];
  }
  return cur;
}

/** First non-empty scalar among the aliases, as a trimmed string. */
export function pick(raw: unknown, aliases: string[]): string {
  for (const a of aliases) {
    const v = at(raw, a);
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

export function pickNumber(raw: unknown, aliases: string[]): number {
  for (const a of aliases) {
    const v = at(raw, a);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      if (v.trim() && Number.isFinite(n)) return n;
    }
  }
  return 0;
}

const LIST_KEYS = ['data', 'results', 'items', 'records', 'customers', 'leads', 'contacts', 'accounts', 'companies', 'deals', 'opportunities', 'value'];

/** The record array inside a response: a bare array, `listKey`, or a common wrapper (one level deep). */
export function extractRecords(json: unknown, listKey?: string): Raw[] | null {
  const asRecords = (v: unknown): Raw[] | null => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Raw[]) : null);
  if (Array.isArray(json)) return asRecords(json);
  if (!json || typeof json !== 'object') return null;
  const obj = json as Raw;
  if (listKey) {
    const hit = asRecords(at(obj, listKey));
    if (hit) return hit;
  }
  for (const k of LIST_KEYS) {
    const direct = asRecords(obj[k]);
    if (direct) return direct;
    const inner = obj[k];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      for (const k2 of LIST_KEYS) {
        const nested = asRecords((inner as Raw)[k2]);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/** Next-page URL from common pagination shapes, kept to the API's own origin. */
export function nextPageUrl(json: unknown, currentUrl: string): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const candidates = ['next', 'links.next', 'pagination.next', 'pagination.next_url', 'paging.next', 'meta.next', '@odata.nextLink', 'next_page_url', 'nextPage'];
  for (const c of candidates) {
    const v = at(json, c);
    const href = typeof v === 'string' ? v : v && typeof v === 'object' ? pick(v, ['href', 'url']) : '';
    if (!href) continue;
    try {
      const abs = new URL(href, currentUrl);
      if (abs.origin !== new URL(currentUrl).origin || abs.href === currentUrl) return null;
      return abs.href;
    } catch {
      return null;
    }
  }
  return null;
}

const ID_ALIASES = ['id', 'uuid', '_id', 'guid', 'customer_id', 'customerId', 'account_id', 'accountId', 'contact_id', 'deal_id', 'dealId', 'lead_id', 'leadId', 'external_id', 'reference'];

export function normalizeCustomer(raw: unknown): CrmCustomer | null {
  const crmId = pick(raw, ID_ALIASES);
  const name = pick(raw, ['name', 'company_name', 'companyName', 'company', 'organization', 'organisation', 'account_name', 'display_name', 'displayName', 'full_name', 'fullName', 'title']);
  if (!crmId || !name) return null;
  const s = pick(raw, ['status', 'stage', 'lifecycle_stage', 'lifecycleStage', 'state']).toLowerCase();
  const status: CustomerStatus = /churn|inactive|lost|closed|cancel|former/.test(s) ? 'churned' : /prospect|lead|potential|new|trial/.test(s) ? 'prospect' : 'active';
  return {
    crmId,
    name,
    email: pick(raw, ['email', 'email_address', 'emailAddress', 'primary_email', 'contact.email', 'billing_email']),
    phone: pick(raw, ['phone', 'phone_number', 'phoneNumber', 'telephone', 'mobile', 'contact.phone']),
    website: pick(raw, ['website', 'url', 'domain', 'web']),
    industry: pick(raw, ['industry', 'sector', 'segment', 'category']),
    addressLine: pick(raw, ['address_line', 'addressLine', 'address.street', 'address.line1', 'street', 'address1', 'address']),
    city: pick(raw, ['city', 'address.city', 'town']),
    state: pick(raw, ['state', 'province', 'region', 'address.state', 'address.province']),
    country: pick(raw, ['country', 'address.country', 'country_code']),
    status,
  };
}

export function mapLeadStage(text: string): LeadStage {
  const s = text.toLowerCase();
  if (/lost|dead|disqualif|declin|rejected/.test(s)) return 'lost';
  if (/won|signed|converted|closed[\s_-]*won|customer/.test(s)) return 'won';
  if (/proposal|quote|negotiat|contract|offer/.test(s)) return 'proposal';
  if (/qualif|contacted|meeting|demo|discovery|engaged/.test(s)) return 'qualified';
  return 'new';
}

export function normalizeLead(raw: unknown): CrmLead | null {
  const crmId = pick(raw, ID_ALIASES);
  const company = pick(raw, ['company', 'company_name', 'companyName', 'organization', 'organisation', 'account_name', 'account.name']);
  const name = pick(raw, ['name', 'deal_name', 'dealName', 'title', 'contact_name', 'contactName', 'full_name', 'fullName']) || company;
  if (!crmId || !name) return null;
  return {
    crmId,
    name,
    company,
    email: pick(raw, ['email', 'email_address', 'emailAddress', 'contact.email', 'primary_email']),
    phone: pick(raw, ['phone', 'phone_number', 'phoneNumber', 'mobile', 'contact.phone']),
    value: Math.max(0, pickNumber(raw, ['value', 'amount', 'deal_value', 'dealValue', 'expected_revenue', 'expectedRevenue', 'estimated_value'])),
    stage: mapLeadStage(pick(raw, ['stage', 'status', 'pipeline_stage', 'pipelineStage', 'deal_stage', 'dealStage'])),
    source: pick(raw, ['source', 'lead_source', 'leadSource', 'channel']) || 'CRM',
  };
}

export interface NormalizeResult<T> {
  records: T[];
  skipped: number;
}

export function normalizeAll<T>(rows: unknown[], fn: (r: unknown) => T | null): NormalizeResult<T> {
  const records: T[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    const n = fn(r) as (T & { crmId?: string }) | null;
    if (!n || (n.crmId && seen.has(n.crmId))) {
      skipped++;
      continue;
    }
    if (n.crmId) seen.add(n.crmId);
    records.push(n);
  }
  return { records, skipped };
}

// ---------------------------------------------------------------------------
// Merge into Borga's stores

export interface MergeSummary {
  added: number;
  updated: number;
  unchanged: number;
}

const lc = (s: string) => s.trim().toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const CUSTOMER_FIELDS = ['name', 'email', 'phone', 'website', 'industry', 'addressLine', 'city', 'state', 'country', 'status'] as const;

/**
 * Upserts CRM customers. Match order: stored CRM id, then e-mail, then exact name. The CRM is the
 * source of truth for the mapped fields; empty values from the CRM never erase what Borga has, and
 * Borga-only fields (owner, notes) are never touched.
 */
export function mergeCustomers(existing: Customer[], incoming: CrmCustomer[], nowIso: string, defaultOwner = 'Unassigned'): { next: Customer[]; summary: MergeSummary } {
  const next = existing.map((c) => ({ ...c }));
  const summary: MergeSummary = { added: 0, updated: 0, unchanged: 0 };
  for (const inc of incoming) {
    let idx = next.findIndex((c) => c.crmId === inc.crmId);
    if (idx < 0 && inc.email) idx = next.findIndex((c) => !c.crmId && lc(c.email) === lc(inc.email));
    // Name alone is not identity: two different companies can share one.
    // Merge on name only with a corroborating signal (same website, phone,
    // or city). Otherwise create a separate record — a visible duplicate the
    // user can merge beats silently fusing two companies into one.
    if (idx < 0) {
      idx = next.findIndex((c) => {
        if (c.crmId || lc(c.name) !== lc(inc.name)) return false;
        if (inc.website && c.website && lc(c.website) === lc(inc.website)) return true;
        if (inc.phone && c.phone && lc(c.phone) === lc(inc.phone)) return true;
        if (inc.city && c.city && lc(c.city) === lc(inc.city)
          && (!inc.country || !c.country || lc(c.country) === lc(inc.country))) return true;
        return false;
      });
    }
    if (idx < 0) {
      next.unshift({
        id: `cu-crm-${slug(inc.crmId)}`, crmId: inc.crmId, name: inc.name, industry: inc.industry, website: inc.website, email: inc.email, phone: inc.phone,
        addressLine: inc.addressLine, city: inc.city, state: inc.state || undefined, country: inc.country, status: inc.status, owner: defaultOwner, createdAt: nowIso, notes: 'Imported from the Company Engine (CRM).',
      });
      summary.added++;
      continue;
    }
    const cur = next[idx];
    let changed = cur.crmId !== inc.crmId;
    for (const f of CUSTOMER_FIELDS) {
      const v = inc[f];
      if (v && (cur[f] ?? '') !== v) {
        (cur as unknown as Record<string, string>)[f] = v;
        changed = true;
      }
    }
    cur.crmId = inc.crmId;
    if (changed) summary.updated++;
    else summary.unchanged++;
  }
  return { next, summary };
}

const PRIORITY = (value: number): Lead['priority'] => (value >= 20000 ? 'P0' : value >= 5000 ? 'P1' : 'P2');

/** Upserts CRM deals/leads (by CRM id, then e-mail + company), linking each to a customer when one matches. */
export function mergeLeads(existing: Lead[], incoming: CrmLead[], customers: Customer[], defaultOwnerId = 'a-sales'): { next: Lead[]; summary: MergeSummary } {
  const next = existing.map((l) => ({ ...l }));
  const summary: MergeSummary = { added: 0, updated: 0, unchanged: 0 };
  const customerFor = (inc: CrmLead): string | undefined =>
    customers.find((c) => (inc.email && lc(c.email) === lc(inc.email)) || (inc.company && lc(c.name) === lc(inc.company)))?.id;
  for (const inc of incoming) {
    let idx = next.findIndex((l) => l.crmId === inc.crmId);
    if (idx < 0 && inc.email) idx = next.findIndex((l) => !l.crmId && lc(l.email) === lc(inc.email) && lc(l.company) === lc(inc.company));
    const customerId = customerFor(inc);
    if (idx < 0) {
      next.unshift({ id: `ld-crm-${slug(inc.crmId)}`, crmId: inc.crmId, name: inc.name, company: inc.company, email: inc.email, phone: inc.phone, value: inc.value, stage: inc.stage, source: inc.source, ownerId: defaultOwnerId, priority: PRIORITY(inc.value), customerId });
      summary.added++;
      continue;
    }
    const cur = next[idx];
    let changed = cur.crmId !== inc.crmId;
    const set = <K extends 'name' | 'company' | 'email' | 'phone' | 'source'>(k: K, v: string) => {
      if (v && cur[k] !== v) {
        cur[k] = v as Lead[K];
        changed = true;
      }
    };
    set('name', inc.name); set('company', inc.company); set('email', inc.email); set('phone', inc.phone); set('source', inc.source);
    if (cur.value !== inc.value && inc.value > 0) { cur.value = inc.value; changed = true; }
    if (cur.stage !== inc.stage) { cur.stage = inc.stage; changed = true; }
    if (customerId && cur.customerId !== customerId) { cur.customerId = customerId; changed = true; }
    cur.crmId = inc.crmId;
    if (changed) summary.updated++;
    else summary.unchanged++;
  }
  return { next, summary };
}
