import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApplicationDraft,
  companyProfileFrom,
  extractFundingRequirements,
  scoreFundingFit,
  type CompanyProfile,
} from './borga/funding-analysis';

const PAGE = `
EIC Accelerator Grant 2026. Grants of up to $2.5m for deep-tech startups.
Eligibility: applicants must be a registered startup with fewer than 250 employees.
Companies must have been in operation for at least 1 year. Revenue under $50m qualifies.
What we expect: quarterly progress reports and a final report at project end.
Funds are paid in tranches against agreed milestones, with monitoring visits.
To apply submit: a completed application form, a 10-page business plan,
audited financial statements, your pitch deck, and founder CVs.
Deadline: apply by March 15, 2026. Late entries are not evaluated.
`;

test('extracts requirements, expectations, documents, deadline and amount', () => {
  const r = extractFundingRequirements(PAGE);
  assert.ok(r.requirements.includes('Eligibility'), r.requirements);
  assert.ok(r.requirements.split('\n').length >= 2);
  assert.ok(r.expectations.toLowerCase().includes('quarterly progress reports'), r.expectations);
  assert.ok(r.documentsNeeded.includes('Business plan'), JSON.stringify(r.documentsNeeded));
  assert.ok(r.documentsNeeded.includes('Pitch deck'), JSON.stringify(r.documentsNeeded));
  assert.ok(r.documentsNeeded.includes('Founder CVs'), JSON.stringify(r.documentsNeeded));
  assert.ok(r.deadline?.includes('2026'), r.deadline);
  assert.equal(r.amount, 2_500_000);
});

test('empty pages degrade to honest placeholders, never empty strings', () => {
  const r = extractFundingRequirements('Hello world, this page says nothing useful at all about funding programs.');
  assert.ok(r.requirements.includes('No explicit eligibility'), r.requirements);
  assert.ok(r.expectations.includes('No explicit deliverables'), r.expectations);
  assert.deepEqual(r.documentsNeeded, []);
});

const profile: CompanyProfile = {
  name: 'Acme Logistics',
  industry: 'logistics',
  country: 'Ghana',
  services: ['Same-day delivery', 'Warehousing'],
  about: 'Tech-enabled logistics across Ghana.',
};

test('fit scoring rewards industry, service and country matches', () => {
  const fit = scoreFundingFit(
    { program: 'Ghana Logistics Growth Grant', source: 'Gov', note: 'for delivery startups', requirements: 'Applicants must run warehousing operations.' },
    profile,
  );
  assert.ok(fit.score >= 80, `${fit.score}: ${fit.reasons.join(' ')}`);
  const cold = scoreFundingFit(
    { program: 'Nordic Fisheries Fund', source: 'Oslo', note: 'for arctic trawlers' },
    profile,
  );
  assert.ok(cold.score < fit.score, `${cold.score} vs ${fit.score}`);
});

test('draft assembles profile, facts, checklist and the honest footer', () => {
  const r = extractFundingRequirements(PAGE);
  const fit = scoreFundingFit({ program: 'EIC Grant', source: 'EU', note: 'deep-tech startup' }, profile);
  const draft = buildApplicationDraft(
    { program: 'EIC Grant', source: 'EU', amount: 100000, deadline: 'Mar 2026', url: 'https://x.example/g', requirements: r.requirements, expectations: r.expectations, documentsNeeded: r.documentsNeeded },
    profile,
    fit,
  );
  assert.ok(draft.includes('Acme Logistics'), draft);
  assert.ok(draft.includes('Business plan'), draft);
  assert.ok(draft.includes('review before submitting') || draft.includes('Drafted by Nadia'), draft);
});

test('company profile falls back gracefully without workspace or KB', () => {
  const p = companyProfileFrom(null, []);
  assert.equal(p.name, 'the company');
  assert.ok(p.about.length > 0);
});
