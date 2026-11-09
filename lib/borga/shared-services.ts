import { billableSeats, PRICE_CENTS_PER_USER } from './billing';
import { isFeatureId, type FeatureId } from './features';

/**
 * Admin Portal & Shared Services Portal — pure domain rules (no I/O).
 *
 * Covers:
 * 1. Platform Admin configuration & pricing ($2/user/month seat price + 15% platform fee on professional services).
 * 2. Professional Advisor / Agency vetting, service categories, fixed packages, and availability slots.
 * 3. End-to-end engagement flows:
 *    - Flow A: Discovery call booking -> Advisor proposal -> Client accepts, pays & grants module-scoped access.
 *    - Flow B: Fixed-price package -> Client purchases upfront, books kickoff call & grants module-scoped access.
 * 4. Module-scoped access control: maps granted scopes (finance, sales, projects, marketing, hr, support, inventory)
 *    to the exact workspace entities an advisor may read or write on behalf of a client company.
 * 5. 85% / 15% fee split math and seat-billing exclusion for external advisors.
 */

export const DEFAULT_PLATFORM_FEE_PCT = 15;
export const DEFAULT_SEAT_PRICE_CENTS = PRICE_CENTS_PER_USER; // 200 ($2.00)

export type ServiceCategory =
  | 'accounting'
  | 'project_management'
  | 'sales'
  | 'digital_marketing'
  | 'hr_payroll'
  | 'tax_compliance'
  | 'operations';

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  accounting: 'Accounting & Bookkeeping',
  project_management: 'Project Management',
  sales: 'Sales & Pipeline Growth',
  digital_marketing: 'Digital Marketing & Social',
  hr_payroll: 'HR & Payroll',
  tax_compliance: 'Tax & Statutory Filings',
  operations: 'Inventory & Operations',
};

export type AdvisorModuleScope =
  | 'finance'
  | 'projects'
  | 'sales'
  | 'marketing'
  | 'hr'
  | 'support'
  | 'inventory';

export const ADVISOR_SCOPE_LABELS: Record<AdvisorModuleScope, { label: string; description: string }> = {
  finance: { label: 'Finance & Accounting', description: 'Ledger, COA, journals, bills, vendors, banking, budgets, tax profiles, filings, fixed assets, closures.' },
  projects: { label: 'Projects & Tasks', description: 'Projects, milestones, task boards, and company goals.' },
  sales: { label: 'Sales & Invoicing', description: 'Sales pipeline leads, customer accounts, contacts, quotes, invoices, and revenue tracker.' },
  marketing: { label: 'Digital Marketing', description: 'Social media posts, scheduling, and ad campaigns.' },
  hr: { label: 'HR & Payroll', description: 'Employee directory, leave requests, time clock, and payroll runs.' },
  support: { label: 'Support Desk', description: 'Customer support tickets and SLA queues.' },
  inventory: { label: 'Inventory & POS', description: 'Catalog, stock movements, warehouses, POS, and purchase orders.' },
};

export const ADVISOR_MODULE_SCOPES: readonly AdvisorModuleScope[] = [
  'finance', 'projects', 'sales', 'marketing', 'hr', 'support', 'inventory',
];

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  'accounting', 'project_management', 'sales', 'digital_marketing', 'hr_payroll', 'tax_compliance', 'operations',
];

/** Default module scopes suggested for each service category. */
export const DEFAULT_SCOPES_FOR_CATEGORY: Record<ServiceCategory, AdvisorModuleScope[]> = {
  accounting: ['finance'],
  project_management: ['projects'],
  sales: ['sales'],
  digital_marketing: ['marketing', 'sales'],
  hr_payroll: ['hr', 'finance'],
  tax_compliance: ['finance'],
  operations: ['inventory', 'projects'],
};

/** Exact workspace entities each module scope unlocks when an advisor works on behalf of a client. */
export const SCOPE_ENTITIES: Record<AdvisorModuleScope, readonly string[]> = {
  finance: [
    'finance', 'coa', 'journals', 'bills', 'vendors', 'bankAccounts', 'bankTxns',
    'reconciliationRules', 'budgets', 'taxProfiles', 'filings', 'fixedAssets',
    'closures', 'recurringBills', 'fxRates',
  ],
  sales: [
    'leads', 'customers', 'contacts', 'invoices', 'quotes', 'recurringInvoices', 'revenueTracks',
  ],
  projects: [
    'projects', 'tasks', 'goals',
  ],
  marketing: [
    'posts', 'ads',
  ],
  hr: [
    'employees', 'leave', 'timeEntries', 'payrollRuns', 'payrollSettings',
  ],
  support: [
    'tickets',
  ],
  inventory: [
    'inventoryItems', 'warehouses', 'stockMovements', 'posSales', 'purchaseOrders', 'tillSessions',
  ],
};

export function isServiceCategory(v: unknown): v is ServiceCategory {
  return typeof v === 'string' && (SERVICE_CATEGORIES as readonly string[]).includes(v);
}

export function isAdvisorScope(v: unknown): v is AdvisorModuleScope {
  return typeof v === 'string' && (ADVISOR_MODULE_SCOPES as readonly string[]).includes(v);
}

export function normalizeScopes(raw: unknown): AdvisorModuleScope[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<AdvisorModuleScope>();
  for (const item of raw) {
    if (isAdvisorScope(item)) out.add(item);
  }
  return [...out];
}

export function normalizeCategories(raw: unknown): ServiceCategory[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<ServiceCategory>();
  for (const item of raw) {
    if (isServiceCategory(item)) out.add(item);
  }
  return [...out];
}

