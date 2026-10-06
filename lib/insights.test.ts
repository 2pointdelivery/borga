import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveBusinessInsights, type InsightInput } from './borga/insights';

const base = (): InsightInput => ({
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
});

test('projects over budget raise watch, then critical past 120%', () => {
  const input = base();
  input.projects = [
    { id: 'p1', name: 'Website', description: '', status: 'active', budgetAmount: 1000, createdAt: '2026-01-01' },
    { id: 'p2', name: 'App', description: '', status: 'active', budgetAmount: 1000, createdAt: '2026-01-01' },
  ];
  input.finance = [
    { id: 'f1', label: 'dev', amount: 1100, category: 'x', kind: 'expense', projectId: 'p1' },
    { id: 'f2', label: 'dev', amount: 1300, category: 'x', kind: 'expense', projectId: 'p2' },
  ];
  const out = deriveBusinessInsights(input).filter((i) => i.id === 'in-project-budget');
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'critical', 'worst project is at 130%');
  assert.ok(out[0].detail.includes('App'), 'names the worst project');
  assert.deepEqual(out[0].link, { page: 'projects' });
});

test('active projects with only open tasks read as stalled', () => {
  const input = base();
  input.projects = [{ id: 'p1', name: 'Website', description: '', status: 'active', budgetAmount: 5000, createdAt: '2026-01-01' }];
  input.tasks = [1, 2, 3].map((n) => ({
    id: `t${n}`, title: `task ${n}`, detail: '', priority: 'P2' as const, status: 'todo' as const,
    bucket: 'week' as const, assignee: 'Amy', tags: [], due: 'Friday', progress: 0, projectId: 'p1',
  }));
  const out = deriveBusinessInsights(input).filter((i) => i.id === 'in-project-stalled');
  assert.equal(out.length, 1);
  assert.ok(out[0].detail.includes('Website (3 open)'));
});

test('support breaches are critical and link to the desk', () => {
  const input = base();
  input.support = { active: 4, breached: 2, atRisk: 1, unassigned: 1, compliance: 75 };
  const out = deriveBusinessInsights(input).filter((i) => i.id === 'in-support-risk');
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'critical');
  assert.deepEqual(out[0].link, { page: 'support', tab: 'tickets' });
});

test('stockouts surface with the item names, reorder-level stock stays informational', () => {
  const item = (id: string, name: string, reorderPoint: number) => ({
    id, name, type: 'product' as const, sku: id, barcode: '', category: 'c', description: '',
    unit: 'pc', costPrice: 1, price: 2, taxRate: 0, trackStock: true, reorderPoint, active: true, createdAtIso: '2026-01-01',
  });
  const input = base();
  input.inventoryItems = [item('a', 'Widget', 5), item('b', 'Gadget', 5)];
  input.stockMovements = [
    { id: 'm1', itemId: 'a', warehouseId: 'w', qty: -2, reason: 'sale' as const, at: '2026-01-01' },
    { id: 'm2', itemId: 'b', warehouseId: 'w', qty: 3, reason: 'purchase' as const, at: '2026-01-01' },
  ];
  const out = deriveBusinessInsights(input);
  const stockout = out.filter((i) => i.id === 'in-stockout');
  assert.equal(stockout.length, 1);
  assert.ok(stockout[0].detail.includes('Widget'));
  assert.ok(stockout[0].detail.includes('1 more at/below reorder point'), JSON.stringify(stockout[0]));
});

test('ad spend with zero conversions is flagged as dry spend', () => {
  const input = base();
  input.ads = [
    { id: 'a1', name: 'Spring push', platform: 'linkedin' as const, budget: 500, spent: 200, impressions: 1000, clicks: 10, conversions: 0, roas: 0, status: 'active' },
  ];
  const out = deriveBusinessInsights(input).filter((i) => i.id === 'in-ads-dry');
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'watch');
  assert.deepEqual(out[0].link, { page: 'marketing', tab: 'advertising' });
});

test('unanswered threads and failed calls surface under communications', () => {
  const input = base();
  input.chats = [
    { id: 'c1', leadId: 'l1', clientName: 'Ada', contact: '1', channel: 'whatsapp', agent: 'Nova', messages: [{ id: 'm1', role: 'client', sender: 'Ada', text: 'hi?', at: '2026-01-01' }] },
    { id: 'c2', leadId: 'l2', clientName: 'Bob', contact: '2', channel: 'sms', agent: 'Nova', messages: [{ id: 'm2', role: 'agent', sender: 'Nova', text: 'done', at: '2026-01-01' }] },
  ];
  input.calls = [
    { id: 'call1', agentId: 'a1', agentName: 'Nova', contact: '123', leadName: 'Ada', voice: 'george', status: 'failed', durationSec: 0, note: '', at: '2026-01-01' },
  ];
  const out = deriveBusinessInsights(input);
  const waiting = out.filter((i) => i.id === 'in-comms-waiting');
  assert.equal(waiting.length, 1);
  assert.ok(waiting[0].detail.includes('Ada'));
  assert.deepEqual(waiting[0].link, { page: 'communications', tab: 'inbox' });
  assert.equal(out.filter((i) => i.id === 'in-calls-failed').length, 1);
});

