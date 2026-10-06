import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from './borga/data';

// ── T31: a brand-new company must not be shown invented figures ────────────────────────────────────────────────────────

test('a fresh company has no sample operations data', () => {
  const o = d.INITIAL_OPS;
  assert.deepEqual([o.clients, o.bookings, o.drivers, o.sla, o.tracking].map((a) => a.length), [0, 0, 0, 0, 0]);
  assert.equal(o.analytics.series.length, 0);
  assert.equal(o.analytics.revenue, 0);
  assert.equal(o.analytics.activeFleet, 0);
  assert.ok(Object.values(o.analytics.byStatus).every((n) => n === 0));
});

test('the knowledge base starts empty (no placeholder answers that agents would read as facts)', () => {
  assert.equal(d.KNOWLEDGE_SEED.length, 0);
  assert.ok(!JSON.stringify(d.KNOWLEDGE_SEED).includes('Replace this placeholder'));
});

test('KPI cards start with best-practice targets but no invented values or trends', () => {
  assert.ok(d.INITIAL_KPI_GROUPS.length > 0);
  let seededTargets = 0;
  for (const g of d.INITIAL_KPI_GROUPS) {
    assert.ok(g.kpis.length > 0, g.id);
    for (const k of g.kpis) {
      // No invented measurements: values and trends always start at zero, and
      // the KPI stays unmeasured until live data or the user supplies a value.
      assert.deepEqual([k.value, k.delta], [0, 0], `${g.id}/${k.label}`);
      assert.equal(k.valueSet, false, `${g.id}/${k.label}`);
      // Targets are best-practice starting benchmarks the user can edit.
      assert.ok(k.target >= 0, `${g.id}/${k.label}`);
      if (k.target > 0) seededTargets++;
    }
  }
  assert.ok(seededTargets > 0, 'at least some best-practice targets are seeded by default');
});

test('goal KPI presets are curated, unique best-practice targets', () => {
  assert.ok(d.GOAL_KPI_PRESETS.length >= 8, 'enough presets to cover the main departments');
  assert.equal(new Set(d.GOAL_KPI_PRESETS).size, d.GOAL_KPI_PRESETS.length, 'no duplicate presets');
  for (const p of d.GOAL_KPI_PRESETS) assert.ok(p.length > 0 && p.length <= 48, p);
});

test('retired LLM providers and the demo model migrate to the current default', () => {
  assert.deepEqual(d.normalizeLlmSelection(null), d.DEFAULT_LLM);
  assert.deepEqual(d.normalizeLlmSelection({ ...d.DEFAULT_LLM, providerId: 'llm-demo', model: 'demo' }), d.DEFAULT_LLM);
  assert.deepEqual(d.normalizeLlmSelection({ ...d.DEFAULT_LLM, providerId: 'llm-ollama', model: 'llama3.2' }), d.DEFAULT_LLM);
  const keep = { providerId: 'llm-groq', model: 'x', online: true, latency: 5 };
  assert.deepEqual(d.normalizeLlmSelection(keep), keep);
  assert.deepEqual(d.normalizeLlmSelection({ ...keep, model: 'demo' }), { ...keep, model: d.DEFAULT_LLM.model });
});

test('agents start with no invented track record', () => {
  assert.ok(d.AGENTS.length > 0);
  for (const a of d.AGENTS) assert.deepEqual([a.tasksCompleted, a.accuracy], [0, 0], a.name);
  // an empty model means "workspace default"; seeded ids like nvidia/mixtral-8x22b exist in no catalog and would fail with a key
  for (const a of d.AGENTS) assert.equal(a.model, '', `${a.name} must follow the workspace default model`);
});

test('sample scheduled tasks are switched off templates, not automation nobody asked for', () => {
  assert.ok(d.INITIAL_SCHEDULED_TASKS.length > 0);
  for (const t of d.INITIAL_SCHEDULED_TASKS) assert.deepEqual([t.enabled, t.nextRun], [false, null], t.name);
});

test('every agent is brain-linked and orchestrated by default', () => {
  for (const a of d.AGENTS) {
    assert.equal(a.brainLinked, true, `${a.name} must be linked to the shared brain`);
    assert.equal(a.orchestratorId, 'a-borga', `${a.name} must be orchestrated by the command center`);
    assert.equal(a.model, '', `${a.name} must follow the workspace default model`);
  }
  // Users can add agents; the default keeps them orchestrated.
  const withDefaults = d.withBrainDefaults({ id: 'x', name: 'Test', role: 'r', department: 'd', status: 'idle', avatarColor: '#000', skills: [], description: '', tasksCompleted: 0, accuracy: 0, brainLinked: true });
  assert.equal(withDefaults.model, '');
  assert.equal(withDefaults.brainLinked, true);
  assert.equal(withDefaults.orchestratorId, 'a-borga');
});

test('every business-data list starts empty', () => {
  for (const name of [
    'INITIAL_ADS', 'INITIAL_APPROVALS', 'INITIAL_BANK_ACCOUNTS', 'INITIAL_BANK_TXNS', 'INITIAL_BILLS', 'INITIAL_BROWSES', 'INITIAL_BUDGETS',
    'INITIAL_CALLS', 'INITIAL_CHATS', 'INITIAL_CONTACTS', 'INITIAL_CUSTOMERS', 'INITIAL_EMPLOYEES', 'INITIAL_FINANCE', 'INITIAL_FUNDRAISING',
    'INITIAL_GOALS', 'INITIAL_INVOICES', 'INITIAL_JOURNAL', 'INITIAL_LEADS', 'INITIAL_LEAVE', 'INITIAL_MEMORIES', 'INITIAL_MESSAGES',
    'INITIAL_POSTS', 'INITIAL_PROJECTS', 'INITIAL_REVENUE_TRACKS', 'INITIAL_TASKS', 'INITIAL_VENDORS', 'INITIAL_WEBHOOKS', 'INITIAL_WORKSPACES',
  ] as const) {
    assert.equal((d[name] as unknown[]).length, 0, `${name} must start empty`);
  }
});

