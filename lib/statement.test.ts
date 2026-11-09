import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatement, parseAmount, lineKey } from './borga/statement-parse';

const amounts = (t: string) => parseStatement(t).lines.map((l) => [l.dateIso, l.amount]);

test('amounts in the formats banks print: separators, brackets, minus, CR/DR, currency', () => {
  assert.deepEqual(parseAmount('1,234.56'), { value: 1234.56, marker: undefined });
  assert.deepEqual(parseAmount('1.234,56'), { value: 1234.56, marker: undefined });
  assert.deepEqual(parseAmount('1 234,56'), { value: 1234.56, marker: undefined });
  assert.deepEqual(parseAmount('50.00'), { value: 50, marker: undefined });
  assert.deepEqual(parseAmount('(50.00)'), { value: 50, marker: 'neg' });
  assert.deepEqual(parseAmount('-50.00'), { value: 50, marker: 'neg' });
  assert.deepEqual(parseAmount('50.00-'), { value: 50, marker: 'neg' });
  assert.deepEqual(parseAmount('50.00 DR'), { value: 50, marker: 'neg' });
  assert.deepEqual(parseAmount('50.00 CR'), { value: 50, marker: 'pos' });
  assert.deepEqual(parseAmount('+50.00'), { value: 50, marker: 'pos' });
  assert.deepEqual(parseAmount('GHS 50.00'), { value: 50, marker: undefined });
  assert.deepEqual(parseAmount('$1,000.00'), { value: 1000, marker: undefined });
  assert.deepEqual(parseAmount('-$20.50'), { value: 20.5, marker: 'neg' });
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('12'), null, 'a whole number is not an amount: it has no decimals');
});

test('a statement with a running balance: direction comes from whether the balance went up or down', () => {
  const text = `
    ACME BANK  Statement of account
    Account number 0123456789
    Statement period 01 Sep 2026 - 30 Sep 2026
    Date Description Amount Balance
    Opening balance 10,000.00
    03 Sep 2026 INV-1042 Customer payment 5,200.00 15,200.00
    05 Sep 2026 ECG electricity 1,450.75 13,749.25
    12 Sep 2026 Transfer from savings 300.00 14,049.25
    Page 1 of 1
    Closing balance 14,049.25`;
  const r = parseStatement(text);
  assert.deepEqual(r.lines.map((l) => [l.dateIso, l.amount, l.signSource]), [
    ['2026-09-03', 5200, 'balance'], ['2026-09-05', -1450.75, 'balance'], ['2026-09-12', 300, 'balance'],
  ]);
  assert.equal(r.openingBalance, 10_000);
  assert.equal(r.closingBalance, 14_049.25);
  assert.equal(r.reconciles, true);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.lines[1].description, 'ECG electricity');
});

test('a missed or wrong line shows up as a statement that does not add up', () => {
  const text = `Opening balance 1,000.00
    02 Sep 2026 Rent 200.00 800.00
    09 Sep 2026 Salary 500.00 1,300.00
    Closing balance 1,900.00`;
  const r = parseStatement(text);
  assert.equal(r.reconciles, false);
  assert.ok(r.warnings.some((w) => /does not equal the closing balance/.test(w)));
});

test('day and month order is read from the dates, assumed (and flagged) when nothing settles it, and can be forced', () => {
  const dmy = parseStatement('25/09/2026 Fuel 40.00 DR\n03/10/2026 Sale 90.00 CR');
  assert.equal(dmy.dateOrder, 'dmy');
  assert.equal(dmy.dateOrderAssumed, false);
  assert.deepEqual(dmy.lines.map((l) => l.dateIso), ['2026-09-25', '2026-10-03']);
  const mdy = parseStatement('09/25/2026 Fuel 40.00 DR');
  assert.equal(mdy.dateOrder, 'mdy');
  assert.equal(mdy.lines[0].dateIso, '2026-09-25');
  const unclear = parseStatement('03/04/2026 Fuel 40.00 DR');
  assert.equal(unclear.dateOrderAssumed, true);
  assert.equal(unclear.lines[0].dateIso, '2026-04-03', 'day first by default');
  assert.ok(unclear.warnings.some((w) => /day\/month or month\/day/.test(w)));
  assert.equal(parseStatement('03/04/2026 Fuel 40.00 DR', { dateOrder: 'mdy' }).lines[0].dateIso, '2026-03-04');
  assert.equal(parseStatement('03/04/2026 Fuel 40.00 DR', { assumeOrder: 'mdy' }).lines[0].dateIso, '2026-03-04');
  assert.equal(parseStatement('03.04.26 Fuel 40.00 DR').lines[0].dateIso, '2026-04-03', 'two-digit years and dots');
});