test('pending leave and onboarding surface under hr', () => {
  const input = base();
  input.leaveRequests = [
    { id: 'l1', employeeId: 'e1', employeeName: 'Amy', kind: 'vacation', from: '2026-02-01', to: '2026-02-03', days: 3, reason: 'rest', status: 'pending' },
  ];
  input.employees = [
    { id: 'e2', name: 'Ben', role: 'Dev', department: 'Eng', email: 'b@x.co', employmentType: 'full-time', status: 'onboarding', salary: 50000, location: 'Remote', startedAt: 'Jan 2026', performance: 80 },
  ];
  const out = deriveBusinessInsights(input);
  assert.equal(out.filter((i) => i.id === 'in-leave-pending').length, 1);
  assert.equal(out.filter((i) => i.id === 'in-hr-onboarding').length, 1);
});

test('funding deadlines are critical when overdue, knowledge gaps surface', () => {
  const input = base();
  input.fundraising = [
    { id: 'f1', source: 'Gov', program: 'Grant X', amount: 50000, stage: 'applying', deadline: '2020-01-01', matchScore: 90, url: '', note: '' },
    { id: 'f2', source: 'Gov', program: 'Grant Y', amount: 10000, stage: 'won', deadline: '2026-12-31', matchScore: 70, url: '', note: '' },
  ];
  input.knowledge = [];
  input.kbOpenQuestions = 6;
  const out = deriveBusinessInsights(input);
  const deadlines = out.filter((i) => i.id === 'in-fundraising-deadlines');
  assert.equal(deadlines.length, 1);
  assert.equal(deadlines[0].severity, 'critical');
  assert.deepEqual(deadlines[0].link, { page: 'company', tab: 'fundraising' });
  assert.equal(out.filter((i) => i.id === 'in-knowledge-gaps').length, 1);
});

test('failed runs and idle scheduler surface under automation', () => {
  const failed = deriveBusinessInsights({ ...base(), runsSummary: { failed: 2, queued: 0, scheduledActive: 3 } });
  assert.equal(failed.filter((i) => i.id === 'in-queue-health').length, 1);
  const idle = deriveBusinessInsights({ ...base(), runsSummary: { failed: 0, queued: 0, scheduledActive: 0 } });
  assert.equal(idle.filter((i) => i.id === 'in-scheduler-idle').length, 1);
  const quiet = deriveBusinessInsights({ ...base(), runsSummary: { failed: 0, queued: 0, scheduledActive: 2 } });
  assert.equal(quiet.filter((i) => i.area === 'automation').length, 0);
});

test('banking, revenue, budgets, filings, social, integrations and kpis all surface', () => {
  const input = base();
  input.bankTxns = [
    { id: 't1', bankAccountId: 'b1', date: '2026-01-01', description: 'POS', amount: -10, status: 'unmatched' },
  ];
  input.revenueTracks = [
    { id: 'rt1', name: 'FY', periodLabel: 'p', months: ['Jan'], lines: [{ id: 'rl1', name: 'Delivery', color: '#000', targets: [1000], actuals: [100] }] , createdAt: '2026-01-01' },
  ];
  input.budgets = [];
  input.finance = [{ id: 'f1', label: 'rev', amount: 100, category: 'x', kind: 'revenue' }];
  input.filings = { profile: { entityType: 'corporation', salesTaxFrequency: 'quarterly', custom: [] }, records: [{ key: 'gst|2026-q1', status: 'preparing', dueOverride: '2020-01-01' }] };
  input.posts = [
    { id: 'p1', channel: 'linkedin', content: 'hello world post', status: 'scheduled', scheduledAt: '2026-01-01', author: 'Nova', engagement: { likes: 0, comments: 0, shares: 0 } },
  ];
  input.webhooks = [
    { id: 'w1', name: 'hook', event: 'booking.created', url: 'https://x.example.com/h', secret: 's', active: false, lastDelivery: '', deliveries: 0 },
  ];
  input.mcpServers = [
    { id: 'm1', name: 'Files', url: 'https://mcp.example.com/mcp', authType: 'none', status: 'error', lastSync: '' },
  ];
  input.kpiGroups = [
    { id: 'g1', name: 'Sales', kpis: [{ label: 'Win rate', value: 20, target: 50, unit: '%', delta: 0, valueSet: true }] },
  ];
  const out = deriveBusinessInsights(input);
  for (const id of ['in-bank-unmatched', 'in-revenue-behind', 'in-budget-missing', 'in-filings-open', 'in-social-pending', 'in-integrations-health', 'in-kpi-below']) {
    assert.equal(out.filter((i) => i.id === id).length, 1, id);
  }
  assert.equal(out.find((i) => i.id === 'in-filings-open')?.severity, 'critical');
  assert.deepEqual(out.find((i) => i.id === 'in-kpi-below')?.link, { page: 'overview', tab: 'kpis' });
});

test('a healthy company still gets positive signals, worst-first', () => {
  const input = base();
  input.ads = [
    { id: 'a1', name: 'Spring push', platform: 'linkedin' as const, budget: 500, spent: 100, impressions: 1000, clicks: 50, conversions: 5, roas: 3, status: 'active' },
  ];
  const out = deriveBusinessInsights(input).filter((i) => i.area === 'marketing');
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'positive');
});
