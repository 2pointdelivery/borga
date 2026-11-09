import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLATFORM_FEE_PCT,
  DEFAULT_SEAT_PRICE_CENTS,
  addEngagementInvoice,
  allowedEntitiesForScopes,
  buildAdminCollectionRecord,
  buildEngagementFromSource,
  buildPlatformAnalyticsBreakdowns,
  canAdvisorAccessEntity,
  computeFeeSplit,
  computeWorkspaceSubscriptionBill,
  normalizeAdminConfig,
  scopesForDepartmentOrRole,
  summarizeAdminCollections,
  summarizePlatformRevenue,
} from './borga/shared-services';

test('default pricing is $2/user/month (200 cents) and 15% platform fee, and admin config normalizes safely', () => {
  assert.equal(DEFAULT_SEAT_PRICE_CENTS, 200);
  assert.equal(DEFAULT_PLATFORM_FEE_PCT, 15);

  const def = normalizeAdminConfig(null);
  assert.equal(def.pricePerUserCents, 200);
  assert.equal(def.platformFeePct, 15);
  assert.deepEqual(def.globalFeaturesOff, []);

  const custom = normalizeAdminConfig({
    pricePerUserCents: 350,
    platformFeePct: 12.5,
    signupModeOverride: 'invite',
    billingModeOverride: 'enforce',
    globalFeaturesOff: ['calls', 'not-a-feature' as never],
  });
  assert.equal(custom.pricePerUserCents, 350);
  assert.equal(custom.platformFeePct, 12.5);
  assert.equal(custom.signupModeOverride, 'invite');
  assert.equal(custom.billingModeOverride, 'enforce');
  assert.deepEqual(custom.globalFeaturesOff, ['calls']);
});

test('computeFeeSplit splits professional fees 85% advisor / 15% platform and conserves every cent', () => {
  const s1 = computeFeeSplit(100_00); // $100.00
  assert.equal(s1.grossCents, 100_00);
  assert.equal(s1.platformFeePct, 15);
  assert.equal(s1.platformFeeCents, 15_00);
  assert.equal(s1.advisorNetCents, 85_00);

  // Odd cent amounts conserve exact cents
  for (const gross of [0, 1, 7, 33, 99, 101, 149_99, 250_000]) {
    const split = computeFeeSplit(gross, 15);
    assert.equal(split.platformFeeCents + split.advisorNetCents, split.grossCents, `cent conservation for ${gross}`);
  }
});

test('external advisors do not add a $2/month seat to the client workspace subscription', () => {
  const bill = computeWorkspaceSubscriptionBill({
    ownerEmail: 'founder@client.com',
    acceptedInviteEmails: ['teammate1@client.com', 'teammate2@client.com', 'cpa@agency.com'],
    activeAdvisorEmails: ['CPA@agency.com'],
    pricePerUserCents: 200,
  });
  // owner + 2 teammates = 3 seats ($6.00/mo); the advisor is excluded
  assert.equal(bill.seats, 3);
  assert.equal(bill.monthlyCents, 600);
});

test('module-scoped access restricts advisors to only the entities in their granted scopes', () => {
  const accountingScopes = ['finance'] as const;
  assert.equal(canAdvisorAccessEntity(accountingScopes, 'journals'), true);
  assert.equal(canAdvisorAccessEntity(accountingScopes, 'bills'), true);
  assert.equal(canAdvisorAccessEntity(accountingScopes, 'filings'), true);
  assert.equal(canAdvisorAccessEntity(accountingScopes, 'leads'), false);
  assert.equal(canAdvisorAccessEntity(accountingScopes, 'posts'), false);
  assert.equal(canAdvisorAccessEntity(accountingScopes, 'employees'), false);

  const growthAgency = ['sales', 'marketing'] as const;
  const entities = allowedEntitiesForScopes(growthAgency);
  assert.equal(entities.has('leads'), true);
  assert.equal(entities.has('quotes'), true);
  assert.equal(entities.has('posts'), true);
  assert.equal(entities.has('ads'), true);
  assert.equal(entities.has('journals'), false);
});

