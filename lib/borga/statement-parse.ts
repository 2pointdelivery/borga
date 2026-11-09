// Reads the text of a bank statement and finds its transactions. Pure (no I/O), so it is tested on its own; the PDF-to-text step is in
// statement-pdf.ts. Statements have no common format, so this is a careful best effort that says what it is unsure of:
//
//  - a transaction line starts with a date and ends with an amount (and often a running balance);
//  - a line that does not start with a date continues the description of the one above;
//  - whether an amount is money in or out is taken, in order of trust, from the running balance (the balance went up or down), a
//    marker on the amount (minus, brackets, CR, DR), then words in the description; if none says, the line is marked "unsure".
// The caller shows the result for the user to check before anything is imported.

export type DateOrder = 'dmy' | 'mdy';
export type SignSource = 'balance' | 'marker' | 'keyword' | 'unknown';

export interface StatementLine {
  dateIso: string;
  description: string;
  /** Negative = money out. */
  amount: number;
  balance?: number;
  signSource: SignSource;
  /** 1-based line of the statement text this came from, to help find it in the PDF. */
  sourceLine: number;
}

export interface StatementParse {
  lines: StatementLine[];
  dateOrder: DateOrder;
  /** True when the order had to be assumed because no date settled it (every day and month is 12 or less). */
  dateOrderAssumed: boolean;
  openingBalance?: number;
  closingBalance?: number;
  /** Does opening balance plus the lines equal the closing balance? Undefined when either balance was not found. */
  reconciles?: boolean;
  /** Lines with a date that could not be read as a transaction (no amount), so the user can look at them. */
  unreadable: string[];
  warnings: string[];
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const valid = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fullYear = (y: number) => (y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y);

interface DateToken {
  /** The text the date occupied, from the start of the line. */
  length: number;
  /** For numeric dates: the three numbers as written. For named months: day, month, year (year may be missing). */
  kind: 'iso' | 'numeric' | 'named';
  a: number;
  b: number;
  c?: number;
}

const DATE_PATTERNS: Array<{ kind: DateToken['kind']; re: RegExp }> = [
  { kind: 'iso', re: /^(\d{4})-(\d{2})-(\d{2})(?!\d)/ },
  { kind: 'numeric', re: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/ },
  { kind: 'named', re: new RegExp(`^(\\d{1,2})[ -]${MON}(?:[ ,-]+(\\d{4}|\\d{2})(?!\\d))?`, 'i') },
  { kind: 'named', re: new RegExp(`^${MON}[ ]+(\\d{1,2})(?!\\d)(?:,?[ ]+(\\d{4})(?!\\d))?`, 'i') },
];

function readDate(s: string): DateToken | null {
  for (const [i, p] of DATE_PATTERNS.entries()) {
    const m = p.re.exec(s);
    if (!m) continue;
    if (p.kind === 'iso') return { kind: 'iso', length: m[0].length, a: Number(m[1]), b: Number(m[2]), c: Number(m[3]) };
    if (p.kind === 'numeric') return { kind: 'numeric', length: m[0].length, a: Number(m[1]), b: Number(m[2]), c: Number(m[3]) };
    if (i === 2) return { kind: 'named', length: m[0].length, a: Number(m[1]), b: MONTHS[m[2].toLowerCase().slice(0, 4) === 'sept' ? 'sept' : m[2].toLowerCase().slice(0, 3)], c: m[3] ? Number(m[3]) : undefined };
    return { kind: 'named', length: m[0].length, a: Number(m[2]), b: MONTHS[m[1].toLowerCase().slice(0, 4) === 'sept' ? 'sept' : m[1].toLowerCase().slice(0, 3)], c: m[3] ? Number(m[3]) : undefined };
  }
  return null;
}

// ── amounts ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const CURRENCY = '(?:GH[SC₵]|[A-Z]{3}|[$€£₵¥₦])';
const AMOUNT_AT_END = new RegExp(`(?:^|\\s)(\\(?[-+]?\\s?${CURRENCY}?\\s?\\(?[-+]?\\d{1,3}(?:[ ,.]\\d{3})*(?:[.,]\\d{2})\\)?(?:\\s?(?:CR|DR|Cr|Dr|cr|dr))?-?)\\s*$`);

export interface Amount {
  value: number;
  /** A sign the text itself gave: brackets, a minus, CR or DR. */
  marker?: 'neg' | 'pos';
}

/** "1,234.56", "1.234,56", "1 234,56", "(50.00)", "-50.00", "50.00 DR", "GHS 50.00" → a number and the sign marker, if any. */
export function parseAmount(token: string): Amount | null {
  let t = token.trim();
  if (!t) return null;
  let marker: Amount['marker'];
  if (/^\(.*\)$/.test(t) || /\(/.test(t) && /\)$/.test(t)) marker = 'neg';
  t = t.replace(/[()]/g, '');
  const tail = /\s?(CR|DR)$/i.exec(t);
  if (tail) { marker = tail[1].toUpperCase() === 'DR' ? 'neg' : 'pos'; t = t.slice(0, tail.index); }
  if (/-$/.test(t)) { marker = 'neg'; t = t.slice(0, -1); }
  if (/^-/.test(t.replace(new RegExp(`^${CURRENCY}\\s?`), '')) || /^-/.test(t)) marker = 'neg';
  else if (/^\+/.test(t)) marker = 'pos';
  t = t.replace(new RegExp(CURRENCY, 'g'), '').replace(/[+\-\s]/g, (c) => (c === ' ' ? ' ' : ''));
  const m = /^(\d{1,3}(?:[ ,.]\d{3})*)([.,]\d{2})$/.exec(t.trim());
  if (!m) return null;
  const whole = m[1].replace(/[ ,.]/g, '');
  const value = Number(`${whole}.${m[2].slice(1)}`);
  return Number.isFinite(value) ? { value, marker } : null;
}

/** Splits trailing amounts off the end of a line: returns the text before them and up to two amounts (amount, balance). */
function splitTrailingAmounts(s: string): { head: string; amounts: Amount[] } {
  let rest = s.trimEnd();
  const found: Amount[] = [];
  for (let i = 0; i < 3; i++) {
    const m = AMOUNT_AT_END.exec(rest);
    if (!m) break;
    const a = parseAmount(m[1]);
    if (!a) break;
    found.unshift(a);
    rest = rest.slice(0, m.index).trimEnd();
  }
  return { head: rest, amounts: found.slice(-2) };
}

// ── words that say which way money moved ──────────────────────────────────────────────────────────────────────────────

const OUT_WORDS = /\b(debit|withdrawal|withdraw|payment to|purchase|pos\b|fee|fees|charge|charges|atm|transfer to|cheque|check no|direct debit|standing order|bill pay|card payment|commission|tax)\b/i;
const IN_WORDS = /\b(credit|deposit|salary|payroll|refund|interest paid|interest earned|transfer from|received|incoming|dividend|reversal)\b/i;

function keywordSign(description: string): -1 | 1 | 0 {
  const out = OUT_WORDS.test(description);
  const inn = IN_WORDS.test(description);
  if (out && !inn) return -1;
  if (inn && !out) return 1;
  return 0;
}

const SKIP_LINE = /^(page \d+|page \d+ of \d+|\d+ of \d+|continued|statement of account|account (number|no)|iban|bic|swift|sort code|branch|customer|date\s+(description|details)|total|totals|summary|balance (b\/?f|brought forward|c\/?f|carried forward))/i;
const OPENING = /^(opening balance|balance brought forward|brought forward|previous balance|balance b\/?f|beginning balance)\b/i;
const CLOSING = /^(closing balance|balance carried forward|carried forward|ending balance|new balance|balance c\/?f)\b/i;

// ── the parser ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ParseOptions {
  /** Force the day/month order. 'auto' (default) reads it from the dates. */
  dateOrder?: DateOrder | 'auto';
  /** The order to assume when no date settles it (most of the world is day first). */
  assumeOrder?: DateOrder;
  /** The year to use for dates written without one. Defaults to the year found in the statement, or this one. */
  year?: number;
}

