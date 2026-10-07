import currencyCodes from 'currency-codes';

/**
 * The ISO 4217 currency list (every active code), with decimal places and a display symbol.
 *
 * "special" codes are real ISO 4217 codes that are not everyday money: precious metals (XAU, XAG, XPD, XPT), the IMF's XDR,
 * the testing code XTS, "no currency" XXX, bond-market units, and fund codes (CHE, CHW, CLF, USN, ...). They stay in the list so
 * that nothing in ISO 4217 is missing, but sit after the real currencies.
 */

export interface CurrencyInfo {
  code: string;
  name: string;
  /** Digits after the decimal point (JPY has 0, KWD has 3). */
  digits: number;
  kind: 'currency' | 'special';
  countries: string[];
}

const SPECIAL = new Set([
  'XAU', 'XAG', 'XPD', 'XPT', 'XDR', 'XTS', 'XXX', 'XBA', 'XBB', 'XBC', 'XBD', 'XSU', 'XUA', // metals, units, test, none
  'BOV', 'CHE', 'CHW', 'CLF', 'COU', 'MXV', 'USN', 'UYI', 'UYW', // funds and indexed units
]);

/**
 * ISO 4217 amendments newer than the currency-codes package (its data is from October 2024). XCG, the Caribbean guilder, replaced
 * the Netherlands Antillean guilder in Curaçao and Sint Maarten in 2025 and is what the geography data uses for them. Remove an
 * entry here once the package includes it (the merge below skips codes it already has).
 */
const SUPPLEMENT: { code: string; name: string; digits: number; countries: string[] }[] = [
  { code: 'XCG', name: 'Caribbean Guilder', digits: 2, countries: ['Curaçao', 'Sint Maarten (Dutch part)'] },
];

export const ALL_CURRENCIES: CurrencyInfo[] = [
  ...currencyCodes.data.map((d) => ({ code: d.code, name: d.currency, digits: d.digits, countries: d.countries })),
  ...SUPPLEMENT.filter((s) => !currencyCodes.code(s.code)),
]
  .map((d) => ({ ...d, kind: SPECIAL.has(d.code) ? ('special' as const) : ('currency' as const) }))
  .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'currency' ? -1 : 1));

const BY_CODE = new Map(ALL_CURRENCIES.map((c) => [c.code, c]));

export const isIsoCurrency = (code: string): boolean => BY_CODE.has(code);
export const currencyInfo = (code: string): CurrencyInfo | undefined => BY_CODE.get(code);
export const currencyDigits = (code: string): number => BY_CODE.get(code)?.digits ?? 2;

// Hand-picked where the generic symbol would be ambiguous (CAD would otherwise show as "$" or "CA$") or is unfamiliar.
const SYMBOL_OVERRIDES: Record<string, string> = { USD: '$', CAD: 'C$', EUR: '€', GBP: '£', GHS: 'GH₵' };
const symbolCache = new Map<string, string>();

/** Display symbol for an ISO code: "$", "C$", "€", "₦", ...; falls back to the code itself when the platform has no symbol. */
export function currencySymbol(code: string): string {
  const upper = (code || '').toUpperCase();
  const cached = symbolCache.get(upper);
  if (cached !== undefined) return cached;
  let sym: string | undefined = SYMBOL_OVERRIDES[upper];
  if (!sym) {
    const part = (display: 'symbol' | 'narrowSymbol') => {
      try {
        return new Intl.NumberFormat('en', { style: 'currency', currency: upper, currencyDisplay: display }).formatToParts(0).find((p) => p.type === 'currency')?.value;
      } catch {
        return undefined;
      }
    };
    // "symbol" keeps currencies distinct ("CA$", "CN¥"); where the English locale has none and just echoes the code (NGN), the
    // narrow form has the local sign ("₦").
    sym = part('symbol');
    if (!sym || sym === upper) sym = part('narrowSymbol') ?? upper;
  }
  const result = sym || upper;
  symbolCache.set(upper, result);
  return result;
}

/** Text shown for one currency in a dropdown: "GHS — Ghana Cedi". */
export const currencyLabel = (c: CurrencyInfo): string => `${c.code} — ${c.name}`;

// ── Formatting ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Symbol plus amount; a symbol made of letters ("KES", "KWD") gets a space so it does not run into the digits. */
const withSymbol = (sym: string, body: string) => `${sym}${/^[A-Za-z]+$/.test(sym) ? ' ' : ''}${body}`;

const group = (n: number, digits: number) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Exact amount in the currency's own decimals: "$1,234.56", "¥1,235" (JPY has none), "KWD 1,234.568" (KWD has three).
 * Use where cents matter (a document total, a ledger line, an activity message).
 */
export function fmtMoneyFull(amount: number, code: string): string {
  if (!Number.isFinite(amount)) return '—';
  const body = group(Math.abs(amount), currencyDigits(code));
  // "-0.00" must not appear for an amount that rounds to zero
  const negative = amount < 0 && Number(body.replace(/,/g, '')) !== 0;
  return `${negative ? '−' : ''}${withSymbol(currencySymbol(code), body)}`;
}

/**
 * Compact amount for cards and tables: "$12.50" under 1,000 (at the currency's own decimals), then "$1.2K", "$2.5M", "$1.1B".
 * Replaces the old fmtNum, which had no millions, did not round amounts under 1,000 and ignored the currency's decimals.
 */
export function fmtMoney(amount: number, code: string): string {
  if (!Number.isFinite(amount)) return '—';
  const a = Math.abs(amount);
  const body = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : group(a, currencyDigits(code));
  const negative = amount < 0 && !/^0(\.0+)?$/.test(body);
  return `${negative ? '−' : ''}${withSymbol(currencySymbol(code), body)}`;
}
