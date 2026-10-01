import type { RevenueLine } from './data';

/**
 * Company services (captured at onboarding) and the revenue lines derived from them.
 * Pure helpers: the Revenue Tracker keeps one line per service and stays in step as the
 * list changes.
 */

const MAX_SERVICES = 24;
const MAX_NAME = 60;

/** "Same-day delivery, Freight; Moving\n• PUDO" -> ["Same-day delivery", "Freight", "Moving", "PUDO"]. */
export function parseServices(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n\r]+/)) {
    const name = raw.replace(/^[\s\-*•·\d.)]+/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_SERVICES) break;
  }
  return out;
}

/** Older workspaces only have the onboarding sentence "Services: a, b. Differentiators: ..." in the knowledge base. */
export function servicesFromKnowledge(kb: Array<{ category?: string; title?: string; answer: string }>): string[] {
  for (const e of kb) {
    if (e.category !== 'services' && !/services/i.test(e.title ?? '')) continue;
    const m = /Services:\s*([\s\S]*?)(?:\.\s*Differentiators:|$)/i.exec(e.answer);
    if (m) {
      const list = m[1].trim();
      if (list && list !== '—') return parseServices(list);
    }
  }
  return [];
}

export const SERVICE_COLORS = ['#2a78d6', '#eb6834', '#6250d6', '#1baf7a', '#eda100', '#e87ba4', '#0ea5e9', '#84cc16', '#f43f5e', '#14b8a6'];

export const serviceLineId = (name: string): string => 'svc-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface Reconciliation {
  /** Services with no revenue line yet. */
  missing: string[];
  /** Lines created from a service that is no longer in the list (kept: they may hold actuals). */
  orphaned: RevenueLine[];
}

export function reconcileServiceLines(lines: RevenueLine[], services: string[]): Reconciliation {
  const have = new Set(lines.map((l) => norm(l.service ?? l.name)));
  const wanted = new Set(services.map(norm));
  return {
    missing: services.filter((s) => !have.has(norm(s))),
    orphaned: lines.filter((l) => l.service && !wanted.has(norm(l.service))),
  };
}

/** New zeroed lines for the given services, with a flat monthly target. */
export function makeServiceLines(services: string[], months: number, monthlyTarget: number, colorOffset = 0): RevenueLine[] {
  return services.map((service, i) => ({
    id: serviceLineId(service),
    name: service,
    service,
    color: SERVICE_COLORS[(colorOffset + i) % SERVICE_COLORS.length],
    targets: Array.from({ length: months }, () => Math.max(0, Math.round(monthlyTarget))),
    actuals: Array.from({ length: months }, () => 0),
  }));
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Labels like "Oct '26", "Oct 2026" or "2026-10" -> { y, m (0-11) }, or null. */
export function parseMonthLabel(label: string): { y: number; m: number } | null {
  const iso = /^(\d{4})-(\d{2})$/.exec(label.trim());
  if (iso) return { y: Number(iso[1]), m: Number(iso[2]) - 1 };
  const m = /^([A-Za-z]{3})[a-z]*\.?\s*['’]?\s*(\d{2}|\d{4})$/.exec(label.trim());
  if (!m) return null;
  const mi = MONTH_ABBR.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  const yy = Number(m[2]);
  return { y: m[2].length === 2 ? 2000 + yy : yy, m: mi };
}

/** `count` consecutive month labels starting at (year, month0), e.g. ["Oct '26", "Nov '26"]. */
export function monthLabels(startYear: number, startMonth0: number, count: number): string[] {
  const out: string[] = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let i = 0; i < count; i++) {
    const t = startYear * 12 + startMonth0 + i;
    out.push(`${names[t % 12]} '${String(Math.floor(t / 12) % 100).padStart(2, '0')}`);
  }
  return out;
}

export function periodLabel(months: string[]): string {
  if (!months.length) return '';
  const f = (l: string) => {
    const p = parseMonthLabel(l);
    return p ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p.m]} ${p.y}` : l;
  };
  return months.length === 1 ? f(months[0]) : `${f(months[0])} → ${f(months[months.length - 1])}`;
}

export interface LedgerEntryLike {
  label: string;
  amount: number;
  category: string;
  kind: string;
  dateIso?: string;
  voidedAt?: string;
}

/**
 * Revenue booked per service per month from the ledger. An entry belongs to a service when its
 * category equals the service name or its description mentions it (names of 4+ letters, whole words).
 * Entries matching no service are ignored: the tracker never guesses.
 */
export function ledgerActualsByService(entries: LedgerEntryLike[], services: string[], monthKeys: Array<{ y: number; m: number } | null>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const s of services) out[s] = monthKeys.map(() => 0);
  const word = (s: string) => new RegExp('(^|[^a-z0-9])' + s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
  const matchers = services.map((s) => ({ s, re: s.length >= 4 ? word(s) : null }));
  for (const e of entries) {
    if (e.kind !== 'revenue' || e.voidedAt) continue;
    const d = /^(\d{4})-(\d{2})/.exec(e.dateIso ?? '');
    if (!d) continue;
    const idx = monthKeys.findIndex((k) => k && k.y === Number(d[1]) && k.m === Number(d[2]) - 1);
    if (idx < 0) continue;
    const hit = matchers.find(({ s, re }) => norm(e.category) === norm(s) || (re && (re.test(e.label.toLowerCase()) || re.test(e.category.toLowerCase()))));
    if (hit) out[hit.s][idx] += e.amount;
  }
  return out;
}
