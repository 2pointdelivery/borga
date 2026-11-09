import type { AccountType } from './data';

/**
 * Double-entry (IFRS) debit/credit standard, kept pure (no I/O) so it can be
 * unit tested. Every journal balances debits = credits; an account's *normal
 * side* is where increases go:
 * - Dr normal: assets, costs (COGS) and expenses — a debit increases them.
 * - Cr normal: liabilities, equity and revenue — a credit increases them.
 *
 * Display rule: a balance's *sign* decides its column (net debits → Dr,
 * net credits → Cr), so total Dr always equals total Cr on balanced books.
 * The account type only decides the human-readable hint, never the column.
 */

/** Normal balance side per account type. */
export const NORMAL_SIDE: Record<AccountType, 'Dr' | 'Cr'> = {
  asset: 'Dr',
  cost: 'Dr',
  expense: 'Dr',
  liability: 'Cr',
  equity: 'Cr',
  revenue: 'Cr',
};

export function isDebitNormal(type: AccountType): boolean {
  return NORMAL_SIDE[type] === 'Dr';
}

/** Split a net debit−credit delta into true Dr / Cr balances. */
export function splitDrCr(delta: number): { dr: number; cr: number } {
  return { dr: Math.max(0, delta), cr: Math.max(0, -delta) };
}

/** Short normal-side tag shown next to account-type labels. */
export const NORMAL_SIDE_SHORT: Record<AccountType, string> = {
  asset: 'Dr normal · Dr increases · Cr decreases',
  cost: 'Dr normal · Dr increases · Cr decreases',
  expense: 'Dr normal · Dr increases · Cr decreases',
  liability: 'Cr normal · Cr increases · Dr decreases',
  equity: 'Cr normal · Cr increases · Dr decreases',
  revenue: 'Cr normal · Cr increases · Dr decreases',
};

/** Full human-readable hint per account type: which side increases it. */
export const ACCOUNT_SIDE_HINT: Record<AccountType, string> = {
  asset: 'Debit-normal: a debit (Dr) increases an asset, a credit (Cr) decreases it.',
  cost: 'Debit-normal: a debit (Dr) increases cost of sales, a credit (Cr) decreases it.',
  expense: 'Debit-normal: a debit (Dr) increases an expense, a credit (Cr) decreases it.',
  liability: 'Credit-normal: a credit (Cr) increases a liability, a debit (Dr) decreases it.',
  equity: 'Credit-normal: a credit (Cr) increases equity, a debit (Dr) decreases it.',
  revenue: 'Credit-normal: a credit (Cr) increases revenue, a debit (Dr) decreases it.',
};

/** One-line legend for trial-balance headers and report footers. */
export const DR_CR_LEGEND =
  'Debits (Dr) increase assets, costs and expenses, and decrease liabilities, equity and revenue. Credits (Cr) do the opposite. Every journal balances: total Dr = total Cr.';

/** Compact per-line hint for journal rows, e.g. "Cash — Dr ↑ increases · Cr ↓ decreases". */
export function journalLineHint(accountName: string, type: AccountType): string {
  const side = NORMAL_SIDE[type];
  return `${accountName} (${type}, ${side} normal): ${side === 'Dr' ? 'Dr ↑ increases · Cr ↓ decreases' : 'Cr ↑ increases · Dr ↓ decreases'}`;
}
