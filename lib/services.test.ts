import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerActualsByService, makeServiceLines, monthLabels, parseMonthLabel, parseServices, periodLabel, reconcileServiceLines, serviceLineId, servicesFromKnowledge } from './borga/services';

test('parseServices splits, trims, strips bullets and de-duplicates', () => {
  assert.deepEqual(parseServices('Same-day delivery, Freight; Moving\n• PUDO\n1) freight'), ['Same-day delivery', 'Freight', 'Moving', 'PUDO']);
  assert.deepEqual(parseServices('  ,, ;; '), []);
  assert.equal(parseServices(Array.from({ length: 40 }, (_, i) => 'S' + i).join(',')).length, 24);
  assert.equal(parseServices('x'.repeat(200))[0].length, 60);
});

test('services are recovered from the onboarding knowledge-base sentence', () => {
  assert.deepEqual(servicesFromKnowledge([{ category: 'services', title: 'Key services & differentiators', answer: 'Services: Consulting, Training. Differentiators: speed.' }]), ['Consulting', 'Training']);
  assert.deepEqual(servicesFromKnowledge([{ category: 'services', title: 'x', answer: 'Services: —. Differentiators: —.' }]), []);
  assert.deepEqual(servicesFromKnowledge([{ category: 'company', title: 'About', answer: 'We sell things' }]), []);
});

test('reconcile finds missing services and orphaned generated lines, never touching manual lines', () => {
  const lines = [
    ...makeServiceLines(['Consulting', 'Old service'], 3, 100),
    { id: 'manual', name: 'Custom line', color: '#000', targets: [1, 2, 3], actuals: [0, 0, 0] },
  ];
  const r = reconcileServiceLines(lines, ['consulting', 'Training']);
  assert.deepEqual(r.missing, ['Training']);
  assert.deepEqual(r.orphaned.map((l) => l.name), ['Old service']);
});

test('makeServiceLines builds zeroed, coloured lines with stable ids', () => {
  const [a, b] = makeServiceLines(['Same-Day Delivery', 'Freight'], 4, 1500.4, 1);
  assert.equal(a.id, 'svc-same-day-delivery');
  assert.deepEqual(a.targets, [1500, 1500, 1500, 1500]);
  assert.deepEqual(a.actuals, [0, 0, 0, 0]);
  assert.notEqual(a.color, b.color);
  assert.equal(serviceLineId('  Warehouse / 3PL!! '), 'svc-warehouse-3pl');
});

test('month labels parse and generate consistently', () => {
  assert.deepEqual(parseMonthLabel("Oct '26"), { y: 2026, m: 9 });
  assert.deepEqual(parseMonthLabel('Oct 2026'), { y: 2026, m: 9 });
  assert.deepEqual(parseMonthLabel('2026-10'), { y: 2026, m: 9 });
  assert.equal(parseMonthLabel('Q4'), null);
  assert.deepEqual(monthLabels(2026, 10, 3), ["Nov '26", "Dec '26", "Jan '27"]);
  assert.equal(periodLabel(["Oct '26", "Mar '27"]), 'Oct 2026 → Mar 2027');
});

test('ledger actuals are attributed by category or whole-word mention, ignoring voids and other kinds', () => {
  const months = [{ y: 2026, m: 9 }, { y: 2026, m: 10 }];
  const out = ledgerActualsByService(
    [
      { label: 'Invoice #1 consulting retainer', amount: 1000, category: 'Sales', kind: 'revenue', dateIso: '2026-10-05' },
      { label: 'Training workshop', amount: 400, category: 'Training', kind: 'revenue', dateIso: '2026-11-02' },
      { label: 'Consulting (voided)', amount: 999, category: 'Sales', kind: 'revenue', dateIso: '2026-10-06', voidedAt: '2026-10-07' },
      { label: 'Consulting cost', amount: 50, category: 'Cost', kind: 'expense', dateIso: '2026-10-08' },
      { label: 'Unrelated sale', amount: 70, category: 'Sales', kind: 'revenue', dateIso: '2026-10-09' },
      { label: 'Consultingly mismatch', amount: 5, category: 'Sales', kind: 'revenue', dateIso: '2026-10-10' },
      { label: 'Old consulting', amount: 1, category: 'Sales', kind: 'revenue', dateIso: '2025-01-10' },
    ],
    ['Consulting', 'Training'],
    months,
  );
  assert.deepEqual(out.Consulting, [1000, 0]);
  assert.deepEqual(out.Training, [0, 400]);
});
