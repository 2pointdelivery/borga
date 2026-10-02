import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOnboarding, normalizeOnboarding, onboardingProgress, pendingOptionalSteps, ONBOARDING_STEP_DEFS, type WorkspaceOnboarding } from './borga/data';

const REQUIRED = ONBOARDING_STEP_DEFS.filter((d) => !d.optional).map((d) => d.id);

test('there are four optional steps (website, AI, email, voice) and the rest are required', () => {
  assert.deepEqual(ONBOARDING_STEP_DEFS.filter((d) => d.optional).map((d) => d.id), ['website', 'ai', 'email', 'voice']);
  assert.ok(REQUIRED.includes('profile') && REQUIRED.includes('valuation'));
});

test('progress counts the required steps only: optional ones never hold it back', () => {
  const o = makeOnboarding();
  assert.deepEqual(onboardingProgress(o), { done: 0, total: REQUIRED.length, pct: 0, complete: false });
  const allRequired: WorkspaceOnboarding = { ...o, steps: o.steps.map((s) => (s.optional ? s : { ...s, completed: true })) };
  const p = onboardingProgress(allRequired);
  assert.equal(p.done, REQUIRED.length);
  assert.equal(p.pct, 100);
  assert.equal(onboardingProgress({ ...allRequired, steps: allRequired.steps.map((s) => ({ ...s, completed: true })) }).total, REQUIRED.length, 'doing the optional ones does not add to the total');
});

test('an onboarding record saved before the optional steps existed is filled in without losing what was done', () => {
  const legacy: WorkspaceOnboarding = {
    started: true, completed: false, currentStep: 'team',
    steps: [{ id: 'profile', title: 'Company profile', description: 'x', href: '/x', completed: true }, { id: 'industry', title: 'Industry', description: 'x', href: '/x', completed: true }],
  };
  const n = normalizeOnboarding(legacy);
  assert.equal(n.steps.length, ONBOARDING_STEP_DEFS.length);
  assert.deepEqual(n.steps.map((s) => s.id), ONBOARDING_STEP_DEFS.map((d) => d.id), 'every step, in order');
  assert.equal(n.steps.find((s) => s.id === 'profile')!.completed, true);
  assert.equal(n.steps.find((s) => s.id === 'financials')!.completed, false);
  assert.equal(n.steps.find((s) => s.id === 'ai')!.optional, true);
  assert.equal(n.currentStep, 'team');
  assert.equal(normalizeOnboarding(undefined).steps.length, ONBOARDING_STEP_DEFS.length);
  assert.deepEqual(normalizeOnboarding(n), n, 'normalising twice changes nothing');
});

test('optional steps still waiting are those neither done nor skipped', () => {
  const o = makeOnboarding();
  assert.deepEqual(pendingOptionalSteps(o).map((s) => s.id), ['website', 'ai', 'email', 'voice']);
  const some: WorkspaceOnboarding = { ...o, steps: o.steps.map((s) => (s.id === 'ai' ? { ...s, completed: true } : s.id === 'email' ? { ...s, skipped: true } : s)) };
  assert.deepEqual(pendingOptionalSteps(some).map((s) => s.id), ['website', 'voice']);
});
