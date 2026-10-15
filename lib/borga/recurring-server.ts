import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import {
  buildBill,
  buildInvoice,
  dueRuns,
  isFinished,
  nextBillNumber,
  nextInvoiceNumber,
  recurringBillRef,
  recurringRef,
  type RecurringBill,
  type RecurringInvoice,
} from './recurring';
import type { Bill, Invoice, TaxProfile } from './data';

/**
 * Recurring billing, server-side: draft invoices and unpaid bills for due
 * occurrences, generated in the heartbeat tick (cron when nobody is around,
 * the browser-driven tick while someone is). Single ownership — the dashboard
 * no longer generates them itself, so two writers can never double-bill one
 * occurrence. Idempotent twice over: occurrences advance generatedCount AND
 * are skipped when a document already carries their ref.
 */

// One generation at a time per company (a manual "run now" during a tick must wait, not double-bill).
const locks = new Map<string, Promise<unknown>>();

function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => undefined));
  return next;
}

export interface RecurringResult {
  invoices: string[];
  bills: string[];
}

/** Generate every due occurrence for one workspace. Never throws: billing must not break the beat. */
export async function runRecurringDocs(u: string, ws: string, todayIso?: string): Promise<RecurringResult> {
  return serialize(`${u}|${ws}`, async () => {
    const out: RecurringResult = { invoices: [], bills: [] };
    try {
      const today = todayIso ?? new Date().toISOString().slice(0, 10);
      const [recInvs, recBills, invoices, bills, taxProfiles] = await Promise.all([
        getBorgaState<RecurringInvoice[]>(userWsKey(u, ws, 'recurringInvoices')).catch(() => null),
        getBorgaState<RecurringBill[]>(userWsKey(u, ws, 'recurringBills')).catch(() => null),
        getBorgaState<Invoice[]>(userWsKey(u, ws, 'invoices')).catch(() => null),
        getBorgaState<Bill[]>(userWsKey(u, ws, 'bills')).catch(() => null),
        getBorgaState<TaxProfile[]>(userWsKey(u, ws, 'taxProfiles')).catch(() => null),
      ]);
      let nextInvoices = invoices ?? [];
      let nextBills = bills ?? [];
      let changedInvoices = false;
      let changedBills = false;
      let changedDefs = false;

      const nextRecInvs = (recInvs ?? []).map((rec) => {
        let cur = rec;
        for (const run of dueRuns(rec, today)) {
          if (!nextInvoices.some((i) => i.externalRef === recurringRef(rec.id, run.index))) {
            const seed = `${Date.now().toString(36)}-${out.invoices.length}`;
            const inv = buildInvoice(rec, run, nextInvoiceNumber(nextInvoices), taxProfiles ?? [], seed);
            nextInvoices = [inv, ...nextInvoices];
            out.invoices.push(inv.number);
            changedInvoices = true;
          }
          cur = { ...cur, generatedCount: run.index + 1, lastGeneratedIso: run.dateIso };
        }
        return { ...cur, status: isFinished(cur) ? ('ended' as const) : cur.status };
      });

      const nextRecBills = (recBills ?? []).map((rec) => {
        let cur = rec;
        for (const run of dueRuns(rec, today)) {
          if (!nextBills.some((b) => b.externalRef === recurringBillRef(rec.id, run.index))) {
            const seed = `${Date.now().toString(36)}-${out.bills.length}`;
            const bill = buildBill(rec, run, nextBillNumber(nextBills), taxProfiles ?? [], seed);
            nextBills = [bill, ...nextBills];
            out.bills.push(bill.number);
            changedBills = true;
          }
          cur = { ...cur, generatedCount: run.index + 1, lastGeneratedIso: run.dateIso };
        }
        return { ...cur, status: isFinished(cur) ? ('ended' as const) : cur.status };
      });

      if (changedInvoices) await setBorgaState(userWsKey(u, ws, 'invoices'), nextInvoices).catch(() => false);
      if (changedBills) await setBorgaState(userWsKey(u, ws, 'bills'), nextBills).catch(() => false);
      const beforeInvs = JSON.stringify(recInvs ?? []);
      const beforeBills = JSON.stringify(recBills ?? []);
      changedDefs = JSON.stringify(nextRecInvs) !== beforeInvs || JSON.stringify(nextRecBills) !== beforeBills;
      if (changedDefs) {
        await setBorgaState(userWsKey(u, ws, 'recurringInvoices'), nextRecInvs).catch(() => false);
        await setBorgaState(userWsKey(u, ws, 'recurringBills'), nextRecBills).catch(() => false);
      }
      if (out.invoices.length || out.bills.length) {
        const { notifyEvent } = await import('./email-notify');
        if (out.invoices.length) await notifyEvent(u, ws, 'recurring_invoices', { numbers: out.invoices }).catch(() => undefined);
        if (out.bills.length) await notifyEvent(u, ws, 'recurring_bills', { numbers: out.bills }).catch(() => undefined);
      }
    } catch (e) {
      console.error('[recurring] generation failed', (e as Error).message);
    }
    return out;
  });
}
