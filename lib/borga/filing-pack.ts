// A one-page filing pack for the person who prepares the return: who the company is, what is being filed and when, the figures, a
// checklist for that kind of return, and sign-off lines. It is a self-contained HTML file: open it, print it, or send it to the accountant.

import type { Workspace } from './data';
import { fmtMoneyFull } from './currencies';
import type { FilingFigures } from './filing-figures';
import type { FilingRecord, Obligation, Period } from './filing-catalog';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CHECKLIST: Record<string, string[]> = {
  salesTax: [
    'Every invoice and bill dated in the period is entered, and none is entered twice.',
    'Invoices still marked draft, and bills not yet received, are left out on purpose.',
    'Each purchase claimed has a valid supplier invoice and was for the business.',
    'Zero-rated, exempt and out-of-province sales are treated the way the authority expects.',
    'The totals above agree with the sales and purchases accounts in the ledger.',
    'Any amount owing is paid by the due date, even if the return is filed later.',
  ],
  income: [
    'Revenue and expenses agree with the ledger and the bank statements for the whole year.',
    'Payroll, depreciation (capital cost allowance), interest, owner pay and non-deductible items are added.',
    'Losses and credits carried forward from earlier years are applied.',
    'Instalments already paid during the year are credited.',
    'Related-party and foreign transactions the form asks about are disclosed.',
  ],
  payroll: [
    'Every person paid in the period is on the payroll list, with the right start and end dates.',
    'Tax withheld and the employer contributions come from the payroll provider, not from this page.',
    'Remittances are paid by the due date; slips and summaries agree with the year\'s total.',
  ],
  none: ['The amount and the due date are confirmed with the authority\'s notice or online account.'],
};

export function buildFilingPack(args: {
  company: Pick<Workspace, 'name' | 'legalName' | 'businessNumber' | 'taxNumber' | 'addressLine' | 'city' | 'state' | 'country' | 'fiscalYearEndMonth' | 'fiscalYearEndDay'>;
  ob: Obligation;
  period: Period;
  label: string;
  due: string | null;
  figures: FilingFigures | null;
  record?: FilingRecord;
  currency: string;
  generatedOn: string;
}): string {
  const { company: c, ob, period, label, due, figures, record, currency, generatedOn } = args;
  const money = (n: number, count?: boolean) => (count ? String(n) : fmtMoneyFull(n, currency));
  const addr = [c.addressLine, c.city, c.state, c.country].filter(Boolean).join(', ');
  const rows = figures?.lines.map((l) => `<tr${l.strong ? ' class="s"' : ''}><td>${esc(l.label)}</td><td class="n">${esc(money(l.amount, l.count))}</td></tr>`).join('') ?? '';
  const list = (CHECKLIST[figures?.basis ?? ob.figures] ?? CHECKLIST.none).map((t) => `<li><span class="box"></span>${esc(t)}</li>`).join('');
  const notes = (figures?.notes ?? []).map((n) => `<li>${esc(n)}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(ob.name)} — ${esc(label)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:760px;margin:2rem auto;padding:0 1rem}
h1{font-size:20px;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin:1.6rem 0 .4rem}
table{border-collapse:collapse;width:100%}td{padding:5px 0;border-bottom:1px solid #ddd}td.n{text-align:right;font-family:ui-monospace,monospace}
tr.s td{font-weight:600}.meta td{border:0;padding:2px 0}.meta td:first-child{color:#555;width:11rem}
ul{padding-left:1.1rem;color:#444;font-size:12px}ul.check{list-style:none;padding:0;font-size:13px;color:#111}
.box{display:inline-block;width:12px;height:12px;border:1px solid #333;margin-right:8px;vertical-align:-2px}
.sign{display:flex;gap:2rem;margin-top:2rem}.sign div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:12px;color:#555}
.warn{background:#fff7e6;border:1px solid #f0c36d;padding:8px 10px;font-size:12px;margin-top:1.5rem}
@media print{body{margin:0}}
</style></head><body>
<h1>${esc(ob.name)}${ob.form ? ` · Form ${esc(ob.form)}` : ''}</h1>
<p style="margin:.2rem 0;color:#555">${esc(ob.authority)} · ${esc(label)}</p>
<h2>Company</h2>
<table class="meta">
<tr><td>Legal name</td><td>${esc(c.legalName || c.name)}</td></tr>
${c.businessNumber ? `<tr><td>Business number</td><td>${esc(c.businessNumber)}</td></tr>` : ''}
${c.taxNumber ? `<tr><td>Tax / VAT / EIN number</td><td>${esc(c.taxNumber)}</td></tr>` : ''}
${addr ? `<tr><td>Address</td><td>${esc(addr)}</td></tr>` : ''}
<tr><td>Reporting currency</td><td>${esc(currency)}</td></tr>
</table>
<h2>This filing</h2>
<table class="meta">
<tr><td>Period</td><td>${esc(period.start)} to ${esc(period.end)}</td></tr>
<tr><td>Due</td><td>${esc(due ?? 'to be confirmed')}${record?.dueOverride ? ' (set by the company)' : ''}</td></tr>
<tr><td>Status</td><td>${esc(record ? record.status.replace('-', ' ') : 'open')}${record?.filedOn ? ` on ${esc(record.filedOn)}` : ''}${record?.reference ? `, confirmation ${esc(record.reference)}` : ''}</td></tr>
${record?.preparer ? `<tr><td>Prepared by</td><td>${esc(record.preparer)}</td></tr>` : ''}
${record?.reviewer ? `<tr><td>Reviewed by</td><td>${esc(record.reviewer)}</td></tr>` : ''}
</table>
${ob.note ? `<p style="font-size:12px;color:#555">${esc(ob.note)}</p>` : ''}
${figures ? `<h2>Figures from the books</h2><table>${rows}</table><ul>${notes}</ul>` : ''}
<h2>Before filing</h2><ul class="check">${list}</ul>
<div class="sign"><div>Prepared by / date</div><div>Reviewed by / date</div><div>Filed by / date</div></div>
<p class="warn">Prepared from the company's own records on ${esc(generatedOn)}. This is a worksheet, not a tax return or tax advice: the figures come from invoices, bills and the people list only, and the due date is the general rule. Confirm both with the authority or your accountant${ob.url ? ` (${esc(ob.url)})` : ''}.</p>
</body></html>`;
}