test('engagements record initial and recurring/milestone invoices with 85/15 split and feed platform analytics', () => {
  const eng = buildEngagementFromSource({
    id: 'eng-1',
    invoiceId: 'sinv-1',
    advisor: { id: 'adv-1', userId: 'u-adv', name: 'Apex CPA', email: 'cpa@apex.com' },
    clientUserId: 'u-client',
    clientWs: 'ws-client',
    clientCompanyName: 'Acme Corp',
    source: 'proposal',
    sourceId: 'prop-1',
    title: 'Monthly Bookkeeping & Tax',
    category: 'accounting',
    scopes: ['finance'],
    billingCycle: 'monthly',
    grossCents: 1000_00, // $1,000.00
    platformFeePct: 15,
    nowIso: '2026-10-16T10:00:00.000Z',
  });

  assert.equal(eng.paidTotalCents, 1000_00);
  assert.equal(eng.platformFeeTotalCents, 150_00);
  assert.equal(eng.advisorNetTotalCents, 850_00);
  assert.deepEqual(eng.grantedScopes, ['finance']);

  const withMilestone = addEngagementInvoice(eng, {
    id: 'sinv-2',
    description: 'Year-end tax filing pack',
    grossCents: 500_00, // $500.00
    paid: true,
    nowIso: '2026-10-16T12:00:00.000Z',
  });
  assert.equal(withMilestone.paidTotalCents, 1500_00);
  assert.equal(withMilestone.platformFeeTotalCents, 225_00);
  assert.equal(withMilestone.advisorNetTotalCents, 1275_00);

  const summary = summarizePlatformRevenue({
    workspaces: [
      { seats: 4, comped: false },
      { seats: 2, comped: true },
    ],
    pricePerUserCents: 200,
    engagements: [withMilestone],
  });
  assert.equal(summary.totalWorkspaces, 2);
  assert.equal(summary.billableWorkspaces, 1);
  assert.equal(summary.billableSeats, 4);
  assert.equal(summary.subscriptionMrrCents, 800); // 4 seats * $2.00
  assert.equal(summary.servicesGrossCents, 1500_00);
  assert.equal(summary.platformFeeRevenueCents, 225_00);
  assert.equal(summary.advisorNetPayoutCents, 1275_00);
  assert.equal(summary.activeEngagements, 1);

  const breakdowns = buildPlatformAnalyticsBreakdowns({
    companies: [
      { country: 'Canada', industry: 'Retail', seats: 4, monthlyCents: 800, comped: false, features: { finance: true, pos: true } },
      { country: 'United States', industry: 'SaaS', seats: 2, monthlyCents: 0, comped: true, features: { finance: true, pos: false } },
    ],
    advisors: [
      {
        id: 'adv-1', userId: 'u-adv', email: 'cpa@apex.com', name: 'Apex CPA', headline: 'CPA', bio: '',
        categories: ['accounting'], defaultScopes: ['finance'], hourlyRateCents: 150_00, currency: 'USD',
        status: 'approved', availabilitySlots: [], packages: [], rating: 4.9, completedEngagements: 3,
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      },
    ],
    engagements: [withMilestone],
    featureCatalog: [
      { id: 'finance', label: 'Finance', group: 'Finance' },
      { id: 'pos', label: 'POS', group: 'Operations' },
    ],
    nowIso: '2026-10-20T00:00:00.000Z',
  });

  assert.equal(breakdowns.revenueByCategory[0].category, 'accounting');
  assert.equal(breakdowns.revenueByCategory[0].grossCents, 1500_00);
  assert.equal(breakdowns.companiesByCountry.length, 2);
  assert.equal(breakdowns.advisorLeaderboard[0].grossCents, 1500_00);
  assert.equal(breakdowns.featureAdoption.find((f) => f.id === 'finance')?.adoptionPct, 100);
  assert.equal(breakdowns.featureAdoption.find((f) => f.id === 'pos')?.adoptionPct, 50);
  assert.equal(breakdowns.monthlySeries.length, 6);

  assert.deepEqual(scopesForDepartmentOrRole('Finance', 'External Accountant'), ['finance']);
  assert.deepEqual(scopesForDepartmentOrRole('Growth & Marketing', 'Sales Strategist'), ['sales', 'marketing']);
  assert.deepEqual(scopesForDepartmentOrRole('General', 'Advisor', ['hr']), ['hr']);
});

test('buildAdminCollectionRecord and summarizeAdminCollections track SaaS subscriptions, 85/15 service splits, and payouts across rails', () => {
  const subCol = buildAdminCollectionRecord({
    id: 'col-sub-1',
    kind: 'subscription',
    targetUserId: 'u-1',
    targetWs: 'ws-1',
    companyName: 'Lattis Labs',
    contactEmail: 'founder@lattis.io',
    grossCents: 1000, // 5 seats * $2.00
    rail: 'stripe',
    status: 'paid',
  });
  assert.equal(subCol.grossCents, 1000);
  assert.equal(subCol.platformFeeCents, 1000);
  assert.equal(subCol.advisorPayoutCents, 0);
  assert.equal(subCol.advisorPayoutStatus, 'not_applicable');

  const svcCol = buildAdminCollectionRecord({
    id: 'col-svc-1',
    kind: 'shared_service_fee',
    targetUserId: 'u-2',
    targetWs: 'ws-2',
    companyName: 'Verdant Co',
    contactEmail: 'ops@verdant.co',
    engagementId: 'eng-1',
    advisorId: 'adv-1',
    advisorName: 'Apex CPA',
    grossCents: 200_00, // $200.00
    platformFeePct: 15,
    rail: 'momo',
    status: 'paid',
  });
  assert.equal(svcCol.grossCents, 200_00);
  assert.equal(svcCol.platformFeeCents, 30_00);
  assert.equal(svcCol.advisorPayoutCents, 170_00);
  assert.equal(svcCol.advisorPayoutStatus, 'unpaid');

  const pendingBank = buildAdminCollectionRecord({
    id: 'col-sub-2',
    kind: 'subscription',
    targetUserId: 'u-3',
    targetWs: 'ws-3',
    companyName: 'TapFin',
    contactEmail: 'cfo@tapfin.com',
    grossCents: 600,
    rail: 'bank_transfer',
    status: 'pending',
  });

  const summary = summarizeAdminCollections([subCol, svcCol, pendingBank]);
  assert.equal(summary.totalCollectedCents, 210_00);
  assert.equal(summary.pendingCollectionCents, 600);
  assert.equal(summary.subscriptionCollectedCents, 1000);
  assert.equal(summary.platformFeeCollectedCents, 30_00);
  assert.equal(summary.pendingAdvisorPayoutCents, 170_00);
  assert.equal(summary.completedAdvisorPayoutCents, 0);
  assert.equal(summary.byRail.stripe.collectedCents, 1000);
  assert.equal(summary.byRail.momo.collectedCents, 200_00);
  assert.equal(summary.byRail.bank_transfer.pendingCents, 600);
});