interface Raw {
  tok: DateToken;
  description: string;
  amount?: Amount;
  balance?: Amount;
  sourceLine: number;
}

export function parseStatement(text: string, opts: ParseOptions = {}): StatementParse {
  const warnings: string[] = [];
  const rawLines = text.replace(/ /g, ' ').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const raws: Raw[] = [];
  const unreadable: string[] = [];
  let opening: number | undefined;
  let closing: number | undefined;
  const years = new Map<number, number>();
  for (const l of rawLines) for (const y of l.match(/\b(20\d{2})\b/g) ?? []) years.set(Number(y), (years.get(Number(y)) ?? 0) + 1);
  const guessYear = opts.year ?? [...years.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? new Date().getFullYear();

  rawLines.forEach((line, idx) => {
    if (!line) return;
    const op = OPENING.exec(line);
    const cl = CLOSING.exec(line);
    if (op || cl) {
      const { amounts } = splitTrailingAmounts(line);
      const a = amounts[amounts.length - 1];
      if (a) {
        const v = a.marker === 'neg' ? -a.value : a.value;
        if (op) opening = v; else closing = v;
      }
      return;
    }
    const tok = readDate(line);
    if (!tok) {
      // a continuation of the description above
      const prev = raws[raws.length - 1];
      if (prev && !SKIP_LINE.test(line) && !/^[\W\d]*$/.test(line) && prev.sourceLine >= idx - 2) {
        const { head, amounts } = splitTrailingAmounts(line);
        if (amounts.length === 0 || (prev.amount === undefined && amounts.length > 0)) {
          if (prev.amount === undefined && amounts.length > 0) { prev.amount = amounts[0]; prev.balance = amounts[1]; prev.description = `${prev.description} ${head}`.trim(); }
          else prev.description = `${prev.description} ${line}`.trim();
        }
      }
      return;
    }
    let after = line.slice(tok.length).trim();
    const second = readDate(after); // a value date or posting date right after the first
    if (second) after = after.slice(second.length).trim();
    const { head, amounts } = splitTrailingAmounts(after);
    raws.push({ tok, description: head, amount: amounts[0], balance: amounts[1], sourceLine: idx + 1 });
    if (amounts.length === 0) unreadable.push(line.slice(0, 100));
  });

  // a row whose amount is on the next line was merged above; the rest without an amount cannot be used
  const rows = raws.filter((r) => r.amount !== undefined);

  // ── day and month order ──
  let order: DateOrder = opts.assumeOrder ?? 'dmy';
  let assumed = false;
  if (opts.dateOrder && opts.dateOrder !== 'auto') order = opts.dateOrder;
  else {
    const numeric = rows.filter((r) => r.tok.kind === 'numeric');
    if (numeric.some((r) => r.tok.a > 12)) order = 'dmy';
    else if (numeric.some((r) => r.tok.b > 12)) order = 'mdy';
    else if (numeric.length > 0) { assumed = true; warnings.push('Every date could be day/month or month/day. Check the order below.'); }
  }

  // ── dates ──
  const dated: Array<Raw & { dateIso: string }> = [];
  for (const r of rows) {
    let y: number; let m: number; let d: number;
    const t = r.tok;
    if (t.kind === 'iso') { y = t.a; m = t.b; d = t.c as number; }
    else if (t.kind === 'numeric') { y = fullYear(t.c as number); [d, m] = order === 'dmy' ? [t.a, t.b] : [t.b, t.a]; }
    else { d = t.a; m = t.b; y = t.c !== undefined ? fullYear(t.c) : guessYear; }
    if (!valid(y, m, d)) { unreadable.push(`${r.description.slice(0, 80)} (date ${t.a}/${t.b}/${t.c ?? '?'})`); continue; }
    dated.push({ ...r, dateIso: iso(y, m, d) });
  }
  if (dated.some((r) => r.tok.kind === 'named' && r.tok.c === undefined)) warnings.push(`Some dates have no year: ${guessYear} was used.`);

  // ── direction of each amount ──
  const out: StatementLine[] = [];
  const haveBalances = dated.length > 0 && dated.every((r) => r.balance !== undefined);
  let prevBalance = opening;
  for (let i = 0; i < dated.length; i++) {
    const r = dated[i];
    const a = r.amount as Amount;
    const bal = r.balance ? (r.balance.marker === 'neg' ? -r.balance.value : r.balance.value) : undefined;
    let sign: -1 | 1 | 0 = 0;
    let source: SignSource = 'unknown';
    if (haveBalances && bal !== undefined && prevBalance !== undefined) {
      const delta = Math.round((bal - prevBalance) * 100) / 100;
      if (Math.abs(Math.abs(delta) - a.value) < 0.011 && delta !== 0) { sign = delta < 0 ? -1 : 1; source = 'balance'; }
    }
    if (sign === 0 && a.marker) { sign = a.marker === 'neg' ? -1 : 1; source = 'marker'; }
    if (sign === 0) { const k = keywordSign(r.description); if (k !== 0) { sign = k; source = 'keyword'; } }
    out.push({ dateIso: r.dateIso, description: r.description || 'Bank transaction', amount: (sign === 0 ? -1 : sign) * a.value, balance: bal, signSource: source, sourceLine: r.sourceLine });
    prevBalance = bal ?? prevBalance;
  }
  const unsure = out.filter((l) => l.signSource === 'unknown').length;
  if (unsure > 0) warnings.push(`${unsure} line${unsure === 1 ? '' : 's'} did not say whether money went in or out and were treated as out. Check the ones marked.`);
  if (out.length === 0) warnings.push('No transactions were recognised. The PDF may be a scan (an image), or laid out in a way this reader cannot follow: import it as CSV instead.');

  let reconciles: boolean | undefined;
  if (opening !== undefined && closing !== undefined && out.length > 0) {
    const sum = out.reduce((s, l) => s + l.amount, 0);
    reconciles = Math.abs(opening + sum - closing) < 0.015 * Math.max(1, out.length);
    if (!reconciles) warnings.push('Opening balance plus these lines does not equal the closing balance: a line was missed, read wrongly, or has the wrong direction.');
  }
  return { lines: out, dateOrder: order, dateOrderAssumed: assumed, openingBalance: opening, closingBalance: closing, reconciles, unreadable: unreadable.slice(0, 10), warnings };
}


/** A stable id for a statement line, so importing the same statement twice adds nothing. `occurrence` separates identical lines on one statement. */
export function lineKey(accountId: string, l: Pick<StatementLine, 'dateIso' | 'amount' | 'description'>, occurrence: number): string {
  let h = 5381;
  for (const c of `${l.description.toLowerCase()}`) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return `pdf-${accountId}-${l.dateIso}-${Math.round(l.amount * 100)}-${(h >>> 0).toString(36)}-${occurrence}`;
}
