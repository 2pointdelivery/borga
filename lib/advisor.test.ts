import test from 'node:test';
import assert from 'node:assert/strict';
import { answerAdvisorQuestion, detectAdvisorTopics, routeAdvisorTopic, type AdvisorContext } from './borga/advisor';

const ctx = (p: Partial<AdvisorContext> = {}): AdvisorContext => ({
  finance: [],
  invoices: [],
  bills: [],
  vendors: [],
  customers: [],
  leads: [],
  goals: [],
  journals: [],
  bankTxns: [],
  bankAccounts: [],
  employees: [],
  workspaceName: 'Acme',
  money: (n) => `$${n}`,
  nowMs: Date.parse('2026-09-28T12:00:00Z'),
  ...p,
});

test('cash question reports runway from real balances', () => {
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const a = answerAdvisorQuestion('What is our cash runway?', ctx({
    bankAccounts: [{ balance: 12000 } as never],
    finance: [
      { id: 'e1', label: 'rent', amount: 3000, category: 'x', kind: 'expense', dateIso: ago(5) },
      { id: 'e2', label: 'rent', amount: 3000, category: 'x', kind: 'expense', dateIso: ago(35) },
      { id: 'e3', label: 'rent', amount: 3000, category: 'x', kind: 'expense', dateIso: ago(65) },
    ],
  }));
  assert.ok(a.text.includes('$12000'), a.text);
  assert.ok(a.text.includes('4.0 months'), a.text);
  assert.deepEqual(a.link, { page: 'finance', tab: 'banking' });
});

test('receivables name who owes and the worst invoice', () => {
  const a = answerAdvisorQuestion('who owes us money?', ctx({
    invoices: [
      { id: 'i1', number: 'INV-1', client: 'Big Co', amount: 5000, status: 'overdue' },
      { id: 'i2', number: 'INV-2', client: 'Small Co', amount: 500, status: 'sent' },
    ] as never,
  }));
  assert.ok(a.text.includes('INV-1') || a.text.includes('Big Co'), a.text);
  assert.ok(a.text.includes('overdue') || a.text.includes('1 overdue'), a.text);
});

test('pipeline question forecasts with stage weights', () => {
  const a = answerAdvisorQuestion('how is the pipeline?', ctx({
    leads: [
      { id: 'l1', stage: 'proposal', value: 10000 },
      { id: 'l2', stage: 'new', value: 10000 },
      { id: 'l3', stage: 'won', value: 5000 },
    ] as never,
  }));
  assert.ok(a.text.includes('$7000'), a.text); // 0.6*10000 + 0.1*10000
  assert.ok(a.text.includes('$5000'), a.text); // closed-won
});

test('brief lists the top priorities with actions', () => {
  const a = answerAdvisorQuestion('morning brief', ctx({
    goals: [{ id: 'g1', title: 'Launch v2', objective: '', kpis: '', owner: '', due: '', status: 'behind', progress: 20 }],
  }));
  assert.ok(a.text.includes('off track'), a.text);
  assert.ok(a.text.includes('1.'), a.text);
});

test('support question works without ticket data and with it', () => {
  const missing = answerAdvisorQuestion('any SLA risk?', ctx());
  assert.ok(missing.text.includes('Could not load'), missing.text);
  const present = answerAdvisorQuestion('any SLA risk?', ctx({
    support: { active: 3, breached: 1, atRisk: 1, unassigned: 2, compliance: 80 },
  }));
  assert.ok(present.text.includes('2 need SLA attention'), present.text);
  assert.ok(present.text.includes('unassigned'), present.text);
});

test('unknown questions get an honest pointer, empty gets prompting', () => {
  assert.ok(answerAdvisorQuestion('tell me a joke', ctx()).text.includes('morning brief'));
  assert.ok(answerAdvisorQuestion('   ', ctx()).text.includes('Ask me about'));
});

test('new menus answer: comms, fundraising, automation, banking, filings, kpis', () => {
  const comms = answerAdvisorQuestion('comms backlog?', ctx({
    chats: [{ id: 'c1', leadId: 'l1', clientName: 'Ada', contact: '1', channel: 'whatsapp', agent: 'N', messages: [{ id: 'm', role: 'client', sender: 'Ada', text: 'hi', at: 'x' }] }] as never,
  }));
  assert.ok(comms.text.includes('1 thread'), comms.text);
  assert.deepEqual(comms.link, { page: 'communications', tab: 'inbox' });

  const fund = answerAdvisorQuestion('funding deadlines?', ctx({
    fundraising: [{ id: 'f1', program: 'Grant X', stage: 'applying', deadline: '2026-10-01', matchScore: 90 }] as never,
  }));
  assert.ok(fund.text.includes('Grant X'), fund.text);

  const auto = answerAdvisorQuestion('queue healthy?', ctx({
    runsSummary: { queued: 6, running: 1, failed: 0, scheduledActive: 2 },
  }));
  assert.ok(auto.text.includes('6 queued'), auto.text);

  const bank = answerAdvisorQuestion('bank reconciled?', ctx({
    bankTxns: [{ id: 't1', status: 'unmatched' }] as never,
  }));
  assert.ok(bank.text.includes('1 bank line'), bank.text);

  const filings = answerAdvisorQuestion('filings due?', ctx({
    filings: { records: [{ key: 'gst|q1', status: 'preparing', dueOverride: '2020-01-01' }] } as never,
  }));
  assert.ok(filings.text.includes('overdue') || filings.text.includes('1 filing'), filings.text);

  const kpis = answerAdvisorQuestion('KPIs on track?', ctx({
    kpiGroups: [{ id: 'g', name: 'Sales', kpis: [{ label: 'Win rate', value: 20, target: 50, unit: '%', delta: 0, valueSet: true }] }] as never,
  }));
  assert.ok(kpis.text.includes('Win rate'), kpis.text);
});

test('keyword detection hears multiple topics while typing', () => {
  assert.deepEqual(detectAdvisorTopics(''), []);
  assert.deepEqual(detectAdvisorTopics('cash is tight and invoices are late'), ['cash', 'receivables']);
  assert.deepEqual(detectAdvisorTopics('hello there'), []);
  assert.equal(routeAdvisorTopic('cash runway?'), 'cash');
  assert.equal(routeAdvisorTopic('tell me a joke'), null);
});

test('follow-ups resolve against the last topic', () => {
  const c = ctx({
    bankAccounts: [{ balance: 12000 } as never],
    finance: [{ id: 'e1', label: 'rent', amount: 3000, category: 'x', kind: 'expense', dateIso: new Date().toISOString().slice(0, 10) }],
  });
  const first = answerAdvisorQuestion('cash runway?', c, { topic: null });
  assert.ok(first.text.includes('$12000'), first.text);
  const more = answerAdvisorQuestion('tell me more', c, { topic: 'cash' });
  assert.ok(more.text.includes('Going deeper'), more.text);
  assert.ok(more.text.includes('$12000'), more.text);
  const action = answerAdvisorQuestion('what do you recommend?', c, { topic: 'cash' });
  assert.ok(action.text.toLowerCase().includes('recommendation') || action.text.includes('Do this next'), action.text);
  const thanks = answerAdvisorQuestion('thanks!', c, { topic: 'cash' });
  assert.ok(thanks.text.includes('Anytime'), thanks.text);
  // No memory + no keywords still gets the honest pointer.
  assert.ok(answerAdvisorQuestion('tell me more', c).text.includes('morning brief'));
});