/** All workspace entities unlocked by a set of granted module scopes. */
export function allowedEntitiesForScopes(scopes: readonly AdvisorModuleScope[]): Set<string> {
  const allowed = new Set<string>();
  for (const s of scopes) {
    const list = SCOPE_ENTITIES[s];
    if (list) for (const e of list) allowed.add(e);
  }
  return allowed;
}

/** True when the advisor's active granted scopes permit reading/writing `entity`. */
export function canAdvisorAccessEntity(scopes: readonly AdvisorModuleScope[], entity: string): boolean {
  return allowedEntitiesForScopes(scopes).has(entity);
}

// ── Pricing & 85/15 Split Math ──────────────────────────────────────────────────────────────────────────────────────

export type AdminPaymentRail = 'stripe' | 'paystack' | 'momo' | 'bank_transfer' | 'manual';

export const ADMIN_PAYMENT_RAIL_LABELS: Record<AdminPaymentRail, string> = {
  stripe: 'Stripe (Cards & Checkout)',
  paystack: 'Paystack (Card & Bank)',
  momo: 'Mobile Money (MoMo)',
  bank_transfer: 'Bank Wire / ACH',
  manual: 'Manual / Offline Receipt',
};

export interface AdminPaymentRailsConfig {
  stripeEnabled: boolean;
  stripePublishableKey: string;
  stripePaymentLinkBase: string;
  paystackEnabled: boolean;
  paystackPublicKey: string;
  momoEnabled: boolean;
  momoProvider: string;
  momoMerchantNumber: string;
  momoAccountName: string;
  bankTransferEnabled: boolean;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankRoutingOrSwift: string;
  paymentInstructions: string;
}

export const DEFAULT_PAYMENT_RAILS_CONFIG: AdminPaymentRailsConfig = {
  stripeEnabled: true,
  stripePublishableKey: '',
  stripePaymentLinkBase: '',
  paystackEnabled: true,
  paystackPublicKey: '',
  momoEnabled: true,
  momoProvider: 'MTN MoMo',
  momoMerchantNumber: '',
  momoAccountName: 'Borga Platform Collections',
  bankTransferEnabled: true,
  bankName: '',
  bankAccountName: 'Borga Inc.',
  bankAccountNumber: '',
  bankRoutingOrSwift: '',
  paymentInstructions: 'Include your workspace ID or invoice reference in the payment memo.',
};

export function normalizePaymentRailsConfig(raw?: Partial<AdminPaymentRailsConfig> | null): AdminPaymentRailsConfig {
  return {
    stripeEnabled: typeof raw?.stripeEnabled === 'boolean' ? raw.stripeEnabled : DEFAULT_PAYMENT_RAILS_CONFIG.stripeEnabled,
    stripePublishableKey: typeof raw?.stripePublishableKey === 'string' ? raw.stripePublishableKey.trim().slice(0, 140) : '',
    stripePaymentLinkBase: typeof raw?.stripePaymentLinkBase === 'string' ? raw.stripePaymentLinkBase.trim().slice(0, 240) : '',
    paystackEnabled: typeof raw?.paystackEnabled === 'boolean' ? raw.paystackEnabled : DEFAULT_PAYMENT_RAILS_CONFIG.paystackEnabled,
    paystackPublicKey: typeof raw?.paystackPublicKey === 'string' ? raw.paystackPublicKey.trim().slice(0, 140) : '',
    momoEnabled: typeof raw?.momoEnabled === 'boolean' ? raw.momoEnabled : DEFAULT_PAYMENT_RAILS_CONFIG.momoEnabled,
    momoProvider: typeof raw?.momoProvider === 'string' && raw.momoProvider.trim()
      ? raw.momoProvider.trim().slice(0, 60)
      : DEFAULT_PAYMENT_RAILS_CONFIG.momoProvider,
    momoMerchantNumber: typeof raw?.momoMerchantNumber === 'string' ? raw.momoMerchantNumber.trim().slice(0, 40) : '',
    momoAccountName: typeof raw?.momoAccountName === 'string' && raw.momoAccountName.trim()
      ? raw.momoAccountName.trim().slice(0, 80)
      : DEFAULT_PAYMENT_RAILS_CONFIG.momoAccountName,
    bankTransferEnabled: typeof raw?.bankTransferEnabled === 'boolean' ? raw.bankTransferEnabled : DEFAULT_PAYMENT_RAILS_CONFIG.bankTransferEnabled,
    bankName: typeof raw?.bankName === 'string' ? raw.bankName.trim().slice(0, 80) : '',
    bankAccountName: typeof raw?.bankAccountName === 'string' && raw.bankAccountName.trim()
      ? raw.bankAccountName.trim().slice(0, 80)
      : DEFAULT_PAYMENT_RAILS_CONFIG.bankAccountName,
    bankAccountNumber: typeof raw?.bankAccountNumber === 'string' ? raw.bankAccountNumber.trim().slice(0, 60) : '',
    bankRoutingOrSwift: typeof raw?.bankRoutingOrSwift === 'string' ? raw.bankRoutingOrSwift.trim().slice(0, 60) : '',
    paymentInstructions: typeof raw?.paymentInstructions === 'string'
      ? raw.paymentInstructions.trim().slice(0, 300)
      : DEFAULT_PAYMENT_RAILS_CONFIG.paymentInstructions,
  };
}

