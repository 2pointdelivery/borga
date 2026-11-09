import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowDispatch } from './borga/workflow-dispatch';

test('routes each workflow family to its specialist agent with a concrete goal', () => {
  const cases: Array<[RegExp, string, string]> = [
    [/lead|outreach|sales|prospect|pipeline|deal/i, 'a-sales', 'Atlas'],
    [/content|social|post|linkedin|twitter|blog|seo|marketing/i, 'a-marketing', 'Nova'],
    [/ads|campaign|paid.?media|budget/i, 'a-paidmedia', 'Paige'],
    [/fundrais|grant|investor|pitch|capital/i, 'a-fundraising', 'Nadia'],
    [/ops|dispatch|driver|route|delivery|inventory|stock|warehouse/i, 'a-pm', 'Rigby'],
    [/sync|crm|data|import|export|integration|pipeline.?run/i, 'a-integrations', 'Iris'],
    [/finance|invoice|payment|billing|cash|expense|tax|payroll/i, 'a-finance', 'Sage'],
    [/support|ticket|customer|churn|success/i, 'a-support', 'Spectra'],
    [/brief|fleet|morning|daily|standup|overview|report/i, 'a-borga', 'Borga'],
  ];
  for (const [re, agentId, agentName] of cases) {
    const sample = String(re).replace(/^\/|\/i$/g, '').split('|')[0];
    const d = workflowDispatch(`Weekly ${sample} run`);
    assert.equal(d.agentId, agentId, `agent for "${sample}"`);
    assert.equal(d.agentName, agentName, `name for "${sample}"`);
    assert.ok(d.goal.includes(`"${`Weekly ${sample} run`}"`), 'goal names the workflow');
  }
});

test('unknown workflows go to the orchestrator with a safe goal', () => {
  const d = workflowDispatch('mystery workflow');
  assert.equal(d.agentId, 'a-borga');
  assert.equal(d.agentName, 'Borga');
  assert.ok(d.goal.length > 0 && d.goal.length <= 2000);
});

test('every goal forbids outward actions and demands a SUMMARY', () => {
  for (const name of ['lead outreach', 'fleet brief', 'finance review', 'unknown']) {
    const d = workflowDispatch(name);
    assert.match(d.goal, /approval/);
    assert.match(d.goal, /SUMMARY/);
  }
});

test('long names are truncated and empty names fall back', () => {
  const long = workflowDispatch('x'.repeat(500));
  assert.ok(long.goal.length <= 2000);
  const empty = workflowDispatch('');
  assert.ok(empty.goal.includes('unnamed workflow'));
});
