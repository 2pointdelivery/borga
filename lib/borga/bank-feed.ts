// Merging a bank feed (accounts and transactions read from a bank connection) into the bank accounts and statement lines the company
// already has. Pure, so it is tested on its own. Importing the same feed twice changes nothing: every line is matched by the id
// the bank gave it, and a line the company has already reconciled, excluded or edited is never touched.

import type { BankAccount, BankTxn } from './data';
import type { BankFeed } from './saltedge';

export interface MergeStats {
  accountsAdded: number;
  accountsUpdated: number;
  txnsAdded: number;
  /** Lines already imported earlier. */
  txnsKnown: number;
  /** Lines for an account that is not in the feed. */
  txnsOrphaned: number;
}

export interface MergeResult {
  accounts: BankAccount[];
  txns: BankTxn[];
  stats: MergeStats;
  /** The lines that were added, newest first as they will be shown. */
  added: BankTxn[];
}

const accountIdFor = (externalId: string) => `bank-se-${externalId}`;
const txnIdFor = (externalId: string) => `bt-se-${externalId}`;

export function mergeBankFeed(accounts: BankAccount[], txns: BankTxn[], feed: BankFeed): MergeResult {
  const stats: MergeStats = { accountsAdded: 0, accountsUpdated: 0, txnsAdded: 0, txnsKnown: 0, txnsOrphaned: 0 };
  const nextAccounts = [...accounts];
  const idByExternal = new Map<string, string>();

  for (const fa of feed.accounts) {
    const i = nextAccounts.findIndex((a) => a.externalId === fa.externalId && a.source === 'saltedge');
    if (i >= 0) {
      // the bank's own figures win; the name is the company's to change, so it is left alone
      nextAccounts[i] = { ...nextAccounts[i], balance: fa.balance, institution: fa.institution, currency: fa.currency, status: 'connected', feedConnectionId: feed.connectionId };
      idByExternal.set(fa.externalId, nextAccounts[i].id);
      stats.accountsUpdated++;
    } else {
      const id = accountIdFor(fa.externalId);
      nextAccounts.push({
        id, name: fa.name, institution: fa.institution, currency: fa.currency, last4: fa.last4, kind: fa.kind, balance: fa.balance, source: 'saltedge', status: 'connected',
        externalId: fa.externalId, feedConnectionId: feed.connectionId,
      });
      idByExternal.set(fa.externalId, id);
      stats.accountsAdded++;
    }
  }

  const known = new Set(txns.map((t) => t.externalId).filter((x): x is string => !!x));
  const added: BankTxn[] = [];
  for (const ft of feed.transactions) {
    if (known.has(ft.externalId)) { stats.txnsKnown++; continue; }
    const bankAccountId = idByExternal.get(ft.accountExternalId);
    if (!bankAccountId) { stats.txnsOrphaned++; continue; }
    known.add(ft.externalId);
    added.push({ id: txnIdFor(ft.externalId), bankAccountId, date: ft.dateIso, dateIso: ft.dateIso, description: ft.description, amount: ft.amount, status: 'unmatched', externalId: ft.externalId });
  }
  stats.txnsAdded = added.length;
  // newest first, like the lists the company sees
  added.sort((a, b) => (b.dateIso ?? '').localeCompare(a.dateIso ?? ''));
  return { accounts: nextAccounts, txns: [...added, ...txns], stats, added };
}

/** After a bank is disconnected its accounts stay (with their history) but are marked disconnected. */
export function markFeedDisconnected(accounts: BankAccount[], connectionId: string): BankAccount[] {
  return accounts.map((a) => (a.source === 'saltedge' && a.feedConnectionId === connectionId ? { ...a, status: 'disconnected' as const } : a));
}