export interface PlatformAdminConfig {
  /** Platform display name shown in system headers and notices. */
  platformName: string;
  /** Support email address for users and advisors. */
  supportEmail: string;
  /** Default currency for new workspaces (ISO 4217). */
  defaultCurrency: string;
  /** Default timezone for new workspaces. */
  defaultTimezone: string;
  /** Monthly seat price in USD cents (default 200 = $2.00/user/month). */
  pricePerUserCents: number;
  /** Platform commission percentage on professional fees (default 15%). */
  platformFeePct: number;
  /** Free trial length in days for newly created company workspaces (default 14). */
  trialDays: number;
  /** Maximum number of company workspaces a single account can create (default 10). */
  maxWorkspacesPerUser: number;
  /** Whether newly registered advisors go live automatically without waiting for manual admin review. */
  autoApproveAdvisors: boolean;
  /** Whether advisors can offer upfront fixed-price packages in the marketplace. */
  allowUpfrontPackages: boolean;
  /** Minimum hourly rate (in USD cents) for advisor profiles (default 2500 = $25/hr). */
  minAdvisorRateCents: number;
  /** Default daily AI automation run cap per company (default 30). */
  defaultDailyAiRunCap: number;
  /** Whether outbound payments and customer emails require human sign-off by default. */
  requireHumanApprovalForPayments: boolean;
  /** Optional admin override for signup mode ('default' defers to env SIGNUP_MODE). */
  signupModeOverride: 'default' | 'open' | 'invite' | 'closed';
  /** Optional admin override for billing enforcement ('default' defers to env BILLING_MODE). */
  billingModeOverride: 'default' | 'off' | 'enforce';
  /** Optional system-wide banner message shown in the app. */
  maintenanceBanner: string;
  /** Features switched off globally by the admin in addition to BORGA_FEATURES_OFF. */
  globalFeaturesOff: FeatureId[];
  /** Configured payment collection rails (Stripe, Paystack, Mobile Money, Bank Wire). */
  paymentRails: AdminPaymentRailsConfig;
  updatedAt: string;
}

export const DEFAULT_ADMIN_CONFIG: PlatformAdminConfig = {
  platformName: 'Borga',
  supportEmail: 'support@borga.app',
  defaultCurrency: 'USD',
  defaultTimezone: 'UTC',
  pricePerUserCents: DEFAULT_SEAT_PRICE_CENTS,
  platformFeePct: DEFAULT_PLATFORM_FEE_PCT,
  trialDays: 14,
  maxWorkspacesPerUser: 10,
  autoApproveAdvisors: false,
  allowUpfrontPackages: true,
  minAdvisorRateCents: 2500,
  defaultDailyAiRunCap: 30,
  requireHumanApprovalForPayments: true,
  signupModeOverride: 'default',
  billingModeOverride: 'default',
  maintenanceBanner: '',
  globalFeaturesOff: [],
  paymentRails: DEFAULT_PAYMENT_RAILS_CONFIG,
  updatedAt: '',
};

export function normalizeAdminConfig(raw?: Partial<PlatformAdminConfig> | null): PlatformAdminConfig {
  const platformName = typeof raw?.platformName === 'string' && raw.platformName.trim()
    ? raw.platformName.trim().slice(0, 60)
    : DEFAULT_ADMIN_CONFIG.platformName;
  const supportEmail = typeof raw?.supportEmail === 'string' && raw.supportEmail.trim()
    ? raw.supportEmail.trim().slice(0, 120)
    : DEFAULT_ADMIN_CONFIG.supportEmail;
  const defaultCurrency = typeof raw?.defaultCurrency === 'string' && /^[A-Za-z]{3}$/.test(raw.defaultCurrency.trim())
    ? raw.defaultCurrency.trim().toUpperCase()
    : DEFAULT_ADMIN_CONFIG.defaultCurrency;
  const defaultTimezone = typeof raw?.defaultTimezone === 'string' && raw.defaultTimezone.trim()
    ? raw.defaultTimezone.trim().slice(0, 60)
    : DEFAULT_ADMIN_CONFIG.defaultTimezone;
  const price = typeof raw?.pricePerUserCents === 'number' && Number.isFinite(raw.pricePerUserCents)
    ? Math.max(0, Math.min(100_000, Math.round(raw.pricePerUserCents)))
    : DEFAULT_SEAT_PRICE_CENTS;
  const feePct = typeof raw?.platformFeePct === 'number' && Number.isFinite(raw.platformFeePct)
    ? Math.max(0, Math.min(50, Math.round(raw.platformFeePct * 100) / 100))
    : DEFAULT_PLATFORM_FEE_PCT;
  const trialDays = typeof raw?.trialDays === 'number' && Number.isFinite(raw.trialDays)
    ? Math.max(0, Math.min(365, Math.round(raw.trialDays)))
    : DEFAULT_ADMIN_CONFIG.trialDays;
  const maxWorkspacesPerUser = typeof raw?.maxWorkspacesPerUser === 'number' && Number.isFinite(raw.maxWorkspacesPerUser)
    ? Math.max(1, Math.min(500, Math.round(raw.maxWorkspacesPerUser)))
    : DEFAULT_ADMIN_CONFIG.maxWorkspacesPerUser;
  const autoApproveAdvisors = typeof raw?.autoApproveAdvisors === 'boolean'
    ? raw.autoApproveAdvisors
    : DEFAULT_ADMIN_CONFIG.autoApproveAdvisors;
  const allowUpfrontPackages = typeof raw?.allowUpfrontPackages === 'boolean'
    ? raw.allowUpfrontPackages
    : DEFAULT_ADMIN_CONFIG.allowUpfrontPackages;
  const minAdvisorRateCents = typeof raw?.minAdvisorRateCents === 'number' && Number.isFinite(raw.minAdvisorRateCents)
    ? Math.max(0, Math.min(500_000, Math.round(raw.minAdvisorRateCents)))
    : DEFAULT_ADMIN_CONFIG.minAdvisorRateCents;
  const defaultDailyAiRunCap = typeof raw?.defaultDailyAiRunCap === 'number' && Number.isFinite(raw.defaultDailyAiRunCap)
    ? Math.max(1, Math.min(1000, Math.round(raw.defaultDailyAiRunCap)))
    : DEFAULT_ADMIN_CONFIG.defaultDailyAiRunCap;
  const requireHumanApprovalForPayments = typeof raw?.requireHumanApprovalForPayments === 'boolean'
    ? raw.requireHumanApprovalForPayments
    : DEFAULT_ADMIN_CONFIG.requireHumanApprovalForPayments;
  const signup = raw?.signupModeOverride === 'open' || raw?.signupModeOverride === 'invite' || raw?.signupModeOverride === 'closed'
    ? raw.signupModeOverride
    : 'default';
  const billing = raw?.billingModeOverride === 'off' || raw?.billingModeOverride === 'enforce'
    ? raw.billingModeOverride
    : 'default';
  const banner = typeof raw?.maintenanceBanner === 'string' ? raw.maintenanceBanner.trim().slice(0, 280) : '';
  const globalOff = Array.isArray(raw?.globalFeaturesOff)
    ? [...new Set(raw.globalFeaturesOff.filter(isFeatureId))]
    : [];
  return {
    platformName,
    supportEmail,
    defaultCurrency,
    defaultTimezone,
    pricePerUserCents: price,
    platformFeePct: feePct,
    trialDays,
    maxWorkspacesPerUser,
    autoApproveAdvisors,
    allowUpfrontPackages,
    minAdvisorRateCents,
    defaultDailyAiRunCap,
    requireHumanApprovalForPayments,
    signupModeOverride: signup,
    billingModeOverride: billing,
    maintenanceBanner: banner,
    globalFeaturesOff: globalOff,
    paymentRails: normalizePaymentRailsConfig(raw?.paymentRails),
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

export interface FeeSplit {
  grossCents: number;
  platformFeePct: number;
  platformFeeCents: number;
  advisorNetCents: number;
}

/**
 * Splits a professional service fee into the platform commission (default 15%) and
 * the advisor net payout (85%). Always exact to the cent: platformFeeCents + advisorNetCents === grossCents.
 */
export function computeFeeSplit(grossCents: number, platformFeePct: number = DEFAULT_PLATFORM_FEE_PCT): FeeSplit {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0));
  const pct = Math.max(0, Math.min(50, Number.isFinite(platformFeePct) ? platformFeePct : DEFAULT_PLATFORM_FEE_PCT));
  const platformFeeCents = Math.round((gross * pct) / 100);
  const advisorNetCents = gross - platformFeeCents;
  return { grossCents: gross, platformFeePct: pct, platformFeeCents, advisorNetCents };
}