test('voice is opt-in: the always-listening microphone and spoken greeting are off by default', () => {
  assert.equal(d.DEFAULT_SETTINGS.notifications.voice, false);
  assert.equal(d.DEFAULT_SETTINGS.autonomousMode, false);
});

// ── T32: country-aware tax defaults ───────────────────────────────────────────────────────────────────────────────────

test('country names map to the right tax region', () => {
  for (const c of ['USA', 'US', 'U.S.A.', 'United States', ' united states of america ']) assert.equal(d.taxRegionFor(c), 'US', c);
  for (const c of ['Canada', 'CA', 'canada']) assert.equal(d.taxRegionFor(c), 'CA', c);
  for (const c of ['Ghana', 'GH', 'ghana ']) assert.equal(d.taxRegionFor(c), 'GH', c);
  for (const c of ['', undefined, null, 'France', 'Germany']) assert.equal(d.taxRegionFor(c), 'OTHER', String(c));
  assert.equal(d.taxRegionFor('Denmark'), 'DK');
  assert.equal(d.taxRegionFor('danmark'), 'DK');
});

test('every preset has exactly one default, unique ids, and a zero-rated option', () => {
  for (const [region, p] of Object.entries(d.TAX_PRESETS)) {
    assert.equal(p.profiles.filter((t) => t.isDefault).length, 1, `${region}: exactly one default`);
    assert.equal(new Set(p.profiles.map((t) => t.id)).size, p.profiles.length, `${region}: unique ids`);
    assert.ok(p.profiles.some((t) => t.rate === 0 && t.id === 'tax-zero'), `${region}: zero-rated`);
    assert.ok(p.note.length > 20, `${region}: has a note`);
  }
});

test('only certain rates are filled in; everything uncertain starts at 0% for the company to enter', () => {
  const rate = (region: d.TaxRegion, id: string) => d.TAX_PRESETS[region].profiles.find((t) => t.id === id)?.rate;
  assert.equal(rate('CA', 'tax-ca-gst'), 5);
  assert.equal(rate('CA', 'tax-ca-hst-on'), 13);
  assert.equal(rate('CA', 'tax-ca-other'), 0);
  assert.equal(rate('GH', 'tax-gh-vat'), 15);
  assert.equal(rate('GH', 'tax-gh-levy'), 0);
  assert.equal(rate('US', 'tax-us-sales'), 0, 'the US has no federal rate: state and local rates are entered by the company');
  // an unknown country must not default to somebody else's tax rate (the old seed charged 20% everywhere)
  const unknown = d.INITIAL_TAX_PROFILES.find((t) => t.id === d.defaultTaxIdOf(d.INITIAL_TAX_PROFILES))!;
  assert.equal(unknown.rate, 0);
  assert.equal(d.DEFAULT_TAX_PROFILE_ID, unknown.id);
});

test('an untouched tax setup may be replaced by a country preset; an edited one never is', () => {
  assert.equal(d.isUntouchedTaxSetup(d.INITIAL_TAX_PROFILES), true);
  assert.equal(d.isUntouchedTaxSetup(d.TAX_PRESETS.CA.profiles), true);
  // a company that still has the old seeded profiles (Standard 20%) has not edited anything
  const legacy: d.TaxProfile[] = [{ id: 'tax-standard', name: 'Standard', rate: 20, category: 'vat' }, { id: 'tax-zero', name: 'Zero-rated', rate: 0, category: 'custom' }];
  assert.equal(d.isUntouchedTaxSetup(legacy), true);
  // edited rate, added profile, or renamed id all count as touched
  assert.equal(d.isUntouchedTaxSetup(d.TAX_PRESETS.US.profiles.map((t) => (t.id === 'tax-us-sales' ? { ...t, rate: 7.25 } : t))), false);
  assert.equal(d.isUntouchedTaxSetup([...d.TAX_PRESETS.CA.profiles, { id: 'tax-mine', name: 'Mine', rate: 8, category: 'custom' }]), false);
});

test('the default profile is found from the flag, then the legacy id, then the first', () => {
  assert.equal(d.defaultTaxIdOf(d.TAX_PRESETS.GH.profiles), 'tax-gh-vat');
  assert.equal(d.defaultTaxIdOf([{ id: 'a', name: 'A', rate: 1, category: 'vat' }, { id: 'tax-standard', name: 'S', rate: 20, category: 'vat' }]), 'tax-standard');
  assert.equal(d.defaultTaxIdOf([{ id: 'a', name: 'A', rate: 1, category: 'vat' }, { id: 'b', name: 'B', rate: 2, category: 'vat' }]), 'a');
  assert.equal(d.defaultTaxIdOf([]), d.DEFAULT_TAX_PROFILE_ID);
});

test('the Ghana cedi is a supported currency', () => {
  assert.equal(d.CURRENCY_SYMBOL.GHS, 'GH₵');
  for (const c of ['USD', 'CAD', 'GHS'] as const) assert.ok(d.CURRENCY_SYMBOL[c]);
});