test('the other date styles: ISO, named months with and without a year, and a second date column', () => {
  assert.deepEqual(amounts('2026-09-14 Card 12.50 DR'), [['2026-09-14', -12.5]]);
  assert.deepEqual(amounts('14 Sep 2026 Card 12.50 DR'), [['2026-09-14', -12.5]]);
  assert.deepEqual(amounts('14-Sep-26 Card 12.50 DR'), [['2026-09-14', -12.5]]);
  assert.deepEqual(amounts('Sep 14, 2026 Card 12.50 DR'), [['2026-09-14', -12.5]]);
  assert.deepEqual(amounts('Sept 14 2026 Card 12.50 DR'), [['2026-09-14', -12.5]]);
  const noYear = parseStatement('Statement period 1 Sep 2026 to 30 Sep 2026\n14 Sep Card 12.50 DR');
  assert.equal(noYear.lines[0].dateIso, '2026-09-14');
  assert.ok(noYear.warnings.some((w) => /no year: 2026/.test(w)));
  const twoDates = parseStatement('14 Sep 2026 15 Sep 2026 Card purchase Shell 12.50 DR');
  assert.equal(twoDates.lines[0].dateIso, '2026-09-14', 'the first date is the transaction date');
  assert.equal(twoDates.lines[0].description, 'Card purchase Shell');
  assert.equal(parseStatement('31 Feb 2026 Card 12.50 DR').lines.length, 0, 'an impossible date is not guessed at');
  assert.equal(parseStatement('31 Feb 2026 Card 12.50 DR').unreadable.length, 1);
});

test('direction from markers, then from words, and unsure when neither says', () => {
  const r = parseStatement(`
    02/09/2026 Coffee shop (4.50)
    03/09/2026 Wages 2,000.00 CR
    04/09/2026 ATM withdrawal 100.00
    05/09/2026 Salary July 3,000.00
    06/09/2026 Mystery 77.00`);
  assert.deepEqual(r.lines.map((l) => [l.amount, l.signSource]), [[-4.5, 'marker'], [2000, 'marker'], [-100, 'keyword'], [3000, 'keyword'], [-77, 'unknown']]);
  assert.ok(r.warnings.some((w) => /1 line did not say/.test(w)));
  const both = parseStatement('02/09/2026 Refund of card payment 20.00');
  assert.equal(both.lines[0].signSource, 'unknown', 'words for both directions cancel out: it is unsure');
});

test('a description that wraps onto the next line is joined, and page furniture is ignored', () => {
  const r = parseStatement(`
    03 Sep 2026 Payment to ACME SUPPLIES LIMITED
    REF 55821 INVOICE 7731 -250.00 4,750.00
    Page 2 of 3
    Continued
    04 Sep 2026 Interest paid 1.20 4,751.20`);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[0].description, 'Payment to ACME SUPPLIES LIMITED REF 55821 INVOICE 7731');
  assert.equal(r.lines[0].amount, -250);
  assert.equal(r.lines[1].description, 'Interest paid');
  assert.equal(r.lines[1].amount, 1.2);
});

test('currency codes and symbols, and European number formats, do not confuse the amount', () => {
  assert.deepEqual(amounts('2026-09-14 Netto A/S 1.234,56 DR'), [['2026-09-14', -1234.56]]);
  assert.deepEqual(amounts('2026-09-14 Invoice paid GHS 1,500.00 CR'), [['2026-09-14', 1500]]);
  assert.deepEqual(amounts('2026-09-14 Netflix $15.99 DR'), [['2026-09-14', -15.99]]);
  const r = parseStatement('2026-09-14 Invoice 2026-114 paid 1,500.00 CR');
  assert.equal(r.lines[0].description, 'Invoice 2026-114 paid', 'numbers in the description are left alone');
});

test('lines with a date but no amount are reported, and a statement with nothing readable says so', () => {
  const r = parseStatement('14 Sep 2026 Brought into account\n15 Sep 2026 Shop 10.00 DR');
  assert.equal(r.lines.length, 1);
  assert.equal(r.unreadable.length, 1);
  const none = parseStatement('Welcome to your online banking\nNo transactions this period');
  assert.deepEqual(none.lines, []);
  assert.ok(none.warnings.some((w) => /scan/.test(w)));
});

