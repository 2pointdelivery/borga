// Multi-currency: ECB euro reference rates (free, no key) with manual fallback.
// Amounts on documents are stored in workspace currency; the foreign face
// value + the rate snapshot travel alongside so revaluation stays exact.
// Pure (no I/O) — tested in lib/fx.test.ts.
import type { JournalEntry } from './data';

export interface FxRates {
  /** Always EUR for ECB feeds (rates are per 1 EUR); manual tables keep their own base. */
  base: string;
  /** ECB publication date (YYYY-MM-DD). */
  date: string;
  /** ISO code → units per 1 base. */
  rates: Record<string, number>;
  source: 'ecb' | 'manual';
}

export const EMPTY_FX: FxRates = { base: 'EUR', date: '', rates: {}, source: 'manual' };

/** Parses the ECB eurofxref XML (currency + rate Cube elements only — no XML parser dependency). */
export function parseEcbXml(xml: string): FxRates {
  const rates: Record<string, number> = { EUR: 1 };
  const re = /<Cube\s+currency="([A-Z]{3})"\s+rate="([0-9.]+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = Number(m[2]);
    if (Number.isFinite(v) && v > 0) rates[m[1]] = v;
  }
  const date = /<Cube\s+time="(\d{4}-\d{2}-\d{2})"/.exec(xml)?.[1] ?? '';
  if (Object.keys(rates).length < 5 || !date) throw new Error('Not a usable ECB rates feed.');
  return { base: 'EUR', date, rates, source: 'ecb' };
}

/** Units of `to` per 1 unit of `from`, via the base pivot. Null when unconvertible. */
export function rateFor(rates: FxRates, from: string, to: string): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;
  const rf = f === rates.base ? 1 : rates.rates[f];
  const rt = t === rates.base ? 1 : rates.rates[t];
  if (!rf || !rt || rf <= 0 || rt <= 0) return null;
  return rt / rf;
}

/** Converts an amount, rounding to workspace (target) decimals via the caller. Null when no rate. */
export function convert(amount: number, from: string, to: string, rates: FxRates): number | null {
  const r = rateFor(rates, from, to);
  return r === null ? null : Math.round(amount * r * 100) / 100;
}

// ── Revaluation ──────────────────────────────────────────────────────────────
// Open foreign-currency balances are re-measured at the current rate; the
// difference posts as unrealized gain/loss (never touches the foreign face value).

export interface FxDoc {
  id: string;
  number: string;
  kind: 'invoice' | 'bill';
  /** Face value in the document currency. */
  foreignAmount: number;
  currency: string;
  /** Rate (workspace units per 1 foreign) snapshotted at issue; 1 when same-currency. */
  fxRate: number;
  /** Open amount still outstanding, in workspace currency at the booked rate. */
  openWs: number;
}

export interface FxRevalLine {
  docId: string;
  number: string;
  kind: 'invoice' | 'bill';
  currency: string;
  bookedWs: number;
  currentWs: number;
  /** Unrealized gain-positive: receivables gain when the foreign currency strengthens; payables gain when it weakens. */
  diff: number;
}

export function revalueDocs(docs: FxDoc[], wsCurrency: string, rates: FxRates): FxRevalLine[] {
  const out: FxRevalLine[] = [];
  for (const d of docs) {
    if (d.currency.toUpperCase() === wsCurrency.toUpperCase()) continue;
    if (!(d.openWs > 0)) continue;
    // booked open in foreign units, re-measured now
    const openForeign = d.fxRate > 0 ? d.openWs / d.fxRate : d.openWs;
    const current = convert(openForeign, d.currency, wsCurrency, rates);
    if (current === null) continue;
    // A receivable gains when foreign strengthens; an owed bill gains when foreign weakens.
    const raw = Math.round((current - d.openWs) * 100) / 100;
    const diff = d.kind === 'bill' ? -raw : raw;
    if (Math.abs(diff) < 0.005) continue;
    out.push({ docId: d.id, number: d.number, kind: d.kind, currency: d.currency.toUpperCase(), bookedWs: d.openWs, currentWs: current, diff });
  }
  return out;
}

// ── Revaluation posting ──────────────────────────────────────────────────────
// One balanced journal per foreign currency, idempotent per calendar month:
// receivables gain → DR AR / CR FX gain; payables gain → DR AP / CR FX gain
// (losses mirror). Unrealized only — face values never change.

export interface FxPostAccounts {
  ar: string;
  ap: string;
  gain: string;
  loss: string;
}

export function resolveFxAccounts(coa: Array<{ id: string; type: string; name: string }>): FxPostAccounts | null {
  const ar = coa.find((a) => a.type === 'asset' && /receiv/i.test(a.name ?? ''))?.id;
  const ap = coa.find((a) => a.type === 'liability' && /accounts payable/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'liability' && /payable/i.test(a.name ?? '') && !/tax/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'liability')?.id;
  const gain = coa.find((a) => a.type === 'revenue' && /exchange|foreign|fx/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'revenue' && /other income/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'revenue')?.id;
  const loss = coa.find((a) => a.type === 'expense' && /exchange|foreign|fx/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'expense')?.id;
  if (!ar || !ap || !gain || !loss) return null;
  return { ar, ap, gain, loss };
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Groups revaluation lines by currency into one balanced journal each. */
export function postFxRevaluation(
  lines: FxRevalLine[],
  accounts: FxPostAccounts,
  monthKey: string,
): JournalEntry[] {
  const byCcy = new Map<string, FxRevalLine[]>();
  for (const l of lines) {
    const list = byCcy.get(l.currency) ?? [];
    list.push(l);
    byCcy.set(l.currency, list);
  }
  const out: JournalEntry[] = [];
  for (const [ccy, ls] of byCcy) {
    const entries: JournalEntry['lines'] = [];
    for (const l of ls) {
      const amt = Math.abs(l.diff);
      const bal = l.kind === 'invoice' ? accounts.ar : accounts.ap;
      if (l.diff > 0) {
        // gain: receivables up (DR AR), payables down (DR AP) / CR gain
        entries.push({ accountId: bal, debit: amt, credit: 0 }, { accountId: accounts.gain, debit: 0, credit: amt });
      } else {
        entries.push({ accountId: accounts.loss, debit: amt, credit: 0 }, { accountId: bal, debit: 0, credit: amt });
      }
    }
    out.push({
      id: uid('je-fx'), date: `${monthKey}-01`, dateIso: `${monthKey}-01`,
      memo: `FX revaluation ${monthKey} — ${ccy} (${ls.length} open document${ls.length === 1 ? '' : 's'})`,
      description: `Unrealized exchange differences on open ${ccy} balances. Recomputed monthly; reversed automatically when documents settle.`,
      status: 'posted', createdAt: new Date().toISOString(),
      externalRef: `fx-reval:${monthKey}:${ccy}`, auto: 'fx',
      lines: entries,
    } as unknown as JournalEntry);
  }
  return out;
}