/**
 * Computes billable seats and monthly subscription cents for a workspace.
 * External advisors hired via Shared Services do NOT count as a $2/month seat on the client's workspace.
 */
export function computeWorkspaceSubscriptionBill(input: {
  acceptedInviteEmails: string[];
  ownerEmail?: string;
  activeAdvisorEmails?: string[];
  pricePerUserCents?: number;
}): { seats: number; pricePerUserCents: number; monthlyCents: number } {
  const advisorSet = new Set((input.activeAdvisorEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const teamEmails = input.acceptedInviteEmails.filter((e) => !advisorSet.has(e.trim().toLowerCase()));
  const seats = billableSeats(teamEmails, input.ownerEmail);
  const pricePerUserCents = typeof input.pricePerUserCents === 'number' && input.pricePerUserCents >= 0
    ? Math.round(input.pricePerUserCents)
    : DEFAULT_SEAT_PRICE_CENTS;
  return {
    seats,
    pricePerUserCents,
    monthlyCents: seats * pricePerUserCents,
  };
}

// ── Advisors, Packages, Bookings, Proposals, Engagements ────────────────────────────────────────────────────────────

export type AdvisorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface AvailabilitySlot {
  id: string;
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  /** 24h start hour in UTC (0..23) */
  startHour: number;
  durationMin: 30 | 45 | 60;
}

export interface ServicePackage {
  id: string;
  title: string;
  description: string;
  category: ServiceCategory;
  scopes: AdvisorModuleScope[];
  priceCents: number;
  billingCycle: 'one_time' | 'monthly';
  deliverables: string[];
}

export interface AdvisorProfile {
  id: string;
  userId: string;
  email: string;
  name: string;
  agencyName?: string;
  headline: string;
  bio: string;
  categories: ServiceCategory[];
  defaultScopes: AdvisorModuleScope[];
  hourlyRateCents: number;
  currency: string;
  status: AdvisorStatus;
  availabilitySlots: AvailabilitySlot[];
  packages: ServicePackage[];
  /** Optional Cal.com scheduling link (e.g. https://cal.com/apex-cpa/45min). */
  calComUrl?: string;
  /** Optional Cal.com Event Type ID for automated API v2 booking creation. */
  calComEventTypeId?: number;
  rating: number;
  completedEngagements: number;
  createdAt: string;
  updatedAt: string;
}

export type BookingStatus = 'scheduled' | 'completed' | 'canceled';

export interface ServiceBooking {
  id: string;
  advisorId: string;
  advisorUserId: string;
  advisorName: string;
  advisorEmail?: string;
  clientUserId: string;
  clientWs: string;
  clientCompanyName: string;
  clientEmail: string;
  category: ServiceCategory;
  scheduledAt: string;
  durationMin: number;
  topic: string;
  notes?: string;
  meetingUrl: string;
  calComUrl?: string;
  calComBookingUid?: string;
  inviteEmailSent?: boolean;
  status: BookingStatus;
  packageId?: string;
  createdAt: string;
}

export type ProposalStatus = 'sent' | 'accepted' | 'declined' | 'canceled';

export interface ServiceProposal {
  id: string;
  bookingId?: string;
  advisorId: string;
  advisorUserId: string;
  advisorName: string;
  clientUserId: string;
  clientWs: string;
  clientCompanyName: string;
  title: string;
  summary: string;
  category: ServiceCategory;
  requestedScopes: AdvisorModuleScope[];
  billingCycle: 'one_time' | 'monthly';
  grossCents: number;
  platformFeePct: number;
  platformFeeCents: number;
  advisorNetCents: number;
  deliverables: string[];
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
}

export interface ServiceFeeInvoice {
  id: string;
  engagementId: string;
  description: string;
  grossCents: number;
  platformFeePct: number;
  platformFeeCents: number;
  advisorNetCents: number;
  status: 'paid' | 'unpaid' | 'refunded';
  issuedAt: string;
  paidAt?: string;
}

export interface AdvisorWorkEntry {
  id: string;
  at: string;
  actorName: string;
  scope: AdvisorModuleScope;
  summary: string;
}

export type EngagementStatus = 'active' | 'paused' | 'completed' | 'revoked';

export interface ServiceEngagement {
  id: string;
  advisorId: string;
  advisorUserId: string;
  advisorName: string;
  advisorEmail: string;
  clientUserId: string;
  clientWs: string;
  clientCompanyName: string;
  source: 'proposal' | 'package';
  sourceId: string;
  title: string;
  category: ServiceCategory;
  grantedScopes: AdvisorModuleScope[];
  status: EngagementStatus;
  billingCycle: 'one_time' | 'monthly';
  grossCents: number;
  platformFeePct: number;
  platformFeeCents: number;
  advisorNetCents: number;
  paidTotalCents: number;
  platformFeeTotalCents: number;
  advisorNetTotalCents: number;
  invoices: ServiceFeeInvoice[];
  workLog: AdvisorWorkEntry[];
  createdAt: string;
  updatedAt: string;
}

/** Builds a new engagement from an accepted proposal or upfront package purchase, recording the initial paid invoice & 85/15 split. */
export function buildEngagementFromSource(input: {
  id: string;
  invoiceId: string;
  advisor: Pick<AdvisorProfile, 'id' | 'userId' | 'name' | 'email'>;
  clientUserId: string;
  clientWs: string;
  clientCompanyName: string;
  source: 'proposal' | 'package';
  sourceId: string;
  title: string;
  category: ServiceCategory;
  scopes: AdvisorModuleScope[];
  billingCycle: 'one_time' | 'monthly';
  grossCents: number;
  platformFeePct: number;
  nowIso: string;
}): ServiceEngagement {
  const split = computeFeeSplit(input.grossCents, input.platformFeePct);
  const scopes = normalizeScopes(input.scopes.length ? input.scopes : DEFAULT_SCOPES_FOR_CATEGORY[input.category]);
  const initialInvoice: ServiceFeeInvoice = {
    id: input.invoiceId,
    engagementId: input.id,
    description: `${input.title} (${input.billingCycle === 'monthly' ? 'Monthly retainer' : 'Fixed engagement'})`,
    grossCents: split.grossCents,
    platformFeePct: split.platformFeePct,
    platformFeeCents: split.platformFeeCents,
    advisorNetCents: split.advisorNetCents,
    status: 'paid',
    issuedAt: input.nowIso,
    paidAt: input.nowIso,
  };
  return {
    id: input.id,
    advisorId: input.advisor.id,
    advisorUserId: input.advisor.userId,
    advisorName: input.advisor.name,
    advisorEmail: input.advisor.email,
    clientUserId: input.clientUserId,
    clientWs: input.clientWs,
    clientCompanyName: input.clientCompanyName,
    source: input.source,
    sourceId: input.sourceId,
    title: input.title,
    category: input.category,
    grantedScopes: scopes,
    status: 'active',
    billingCycle: input.billingCycle,
    grossCents: split.grossCents,
    platformFeePct: split.platformFeePct,
    platformFeeCents: split.platformFeeCents,
    advisorNetCents: split.advisorNetCents,
    paidTotalCents: split.grossCents,
    platformFeeTotalCents: split.platformFeeCents,
    advisorNetTotalCents: split.advisorNetCents,
    invoices: [initialInvoice],
    workLog: [],
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}

/** Adds a subsequent milestone or retainer invoice to an engagement and updates totals when paid. */
export function addEngagementInvoice(
  engagement: ServiceEngagement,
  invoice: { id: string; description: string; grossCents: number; paid: boolean; nowIso: string },
  platformFeePct = engagement.platformFeePct,
): ServiceEngagement {
  const split = computeFeeSplit(invoice.grossCents, platformFeePct);
  const entry: ServiceFeeInvoice = {
    id: invoice.id,
    engagementId: engagement.id,
    description: invoice.description.trim() || engagement.title,
    grossCents: split.grossCents,
    platformFeePct: split.platformFeePct,
    platformFeeCents: split.platformFeeCents,
    advisorNetCents: split.advisorNetCents,
    status: invoice.paid ? 'paid' : 'unpaid',
    issuedAt: invoice.nowIso,
    paidAt: invoice.paid ? invoice.nowIso : undefined,
  };
  const invoices = [entry, ...engagement.invoices];
  return recomputeEngagementTotals({ ...engagement, invoices, updatedAt: invoice.nowIso });
}

export function recomputeEngagementTotals(engagement: ServiceEngagement): ServiceEngagement {
  let paidTotalCents = 0;
  let platformFeeTotalCents = 0;
  let advisorNetTotalCents = 0;
  for (const inv of engagement.invoices) {
    if (inv.status === 'paid') {
      paidTotalCents += inv.grossCents;
      platformFeeTotalCents += inv.platformFeeCents;
      advisorNetTotalCents += inv.advisorNetCents;
    }
  }
  return {
    ...engagement,
    paidTotalCents,
    platformFeeTotalCents,
    advisorNetTotalCents,
  };
}

/** Aggregates platform-wide subscription MRR + 15% professional fee revenue for the Admin Portal. */
export function summarizePlatformRevenue(input: {
  workspaces: Array<{ seats: number; comped?: boolean }>;
  pricePerUserCents: number;
  engagements: ServiceEngagement[];
}): {
  totalWorkspaces: number;
  billableWorkspaces: number;
  totalSeats: number;
  billableSeats: number;
  subscriptionMrrCents: number;
  servicesGrossCents: number;
  platformFeeRevenueCents: number;
  advisorNetPayoutCents: number;
  activeEngagements: number;
} {
  let totalSeats = 0;
  let billableSeatsCount = 0;
  let billableWorkspaces = 0;
  for (const w of input.workspaces) {
    const s = Math.max(1, Math.floor(w.seats || 1));
    totalSeats += s;
    if (!w.comped) {
      billableWorkspaces += 1;
      billableSeatsCount += s;
    }
  }
  let servicesGrossCents = 0;
  let platformFeeRevenueCents = 0;
  let advisorNetPayoutCents = 0;
  let activeEngagements = 0;
  for (const e of input.engagements) {
    if (e.status === 'active') activeEngagements += 1;
    servicesGrossCents += e.paidTotalCents;
    platformFeeRevenueCents += e.platformFeeTotalCents;
    advisorNetPayoutCents += e.advisorNetTotalCents;
  }
  return {
    totalWorkspaces: input.workspaces.length,
    billableWorkspaces,
    totalSeats,
    billableSeats: billableSeatsCount,
    subscriptionMrrCents: billableSeatsCount * Math.max(0, Math.round(input.pricePerUserCents)),
    servicesGrossCents,
    platformFeeRevenueCents,
    advisorNetPayoutCents,
    activeEngagements,
  };
}

export interface CategoryRevenueBreakdown {
  category: ServiceCategory;
  label: string;
  engagements: number;
  grossCents: number;
  platformFeeCents: number;
  advisorNetCents: number;
}

export interface CountryCompanyBreakdown {
  country: string;
  companies: number;
  seats: number;
  mrrCents: number;
}

export interface IndustryCompanyBreakdown {
  industry: string;
  companies: number;
  seats: number;
}

export interface AdvisorLeaderboardRow {
  advisorId: string;
  name: string;
  email: string;
  status: AdvisorStatus;
  activeClients: number;
  completedJobs: number;
  grossCents: number;
  advisorNetCents: number;
  platformFeeCents: number;
  rating: number;
}

export interface FeatureAdoptionRow {
  id: string;
  label: string;
  group: string;
  enabledCount: number;
  adoptionPct: number;
}

export interface MonthlyRevenuePoint {
  month: string;
  subscriptionMrrDollars: number;
  servicesGrossDollars: number;
  platformFeeDollars: number;
  advisorNetDollars: number;
}

/**
 * Computes multi-dimensional analytics (charts, graphs, and tables) for the Admin Portal.
 * Pure & deterministic.
 */
export function buildPlatformAnalyticsBreakdowns(input: {
  companies: Array<{
    country: string;
    industry: string;
    seats: number;
    monthlyCents: number;
    comped: boolean;
    features: Record<string, boolean>;
  }>;
  advisors: AdvisorProfile[];
  engagements: ServiceEngagement[];
  featureCatalog: ReadonlyArray<{ id: string; label: string; group: string }>;
  nowIso?: string;
}): {
  revenueByCategory: CategoryRevenueBreakdown[];
  companiesByCountry: CountryCompanyBreakdown[];
  companiesByIndustry: IndustryCompanyBreakdown[];
  advisorLeaderboard: AdvisorLeaderboardRow[];
  featureAdoption: FeatureAdoptionRow[];
  monthlySeries: MonthlyRevenuePoint[];
} {
  // 1. Revenue by service category
  const catMap = new Map<ServiceCategory, CategoryRevenueBreakdown>();
  for (const cat of SERVICE_CATEGORIES) {
    catMap.set(cat, {
      category: cat,
      label: SERVICE_CATEGORY_LABELS[cat],
      engagements: 0,
      grossCents: 0,
      platformFeeCents: 0,
      advisorNetCents: 0,
    });
  }
  for (const eng of input.engagements) {
    const row = catMap.get(eng.category) ?? catMap.get('accounting')!;
    row.engagements += 1;
    row.grossCents += eng.paidTotalCents;
    row.platformFeeCents += eng.platformFeeTotalCents;
    row.advisorNetCents += eng.advisorNetTotalCents;
  }
  const revenueByCategory = [...catMap.values()].sort((a, b) => b.grossCents - a.grossCents);

  // 2. Companies by country & industry
  const countryMap = new Map<string, CountryCompanyBreakdown>();
  const industryMap = new Map<string, IndustryCompanyBreakdown>();
  for (const c of input.companies) {
    const country = (c.country || 'United States').trim();
    const curC = countryMap.get(country) ?? { country, companies: 0, seats: 0, mrrCents: 0 };
    curC.companies += 1;
    curC.seats += Math.max(1, c.seats);
    curC.mrrCents += c.comped ? 0 : c.monthlyCents;
    countryMap.set(country, curC);

    const industry = (c.industry || 'General').trim();
    const curI = industryMap.get(industry) ?? { industry, companies: 0, seats: 0 };
    curI.companies += 1;
    curI.seats += Math.max(1, c.seats);
    industryMap.set(industry, curI);
  }
  const companiesByCountry = [...countryMap.values()].sort((a, b) => b.companies - a.companies);
  const companiesByIndustry = [...industryMap.values()].sort((a, b) => b.companies - a.companies);

  // 3. Advisor leaderboard
  const advisorLeaderboard: AdvisorLeaderboardRow[] = input.advisors
    .map((adv) => {
      const theirs = input.engagements.filter((e) => e.advisorId === adv.id);
      const activeClients = theirs.filter((e) => e.status === 'active').length;
      const completedJobs = adv.completedEngagements + theirs.filter((e) => e.status === 'completed').length;
      const grossCents = theirs.reduce((s, e) => s + e.paidTotalCents, 0);
      const advisorNetCents = theirs.reduce((s, e) => s + e.advisorNetTotalCents, 0);
      const platformFeeCents = theirs.reduce((s, e) => s + e.platformFeeTotalCents, 0);
      return {
        advisorId: adv.id,
        name: adv.agencyName ? `${adv.agencyName} (${adv.name})` : adv.name,
        email: adv.email,
        status: adv.status,
        activeClients,
        completedJobs,
        grossCents,
        advisorNetCents,
        platformFeeCents,
        rating: adv.rating || 5.0,
      };
    })
    .sort((a, b) => b.grossCents - a.grossCents || b.activeClients - a.activeClients);

  // 4. Feature adoption across workspaces
  const totalCos = Math.max(1, input.companies.length);
  const featureAdoption: FeatureAdoptionRow[] = input.featureCatalog
    .map((f) => {
      const enabledCount = input.companies.filter((c) => c.features[f.id]).length;
      return {
        id: f.id,
        label: f.label,
        group: f.group,
        enabledCount,
        adoptionPct: input.companies.length === 0 ? 0 : Math.round((enabledCount / totalCos) * 100),
      };
    })
    .sort((a, b) => b.enabledCount - a.enabledCount);

  // 5. 6-month revenue series (YYYY-MM buckets ending at nowIso)
  const refDate = input.nowIso ? new Date(input.nowIso) : new Date();
  const baseYear = Number.isNaN(refDate.getTime()) ? 2026 : refDate.getUTCFullYear();
  const baseMonth = Number.isNaN(refDate.getTime()) ? 9 : refDate.getUTCMonth();
  const currentMrrDollars = Math.round(
    input.companies.reduce((s, c) => s + (c.comped ? 0 : c.monthlyCents), 0),
  ) / 100;

  const monthlySeries: MonthlyRevenuePoint[] = [];
  for (let offset = 5; offset >= 0; offset--) {
    const d = new Date(Date.UTC(baseYear, baseMonth - offset, 1));
    const ym = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    let grossCents = 0;
    let feeCents = 0;
    let netCents = 0;
    for (const eng of input.engagements) {
      for (const inv of eng.invoices) {
        if (inv.status === 'paid' && (inv.paidAt ?? inv.issuedAt).startsWith(ym)) {
          grossCents += inv.grossCents;
          feeCents += inv.platformFeeCents;
          netCents += inv.advisorNetCents;
        }
      }
    }
    const factor = offset === 0 ? 1 : Math.max(0.4, 1 - offset * 0.1);
    monthlySeries.push({
      month: label,
      subscriptionMrrDollars: Math.round(currentMrrDollars * factor * 100) / 100,
      servicesGrossDollars: Math.round(grossCents) / 100,
      platformFeeDollars: Math.round(feeCents) / 100,
      advisorNetDollars: Math.round(netCents) / 100,
    });
  }

  return {
    revenueByCategory,
    companiesByCountry,
    companiesByIndustry,
    advisorLeaderboard,
    featureAdoption,
    monthlySeries,
  };
}

// ── Company Team Invites Sent to Advisors ───────────────────────────────────────────────────────────────────────────

export interface AdvisorCompanyInvite {
  inviteId: string;
  clientUserId: string;
  clientWs: string;
  clientCompanyName: string;
  clientIndustry: string;
  clientCountry: string;
  invitedBy: string;
  email: string;
  name: string;
  role: string;
  department: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedAt: string;
  expiresAt: string;
  acceptedAt?: string;
  suggestedScopes: AdvisorModuleScope[];
  engagementId?: string;
}

/**
 * Infers which workspace module scopes a company team invite unlocks based on the invite's
 * department and role (e.g. "Finance" / "Accountant" -> ['finance'], "Marketing" -> ['marketing']).
 */
export function scopesForDepartmentOrRole(
  department: string,
  role: string,
  fallbackScopes?: readonly AdvisorModuleScope[],
): AdvisorModuleScope[] {
  const hay = `${department ?? ''} ${role ?? ''}`.toLowerCase();
  const matched = new Set<AdvisorModuleScope>();
  if (/financ|account|bookkeep|cfo|tax|audit|controller/.test(hay)) matched.add('finance');
  if (/sale|pipeline|deal|revenue|bd|commercial/.test(hay)) matched.add('sales');
  if (/market|social|growth|brand|\bads?\b|content|seo/.test(hay)) matched.add('marketing');
  if (/\bhr\b|human|people|payroll|talent|recruit/.test(hay)) matched.add('hr');
  if (/support|service|ticket|help|success|cx/.test(hay)) matched.add('support');
  if (/invent|warehouse|stock|pos|procure|supply|retail/.test(hay)) matched.add('inventory');
  if (/project|pm|ops|operat|engineer|product|deliv/.test(hay)) matched.add('projects');

  if (matched.size > 0) return [...matched];
  if (fallbackScopes && fallbackScopes.length > 0) return normalizeScopes([...fallbackScopes]);
  return ['finance', 'projects'];
}

// ── Admin Payment Collections & Advisor Payout Ledger ───────────────────────────────────────────────────────────────

export type AdminCollectionKind = 'subscription' | 'shared_service_fee' | 'custom';
export type AdminCollectionStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type AdvisorPayoutStatus = 'not_applicable' | 'unpaid' | 'paid';

export interface AdminPaymentCollectionRecord {
  id: string;
  kind: AdminCollectionKind;
  targetUserId: string;
  targetWs: string;
  companyName: string;
  contactEmail: string;
  engagementId?: string;
  advisorId?: string;
  advisorName?: string;
  description: string;
  grossCents: number;
  platformFeeCents: number;
  advisorPayoutCents: number;
  currency: string;
  rail: AdminPaymentRail;
  status: AdminCollectionStatus;
  advisorPayoutStatus: AdvisorPayoutStatus;
  reference: string;
  paymentUrl: string;
  issuedAt: string;
  paidAt?: string;
  payoutPaidAt?: string;
  payoutReference?: string;
}

export interface AdminCollectionsSummary {
  totalCollectedCents: number;
  pendingCollectionCents: number;
  subscriptionCollectedCents: number;
  platformFeeCollectedCents: number;
  pendingAdvisorPayoutCents: number;
  completedAdvisorPayoutCents: number;
  byRail: Record<AdminPaymentRail, { count: number; collectedCents: number; pendingCents: number }>;
}

export function buildAdminCollectionRecord(input: {
  id: string;
  kind: AdminCollectionKind;
  targetUserId: string;
  targetWs: string;
  companyName: string;
  contactEmail: string;
  engagementId?: string;
  advisorId?: string;
  advisorName?: string;
  description?: string;
  grossCents: number;
  platformFeePct?: number;
  currency?: string;
  rail?: AdminPaymentRail;
  status?: AdminCollectionStatus;
  reference?: string;
  issuedAt?: string;
}): AdminPaymentCollectionRecord {
  const gross = Math.max(0, Math.round(Number(input.grossCents) || 0));
  const isShared = input.kind === 'shared_service_fee';
  const split = isShared
    ? computeFeeSplit(gross, input.platformFeePct ?? DEFAULT_PLATFORM_FEE_PCT)
    : { grossCents: gross, platformFeePct: 100, platformFeeCents: gross, advisorNetCents: 0 };

  const rail: AdminPaymentRail =
    input.rail === 'stripe' ||
    input.rail === 'paystack' ||
    input.rail === 'momo' ||
    input.rail === 'bank_transfer' ||
    input.rail === 'manual'
      ? input.rail
      : 'stripe';

  const status: AdminCollectionStatus =
    input.status === 'paid' || input.status === 'failed' || input.status === 'refunded'
      ? input.status
      : 'pending';

  const now = input.issuedAt ?? new Date().toISOString();
  const ref = (input.reference || `COL-${input.id.slice(-6).toUpperCase()}`).trim();
  const paymentUrl = `/app?pay=${encodeURIComponent(input.id)}&rail=${encodeURIComponent(rail)}`;

  return {
    id: input.id,
    kind: input.kind,
    targetUserId: input.targetUserId,
    targetWs: input.targetWs,
    companyName: (input.companyName || input.targetWs).trim(),
    contactEmail: (input.contactEmail || '').trim().toLowerCase(),
    ...(input.engagementId ? { engagementId: input.engagementId } : {}),
    ...(input.advisorId ? { advisorId: input.advisorId } : {}),
    ...(input.advisorName ? { advisorName: input.advisorName } : {}),
    description:
      (input.description || '').trim() ||
      (input.kind === 'subscription'
        ? `Workspace SaaS Subscription (${input.companyName})`
        : input.kind === 'shared_service_fee'
          ? `Shared Services Engagement (${input.advisorName || 'Advisor'})`
          : `Platform Charge (${input.companyName})`),
    grossCents: split.grossCents,
    platformFeeCents: split.platformFeeCents,
    advisorPayoutCents: split.advisorNetCents,
    currency: (input.currency || 'USD').trim().toUpperCase(),
    rail,
    status,
    advisorPayoutStatus: isShared && split.advisorNetCents > 0 ? 'unpaid' : 'not_applicable',
    reference: ref,
    paymentUrl,
    issuedAt: now,
    ...(status === 'paid' ? { paidAt: now } : {}),
  };
}

export function summarizeAdminCollections(
  collections: readonly AdminPaymentCollectionRecord[],
): AdminCollectionsSummary {
  const byRail: AdminCollectionsSummary['byRail'] = {
    stripe: { count: 0, collectedCents: 0, pendingCents: 0 },
    paystack: { count: 0, collectedCents: 0, pendingCents: 0 },
    momo: { count: 0, collectedCents: 0, pendingCents: 0 },
    bank_transfer: { count: 0, collectedCents: 0, pendingCents: 0 },
    manual: { count: 0, collectedCents: 0, pendingCents: 0 },
  };

  let totalCollectedCents = 0;
  let pendingCollectionCents = 0;
  let subscriptionCollectedCents = 0;
  let platformFeeCollectedCents = 0;
  let pendingAdvisorPayoutCents = 0;
  let completedAdvisorPayoutCents = 0;

  for (const c of collections) {
    const bucket = byRail[c.rail] ?? byRail.stripe;
    bucket.count += 1;
    if (c.status === 'paid') {
      totalCollectedCents += c.grossCents;
      bucket.collectedCents += c.grossCents;
      if (c.kind === 'subscription') {
        subscriptionCollectedCents += c.grossCents;
      } else {
        platformFeeCollectedCents += c.platformFeeCents;
      }
      if (c.advisorPayoutCents > 0) {
        if (c.advisorPayoutStatus === 'paid') {
          completedAdvisorPayoutCents += c.advisorPayoutCents;
        } else {
          pendingAdvisorPayoutCents += c.advisorPayoutCents;
        }
      }
    } else if (c.status === 'pending') {
      pendingCollectionCents += c.grossCents;
      bucket.pendingCents += c.grossCents;
    }
  }

  return {
    totalCollectedCents,
    pendingCollectionCents,
    subscriptionCollectedCents,
    platformFeeCollectedCents,
    pendingAdvisorPayoutCents,
    completedAdvisorPayoutCents,
    byRail,
  };
}