test('an amount printed on the line after the date is picked up', () => {
  const r = parseStatement('14 Sep 2026 Supplier payment REF 8812\n250.00 DR');
  assert.deepEqual(r.lines.map((l) => [l.description, l.amount]), [['Supplier payment REF 8812', -250]]);
});

test('line keys are stable, tell two identical lines on one statement apart, and differ across accounts', () => {
  const l = { dateIso: '2026-09-05', amount: -4.5, description: 'Coffee shop' };
  assert.equal(lineKey('acc1', l, 0), lineKey('acc1', { ...l }, 0));
  assert.notEqual(lineKey('acc1', l, 0), lineKey('acc1', l, 1));
  assert.notEqual(lineKey('acc1', l, 0), lineKey('acc2', l, 0));
  assert.notEqual(lineKey('acc1', l, 0), lineKey('acc1', { ...l, amount: -4.6 }, 0));
  assert.equal(lineKey('acc1', l, 0), lineKey('acc1', { ...l, description: 'COFFEE SHOP' }, 0), 'case does not matter');
});

// ── a real PDF, end to end ────────────────────────────────────────────────────────────────────────────────────────────

import { pdfToText, StatementPdfError, MAX_PDF_BYTES } from './borga/statement-pdf';

/** A minimal one-page PDF with the given lines of text, one per line, in Helvetica. */
function makePdf(lines: string[], pages = 1): Uint8Array {
  const esc = (s: string) => s.replace(/[\()]/g, '\$&');
  const objs: string[] = [];
  const kids: number[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  objs.push(''); // 2, filled below
  const fontNo = 3;
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3
  for (let p = 0; p < pages; p++) {
    const content = `BT /F1 10 Tf 40 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
    const contentNo = objs.length + 2;
    const pageNo = objs.length + 1;
    kids.push(pageNo);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontNo} 0 R >> >> /Contents ${contentNo} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

test('a PDF statement is read to text and parsed into transactions that add up', async () => {
  const lines = [
    'ACME BANK Statement of account', 'Statement period 01 Sep 2026 - 30 Sep 2026', 'Date Description Amount Balance',
    'Opening balance 10,000.00',
    '03 Sep 2026 Customer payment INV-1042 5,200.00 15,200.00',
    '05 Sep 2026 ECG electricity (1,450.75) 13,749.25',
    '12 Sep 2026 Transfer from savings 300.00 14,049.25',
    'Closing balance 14,049.25',
  ];
  const { text, pages } = await pdfToText(makePdf(lines));
  assert.equal(pages, 1);
  const r = parseStatement(text);
  assert.deepEqual(r.lines.map((l) => [l.dateIso, l.amount]), [['2026-09-03', 5200], ['2026-09-05', -1450.75], ['2026-09-12', 300]]);
  assert.equal(r.reconciles, true);
  assert.equal(r.lines[0].description, 'Customer payment INV-1042');
});

test('text across several pages is read in order', async () => {
  const { text, pages } = await pdfToText(makePdf(['14 Sep 2026 Shell fuel 40.00 DR'], 3));
  assert.equal(pages, 3);
  assert.equal(parseStatement(text).lines.length, 3);
});

test('files that are not usable PDFs are refused with a message a person can act on', async () => {
  await assert.rejects(pdfToText(new Uint8Array()), (e: unknown) => e instanceof StatementPdfError && /empty/.test(e.message));
  await assert.rejects(pdfToText(new TextEncoder().encode('just some text, not a pdf')), (e: unknown) => e instanceof StatementPdfError && /not a PDF/.test(e.message));
  await assert.rejects(pdfToText(new TextEncoder().encode('%PDF-1.4\nthis is damaged')), (e: unknown) => e instanceof StatementPdfError && /damaged|no text/.test(e.message));
  await assert.rejects(pdfToText(makePdf([''])), (e: unknown) => e instanceof StatementPdfError && /scan|no text/.test(e.message), 'a PDF with no text is a scan');
  await assert.rejects(pdfToText(new Uint8Array(MAX_PDF_BYTES + 1)), (e: unknown) => e instanceof StatementPdfError && /larger than/.test(e.message));
});
