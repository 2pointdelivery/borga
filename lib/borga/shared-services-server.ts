import 'server-only';
import { randomBytes } from 'node:crypto';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { userWorkspacesKey, userWsKey, isValidUserId, isValidWsId } from './keys';
import { getUserById } from '@/lib/auth/queries';
import { isOperator } from '@/lib/auth/signup-policy';
import { appendAudit } from './audit';
import { addNotice } from './notices';
import { getApiKey } from './secrets';
import { sendThreadedEmail } from '@/lib/auth/mailer';
import {
  buildCalComBookingPayload,
  normalizeCalComUrl,
  parseCalComBookingResponse,
  renderMeetingInviteEmail,
  type MeetingInviteInput,
} from './meeting-invites';
import { FEATURES, isFeatureId, resolveFeatures, parseEnvOff, type FeatureId, type FeatureOverrides } from './features';
import type { Bill, TeamInvite, Workspace } from './data';
import type { BillingRecord } from './billing';
import {
  DEFAULT_SCOPES_FOR_CATEGORY,
  SERVICE_CATEGORY_LABELS,
  addEngagementInvoice,
  allowedEntitiesForScopes,
  buildAdminCollectionRecord,
  buildEngagementFromSource,
  buildPlatformAnalyticsBreakdowns,
  canAdvisorAccessEntity,
  computeFeeSplit,
  computeWorkspaceSubscriptionBill,
  isAdvisorScope,
  isServiceCategory,
  normalizeAdminConfig,
  normalizeCategories,
  normalizeScopes,
  scopesForDepartmentOrRole,
  summarizeAdminCollections,
  summarizePlatformRevenue,
  type AdminCollectionKind,
  type AdminCollectionStatus,
  type AdminCollectionsSummary,
  type AdminPaymentCollectionRecord,
  type AdminPaymentRail,
  type AdvisorCompanyInvite,
  type AdvisorModuleScope,
  type AdvisorProfile,
  type AdvisorStatus,
  type AvailabilitySlot,
  type EngagementStatus,
  type PlatformAdminConfig,
  type ServiceBooking,
  type ServiceCategory,
  type ServiceEngagement,
  type ServicePackage,
  type ServiceProposal,
} from './shared-services';

const ADMIN_CONFIG_KEY = 't::admin::config';
const ADMIN_COLLECTIONS_KEY = 't::admin::collections';
const ADVISORS_KEY = 't::shared_services::advisors';
const BOOKINGS_KEY = 't::shared_services::bookings';
const PROPOSALS_KEY = 't::shared_services::proposals';
const ENGAGEMENTS_KEY = 't::shared_services::engagements';

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

// ── Admin Config & Feature Toggles ──────────────────────────────────────────────────────────────────────────────────

export async function loadAdminConfig(): Promise<PlatformAdminConfig> {
  const raw = await getBorgaState<Partial<PlatformAdminConfig>>(ADMIN_CONFIG_KEY).catch(() => null);
  return normalizeAdminConfig(raw);
}

export async function saveAdminConfig(patch: Partial<PlatformAdminConfig>): Promise<PlatformAdminConfig> {
  const cur = await loadAdminConfig();
  const next = normalizeAdminConfig({
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  await setBorgaState(ADMIN_CONFIG_KEY, next);
  return next;
}

export async function toggleGlobalFeature(featureId: string, enabled: boolean): Promise<PlatformAdminConfig | null> {
  if (!isFeatureId(featureId)) return null;
  const cur = await loadAdminConfig();
  const set = new Set<FeatureId>(cur.globalFeaturesOff);
  if (enabled) set.delete(featureId);
  else set.add(featureId);
  return saveAdminConfig({ globalFeaturesOff: [...set] });
}

export async function setWorkspaceFeatureByAdmin(
  targetUserId: string,
  targetWs: string,
  featureId: string,
  enabled: boolean,
): Promise<boolean> {
  if (!isValidUserId(targetUserId) || !isValidWsId(targetWs) || !isFeatureId(featureId)) return false;
  const key = userWsKey(targetUserId, targetWs, 'features');
  const stored = (await getBorgaState<FeatureOverrides>(key).catch(() => null)) ?? {};
  return setBorgaState(key, { ...stored, [featureId]: enabled });
}

// ── Advisors / Agencies Directory ───────────────────────────────────────────────────────────────────────────────────

export async function loadAdvisors(): Promise<AdvisorProfile[]> {
  return (await getBorgaState<AdvisorProfile[]>(ADVISORS_KEY).catch(() => null)) ?? [];
}

async function saveAdvisors(list: AdvisorProfile[]): Promise<boolean> {
  return setBorgaState(ADVISORS_KEY, list);
}

export async function listAdvisors(opts: { onlyApproved?: boolean; category?: ServiceCategory } = {}): Promise<AdvisorProfile[]> {
  const all = await loadAdvisors();
  return all.filter((a) => {
    if (opts.onlyApproved && a.status !== 'approved') return false;
    if (opts.category && !a.categories.includes(opts.category)) return false;
    return true;
  });
}

export async function getAdvisorByUserId(userId: string): Promise<AdvisorProfile | null> {
  const all = await loadAdvisors();
  return all.find((a) => a.userId === userId) ?? null;
}

export async function upsertAdvisorProfile(
  userId: string,
  email: string,
  input: {
    name: string;
    agencyName?: string;
    headline?: string;
    bio?: string;
    categories?: unknown;
    defaultScopes?: unknown;
    hourlyRateCents?: number;
    currency?: string;
    availabilitySlots?: AvailabilitySlot[];
    packages?: ServicePackage[];
    calComUrl?: string;
    calComEventTypeId?: number;
    autoApproveIfOperator?: boolean;
  },
): Promise<AdvisorProfile> {
  const [all, adminCfg] = await Promise.all([loadAdvisors(), loadAdminConfig()]);
  const existing = all.find((a) => a.userId === userId);
  const now = new Date().toISOString();
  const categories = normalizeCategories(input.categories);
  const effectiveCategories: ServiceCategory[] = categories.length ? categories : ['accounting'];
  const scopes = normalizeScopes(input.defaultScopes);
  const effectiveScopes: AdvisorModuleScope[] = scopes.length
    ? scopes
    : [...new Set(effectiveCategories.flatMap((c) => DEFAULT_SCOPES_FOR_CATEGORY[c]))];

  const slots: AvailabilitySlot[] = Array.isArray(input.availabilitySlots)
    ? input.availabilitySlots
      .filter((s) => s && Number.isInteger(s.dayOfWeek) && s.dayOfWeek >= 0 && s.dayOfWeek <= 6 && Number.isInteger(s.startHour) && s.startHour >= 0 && s.startHour <= 23)
      .slice(0, 24)
      .map((s, idx) => ({
        id: s.id || `slot-${idx + 1}`,
        dayOfWeek: s.dayOfWeek,
        startHour: s.startHour,
        durationMin: s.durationMin === 30 || s.durationMin === 45 || s.durationMin === 60 ? s.durationMin : 60,
      }))
    : (existing?.availabilitySlots ?? [
      { id: 'slot-mon-10', dayOfWeek: 1, startHour: 10, durationMin: 60 },
      { id: 'slot-wed-14', dayOfWeek: 3, startHour: 14, durationMin: 60 },
      { id: 'slot-fri-11', dayOfWeek: 5, startHour: 11, durationMin: 60 },
    ]);

  const packages: ServicePackage[] = Array.isArray(input.packages)
    ? input.packages
      .filter((p) => p && typeof p.title === 'string' && p.title.trim())
      .slice(0, 12)
      .map((p, idx) => {
        const cat = isServiceCategory(p.category) ? p.category : effectiveCategories[0];
        const pkgScopes = normalizeScopes(p.scopes);
        return {
          id: p.id || `pkg-${Date.now().toString(36)}-${idx}`,
          title: p.title.trim().slice(0, 120),
          description: String(p.description ?? '').trim().slice(0, 600),
          category: cat,
          scopes: pkgScopes.length ? pkgScopes : DEFAULT_SCOPES_FOR_CATEGORY[cat],
          priceCents: Math.max(0, Math.round(Number(p.priceCents) || 0)),
          billingCycle: p.billingCycle === 'one_time' ? 'one_time' : 'monthly',
          deliverables: Array.isArray(p.deliverables) ? p.deliverables.map((d) => String(d).trim()).filter(Boolean).slice(0, 10) : [],
        };
      })
    : (existing?.packages ?? []);

  const initialStatus: AdvisorStatus = existing
    ? existing.status
    : (adminCfg.autoApproveAdvisors || (input.autoApproveIfOperator && isOperator(email, process.env)) ? 'approved' : 'pending');

  const rawRate = input.hourlyRateCents !== undefined
    ? Math.max(0, Math.round(Number(input.hourlyRateCents) || 0))
    : (existing?.hourlyRateCents ?? 150_00);
  const hourlyRateCents = Math.max(adminCfg.minAdvisorRateCents, rawRate);

  const profile: AdvisorProfile = {
    id: existing?.id ?? uid('adv'),
    userId,
    email: email.trim().toLowerCase(),
    name: input.name.trim().slice(0, 100) || existing?.name || 'Advisor',
    agencyName: input.agencyName !== undefined ? input.agencyName.trim().slice(0, 120) : existing?.agencyName,
    headline: (input.headline ?? existing?.headline ?? 'Certified Business Advisor').trim().slice(0, 160),
    bio: (input.bio ?? existing?.bio ?? '').trim().slice(0, 1500),
    categories: effectiveCategories,
    defaultScopes: effectiveScopes,
    hourlyRateCents,
    currency: (input.currency ?? existing?.currency ?? 'USD').toUpperCase().slice(0, 3),
    status: initialStatus,
    availabilitySlots: slots,
    packages,
    calComUrl:
      input.calComUrl !== undefined
        ? normalizeCalComUrl(input.calComUrl)
        : existing?.calComUrl,
    calComEventTypeId:
      typeof input.calComEventTypeId === 'number' && Number.isFinite(input.calComEventTypeId) && input.calComEventTypeId > 0
        ? Math.round(input.calComEventTypeId)
        : existing?.calComEventTypeId,
    rating: existing?.rating ?? 5.0,
    completedEngagements: existing?.completedEngagements ?? 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const next = existing ? all.map((a) => (a.id === profile.id ? profile : a)) : [profile, ...all];
  await saveAdvisors(next);
  return profile;
}

export async function vetAdvisorProfile(advisorId: string, status: AdvisorStatus): Promise<AdvisorProfile | null> {
  const all = await loadAdvisors();
  const target = all.find((a) => a.id === advisorId);
  if (!target) return null;
  const updated: AdvisorProfile = { ...target, status, updatedAt: new Date().toISOString() };
  await saveAdvisors(all.map((a) => (a.id === advisorId ? updated : a)));
  return updated;
}

// ── Call Bookings ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function loadBookings(): Promise<ServiceBooking[]> {
  return (await getBorgaState<ServiceBooking[]>(BOOKINGS_KEY).catch(() => null)) ?? [];
}

async function saveBookings(list: ServiceBooking[]): Promise<boolean> {
  return setBorgaState(BOOKINGS_KEY, list);
}

async function dispatchMeetingEmails(
  inviteInput: MeetingInviteInput,
  ctx: { userId: string; ws: string },
): Promise<boolean> {
  let anySent = false;
  const method = inviteInput.status === 'canceled' ? 'CANCEL' : 'REQUEST';
  const filename = inviteInput.status === 'canceled' ? 'cancel.ics' : 'invite.ics';

  if (inviteInput.advisorEmail) {
    const advMail = renderMeetingInviteEmail(inviteInput, 'advisor');
    const rAdv = await sendThreadedEmail(
      {
        to: inviteInput.advisorEmail,
        subject: advMail.subject,
        text: advMail.text,
        html: advMail.html,
        replyTo: inviteInput.clientEmail || undefined,
        icalEvent: { method, filename, content: advMail.ics },
      },
      ctx,
    ).catch(() => ({ ok: false }));
    if (rAdv.ok) anySent = true;
  }

  if (inviteInput.clientEmail && inviteInput.clientEmail.toLowerCase() !== inviteInput.advisorEmail.toLowerCase()) {
    const cliMail = renderMeetingInviteEmail(inviteInput, 'client');
    const rCli = await sendThreadedEmail(
      {
        to: inviteInput.clientEmail,
        subject: cliMail.subject,
        text: cliMail.text,
        html: cliMail.html,
        replyTo: inviteInput.advisorEmail || undefined,
        icalEvent: { method, filename, content: cliMail.ics },
      },
      ctx,
    ).catch(() => ({ ok: false }));
    if (rCli.ok) anySent = true;
  }

  return anySent;
}

export async function bookAdvisorCall(
  clientUserId: string,
  clientWs: string,
  input: {
    advisorId: string;
    category?: ServiceCategory;
    scheduledAt: string;
    durationMin?: number;
    topic: string;
    notes?: string;
    packageId?: string;
  },
): Promise<ServiceBooking | { error: string }> {
  const advisors = await loadAdvisors();
  const advisor = advisors.find((a) => a.id === input.advisorId && a.status === 'approved');
  if (!advisor) return { error: 'Advisor not found or not yet approved.' };

  const [clientUser, workspaces] = await Promise.all([
    getUserById(clientUserId).catch(() => null),
    getBorgaState<Workspace[]>(userWorkspacesKey(clientUserId)).catch(() => null),
  ]);
  const wsObj = (workspaces ?? []).find((w) => w.id === clientWs);
  if (!wsObj) return { error: 'Client company workspace not found.' };

  const id = uid('bk');
  const now = new Date().toISOString();
  const cat = input.category && isServiceCategory(input.category) ? input.category : advisor.categories[0] ?? 'accounting';
  const durationMin = input.durationMin && [30, 45, 60].includes(input.durationMin) ? input.durationMin : 45;
  const topic = input.topic.trim().slice(0, 200) || `Consultation with ${advisor.name}`;
  const notes = input.notes?.trim().slice(0, 1000);
  const clientEmail = (clientUser?.email ?? wsObj.email ?? '').trim().toLowerCase();

  // Optional Cal.com API v2 booking creation when CALCOM_API_KEY and advisor.calComEventTypeId are configured
  let calComBookingUid: string | undefined;
  let calComMeetingUrl: string | undefined;
  const calApiKey = (process.env.CALCOM_API_KEY || (await getApiKey('CALCOM_API_KEY').catch(() => ''))).trim();
  if (calApiKey && advisor.calComEventTypeId && clientEmail) {
    try {
      const payload = buildCalComBookingPayload({
        eventTypeId: advisor.calComEventTypeId,
        scheduledAt: input.scheduledAt,
        attendeeName: clientUser?.name || wsObj.name,
        attendeeEmail: clientEmail,
        timeZone: wsObj.timezone || 'UTC',
        bookingId: id,
        topic,
        notes,
      });
      const calRes = await fetch('https://api.cal.com/v2/bookings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${calApiKey}`,
          'Content-Type': 'application/json',
          'cal-api-version': '2024-08-13',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (calRes.ok) {
        const parsed = parseCalComBookingResponse(await calRes.json().catch(() => null));
        calComBookingUid = parsed.uid;
        calComMeetingUrl = parsed.meetingUrl;
      }
    } catch {
      // Fall back cleanly to built-in video room + .ics email invite
    }
  }

  const meetingUrl = calComMeetingUrl || advisor.calComUrl || `https://meet.jit.si/borga-${id}`;

  const inviteSent = await dispatchMeetingEmails(
    {
      bookingId: id,
      topic,
      notes,
      categoryLabel: SERVICE_CATEGORY_LABELS[cat],
      scheduledAt: input.scheduledAt,
      durationMin,
      meetingUrl,
      calComUrl: advisor.calComUrl,
      calComBookingUid,
      advisorName: advisor.agencyName || advisor.name,
      advisorEmail: advisor.email,
      clientName: clientUser?.name || wsObj.name,
      clientCompanyName: wsObj.name,
      clientEmail,
      status: 'scheduled',
    },
    { userId: clientUserId, ws: clientWs },
  );

  const booking: ServiceBooking = {
    id,
    advisorId: advisor.id,
    advisorUserId: advisor.userId,
    advisorName: advisor.agencyName || advisor.name,
    advisorEmail: advisor.email,
    clientUserId,
    clientWs,
    clientCompanyName: wsObj.name,
    clientEmail,
    category: cat,
    scheduledAt: input.scheduledAt,
    durationMin,
    topic,
    notes,
    meetingUrl,
    calComUrl: advisor.calComUrl,
    calComBookingUid,
    inviteEmailSent: inviteSent,
    status: 'scheduled',
    packageId: input.packageId,
    createdAt: now,
  };

  const bookings = await loadBookings();
  await saveBookings([booking, ...bookings]);

  await addNotice({
    id: uid('n-bk'),
    title: `Call booked with ${booking.advisorName}`,
    body: `${booking.topic} scheduled for ${booking.scheduledAt.slice(0, 16).replace('T', ' ')}.${inviteSent ? ' Calendar invites emailed.' : ''}`,
    severity: 'info',
    source: 'scheduler',
    createdAt: now,
    readAt: null,
  }, clientWs, clientUserId).catch(() => undefined);

  return booking;
}

export async function updateBookingStatus(
  actorUserId: string,
  bookingId: string,
  status: 'scheduled' | 'completed' | 'canceled',
): Promise<ServiceBooking | null> {
  const bookings = await loadBookings();
  const target = bookings.find((b) => b.id === bookingId);
  if (!target) return null;
  if (target.clientUserId !== actorUserId && target.advisorUserId !== actorUserId) return null;
  const updated: ServiceBooking = { ...target, status };
  await saveBookings(bookings.map((b) => (b.id === bookingId ? updated : b)));

  if (status === 'canceled' && target.status !== 'canceled') {
    const advisors = await loadAdvisors();
    const advisor = advisors.find((a) => a.id === target.advisorId);
    const advisorEmail = target.advisorEmail || advisor?.email || '';
    void dispatchMeetingEmails(
      {
        bookingId: target.id,
        topic: target.topic,
        notes: target.notes,
        categoryLabel: SERVICE_CATEGORY_LABELS[target.category] ?? target.category,
        scheduledAt: target.scheduledAt,
        durationMin: target.durationMin,
        meetingUrl: target.meetingUrl,
        calComUrl: target.calComUrl,
        calComBookingUid: target.calComBookingUid,
        advisorName: target.advisorName,
        advisorEmail,
        clientName: target.clientCompanyName,
        clientCompanyName: target.clientCompanyName,
        clientEmail: target.clientEmail,
        status: 'canceled',
      },
      { userId: target.clientUserId, ws: target.clientWs },
    );
  }

  return updated;
}

// ── Proposals & Engagements (85/15 Split + Scoped Access) ───────────────────────────────────────────────────────────

export async function loadProposals(): Promise<ServiceProposal[]> {
  return (await getBorgaState<ServiceProposal[]>(PROPOSALS_KEY).catch(() => null)) ?? [];
}

async function saveProposals(list: ServiceProposal[]): Promise<boolean> {
  return setBorgaState(PROPOSALS_KEY, list);
}

export async function loadEngagements(): Promise<ServiceEngagement[]> {
  return (await getBorgaState<ServiceEngagement[]>(ENGAGEMENTS_KEY).catch(() => null)) ?? [];
}

async function saveEngagements(list: ServiceEngagement[]): Promise<boolean> {
  return setBorgaState(ENGAGEMENTS_KEY, list);
}

export async function createServiceProposal(
  advisorUserId: string,
  input: {
    bookingId?: string;
    clientUserId: string;
    clientWs: string;
    title: string;
    summary?: string;
    category: ServiceCategory;
    requestedScopes?: AdvisorModuleScope[];
    billingCycle: 'one_time' | 'monthly';
    grossCents: number;
    deliverables?: string[];
  },
): Promise<ServiceProposal | { error: string }> {
  const advisor = await getAdvisorByUserId(advisorUserId);
  if (!advisor || advisor.status !== 'approved') {
    return { error: 'Only an approved advisor can send proposals.' };
  }
  const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(input.clientUserId)).catch(() => null)) ?? [];
  const wsObj = workspaces.find((w) => w.id === input.clientWs);
  if (!wsObj) return { error: 'Client workspace not found.' };

  const adminConfig = await loadAdminConfig();
  const split = computeFeeSplit(input.grossCents, adminConfig.platformFeePct);
  if (split.grossCents <= 0) return { error: 'Proposal fee must be greater than zero.' };

  const scopes = normalizeScopes(input.requestedScopes);
  const now = new Date().toISOString();
  const proposal: ServiceProposal = {
    id: uid('prop'),
    bookingId: input.bookingId,
    advisorId: advisor.id,
    advisorUserId: advisor.userId,
    advisorName: advisor.agencyName || advisor.name,
    clientUserId: input.clientUserId,
    clientWs: input.clientWs,
    clientCompanyName: wsObj.name,
    title: input.title.trim().slice(0, 140) || `${advisor.name} Service Proposal`,
    summary: (input.summary ?? '').trim().slice(0, 1200),
    category: isServiceCategory(input.category) ? input.category : advisor.categories[0] ?? 'accounting',
    requestedScopes: scopes.length ? scopes : DEFAULT_SCOPES_FOR_CATEGORY[input.category] ?? ['finance'],
    billingCycle: input.billingCycle === 'one_time' ? 'one_time' : 'monthly',
    grossCents: split.grossCents,
    platformFeePct: split.platformFeePct,
    platformFeeCents: split.platformFeeCents,
    advisorNetCents: split.advisorNetCents,
    deliverables: Array.isArray(input.deliverables) ? input.deliverables.map((d) => String(d).trim()).filter(Boolean).slice(0, 12) : [],
    status: 'sent',
    createdAt: now,
  };

  const all = await loadProposals();
  await saveProposals([proposal, ...all]);

  await addNotice({
    id: uid('n-prop'),
    title: `New service proposal from ${proposal.advisorName}`,
    body: `${proposal.title} ($${(proposal.grossCents / 100).toFixed(2)}). Review and grant access under Company → Shared Services.`,
    severity: 'noteworthy',
    source: 'scheduler',
    createdAt: now,
    readAt: null,
  }, input.clientWs, input.clientUserId).catch(() => undefined);

  return proposal;
}

async function recordClientServiceBill(
  clientUserId: string,
  clientWs: string,
  engagement: ServiceEngagement,
  grossCents: number,
  nowIso: string,
): Promise<void> {
  const billsKey = userWsKey(clientUserId, clientWs, 'bills');
  const existing = (await getBorgaState<Bill[]>(billsKey).catch(() => null)) ?? [];
  const amount = Math.round(grossCents) / 100;
  const dateStr = nowIso.slice(0, 10);
  const bill: Bill = {
    id: uid('bill-svc'),
    vendorId: engagement.advisorId,
    vendorName: `${engagement.advisorName} (Shared Services)`,
    number: `SVC-${existing.length + 1}`,
    amount,
    status: 'paid',
    received: dateStr,
    due: dateStr,
    description: `${engagement.title} — Paid via Borga Shared Services (85% advisor / ${engagement.platformFeePct}% platform fee)`,
  };
  await setBorgaState(billsKey, [bill, ...existing]).catch(() => undefined);
}

export async function respondToProposal(
  clientUserId: string,
  clientWs: string,
  proposalId: string,
  decision: 'accepted' | 'declined',
  overrideScopes?: AdvisorModuleScope[],
): Promise<{ proposal: ServiceProposal; engagement?: ServiceEngagement } | { error: string }> {
  const proposals = await loadProposals();
  const prop = proposals.find((p) => p.id === proposalId && p.clientUserId === clientUserId && p.clientWs === clientWs);
  if (!prop) return { error: 'Proposal not found.' };
  if (prop.status !== 'sent') return { error: `Proposal is already ${prop.status}.` };

  const now = new Date().toISOString();
  const updatedProp: ServiceProposal = { ...prop, status: decision, decidedAt: now };
  await saveProposals(proposals.map((p) => (p.id === proposalId ? updatedProp : p)));

  if (decision === 'declined') {
    return { proposal: updatedProp };
  }

  const advisors = await loadAdvisors();
  const advisor = advisors.find((a) => a.id === prop.advisorId);
  const scopes = overrideScopes && overrideScopes.length ? normalizeScopes(overrideScopes) : prop.requestedScopes;

  const engagement = buildEngagementFromSource({
    id: uid('eng'),
    invoiceId: uid('sinv'),
    advisor: {
      id: prop.advisorId,
      userId: prop.advisorUserId,
      name: prop.advisorName,
      email: advisor?.email ?? '',
    },
    clientUserId,
    clientWs,
    clientCompanyName: prop.clientCompanyName,
    source: 'proposal',
    sourceId: prop.id,
    title: prop.title,
    category: prop.category,
    scopes,
    billingCycle: prop.billingCycle,
    grossCents: prop.grossCents,
    platformFeePct: prop.platformFeePct,
    nowIso: now,
  });

  const engagements = await loadEngagements();
  await saveEngagements([engagement, ...engagements]);
  await recordClientServiceBill(clientUserId, clientWs, engagement, engagement.grossCents, now);

  return { proposal: updatedProp, engagement };
}

export async function purchaseServicePackage(
  clientUserId: string,
  clientWs: string,
  input: {
    advisorId: string;
    packageId: string;
    kickoffAt?: string;
    grantedScopes?: AdvisorModuleScope[];
  },
): Promise<{ engagement: ServiceEngagement; booking?: ServiceBooking } | { error: string }> {
  const advisors = await loadAdvisors();
  const advisor = advisors.find((a) => a.id === input.advisorId && a.status === 'approved');
  if (!advisor) return { error: 'Advisor not found or not approved.' };
  const pkg = advisor.packages.find((p) => p.id === input.packageId);
  if (!pkg) return { error: 'Service package not found.' };

  const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(clientUserId)).catch(() => null)) ?? [];
  const wsObj = workspaces.find((w) => w.id === clientWs);
  if (!wsObj) return { error: 'Client workspace not found.' };

  const adminConfig = await loadAdminConfig();
  const now = new Date().toISOString();
  const scopes = input.grantedScopes && input.grantedScopes.length ? normalizeScopes(input.grantedScopes) : pkg.scopes;

  const engagement = buildEngagementFromSource({
    id: uid('eng'),
    invoiceId: uid('sinv'),
    advisor: {
      id: advisor.id,
      userId: advisor.userId,
      name: advisor.agencyName || advisor.name,
      email: advisor.email,
    },
    clientUserId,
    clientWs,
    clientCompanyName: wsObj.name,
    source: 'package',
    sourceId: pkg.id,
    title: pkg.title,
    category: pkg.category,
    scopes,
    billingCycle: pkg.billingCycle,
    grossCents: pkg.priceCents,
    platformFeePct: adminConfig.platformFeePct,
    nowIso: now,
  });

  const engagements = await loadEngagements();
  await saveEngagements([engagement, ...engagements]);
  await recordClientServiceBill(clientUserId, clientWs, engagement, engagement.grossCents, now);

  let booking: ServiceBooking | undefined;
  if (input.kickoffAt) {
    const bk = await bookAdvisorCall(clientUserId, clientWs, {
      advisorId: advisor.id,
      category: pkg.category,
      scheduledAt: input.kickoffAt,
      durationMin: 45,
      topic: `Kickoff: ${pkg.title}`,
      packageId: pkg.id,
    });
    if (!('error' in bk)) booking = bk;
  }

  return { engagement, booking };
}

export async function updateEngagementAccess(
  clientUserId: string,
  clientWs: string,
  engagementId: string,
  patch: { status?: EngagementStatus; grantedScopes?: AdvisorModuleScope[] },
): Promise<ServiceEngagement | { error: string }> {
  const engagements = await loadEngagements();
  const target = engagements.find((e) => e.id === engagementId && e.clientUserId === clientUserId && e.clientWs === clientWs);
  if (!target) return { error: 'Engagement not found.' };

  const updated: ServiceEngagement = {
    ...target,
    status: patch.status ?? target.status,
    grantedScopes: patch.grantedScopes !== undefined ? normalizeScopes(patch.grantedScopes) : target.grantedScopes,
    updatedAt: new Date().toISOString(),
  };
  await saveEngagements(engagements.map((e) => (e.id === engagementId ? updated : e)));

  if (patch.status === 'completed' && target.status !== 'completed') {
    const advisors = await loadAdvisors();
    await saveAdvisors(advisors.map((a) => (a.id === target.advisorId ? { ...a, completedEngagements: a.completedEngagements + 1 } : a)));
  }

  return updated;
}

export async function billEngagementMilestone(
  advisorUserId: string,
  engagementId: string,
  input: { description: string; grossCents: number },
): Promise<ServiceEngagement | { error: string }> {
  if (input.grossCents <= 0) return { error: 'Invoice amount must be positive.' };
  const engagements = await loadEngagements();
  const target = engagements.find((e) => e.id === engagementId && e.advisorUserId === advisorUserId);
  if (!target) return { error: 'Engagement not found.' };
  if (target.status !== 'active') return { error: 'Only active engagements can bill milestones or retainers.' };

  const adminConfig = await loadAdminConfig();
  const now = new Date().toISOString();
  const updated = addEngagementInvoice(
    target,
    { id: uid('sinv'), description: input.description, grossCents: input.grossCents, paid: true, nowIso: now },
    adminConfig.platformFeePct,
  );
  await saveEngagements(engagements.map((e) => (e.id === engagementId ? updated : e)));
  await recordClientServiceBill(target.clientUserId, target.clientWs, updated, input.grossCents, now);
  return updated;
}

// ── Advisor Acting on Behalf of Client Company (Module-Scoped Access) ───────────────────────────────────────────────

export async function activeAdvisorEmailsForWorkspace(clientUserId: string, clientWs: string): Promise<string[]> {
  const engagements = await loadEngagements();
  return engagements
    .filter((e) => e.clientUserId === clientUserId && e.clientWs === clientWs && e.status === 'active')
    .map((e) => e.advisorEmail)
    .filter(Boolean);
}

export async function advisorReadClientWorkspace(
  advisorUserId: string,
  engagementId: string,
): Promise<{
  engagement: ServiceEngagement;
  allowedEntities: string[];
  data: Record<string, unknown>;
} | { error: string; status: number }> {
  const engagements = await loadEngagements();
  const engagement = engagements.find((e) => e.id === engagementId && e.advisorUserId === advisorUserId);
  if (!engagement) return { error: 'Engagement not found.', status: 404 };
  if (engagement.status !== 'active') return { error: `Engagement access is ${engagement.status}.`, status: 403 };

  const allowed = [...allowedEntitiesForScopes(engagement.grantedScopes)];
  const data: Record<string, unknown> = {};
  await Promise.all(
    allowed.map(async (entity) => {
      if (entity === 'tickets') {
        const { listTickets } = await import('./tickets-server');
        data.tickets = await listTickets(engagement.clientUserId, engagement.clientWs).catch(() => []);
      } else {
        data[entity] = (await getBorgaState(userWsKey(engagement.clientUserId, engagement.clientWs, entity)).catch(() => null)) ?? [];
      }
    }),
  );

  return { engagement, allowedEntities: allowed, data };
}

export async function advisorWriteClientEntity(
  advisorUserId: string,
  engagementId: string,
  input: {
    entity: string;
    value: unknown;
    scope?: AdvisorModuleScope;
    summary?: string;
  },
): Promise<{ engagement: ServiceEngagement; saved: boolean } | { error: string; status: number }> {
  const engagements = await loadEngagements();
  const engagement = engagements.find((e) => e.id === engagementId && e.advisorUserId === advisorUserId);
  if (!engagement) return { error: 'Engagement not found.', status: 404 };
  if (engagement.status !== 'active') return { error: `Engagement access is ${engagement.status}.`, status: 403 };

  if (!canAdvisorAccessEntity(engagement.grantedScopes, input.entity)) {
    return {
      error: `Access denied: entity "${input.entity}" is outside your granted module scopes (${engagement.grantedScopes.join(', ')}).`,
      status: 403,
    };
  }

  const key = userWsKey(engagement.clientUserId, engagement.clientWs, input.entity);
  const ok = await setBorgaState(key, input.value);
  if (!ok) return { error: 'Database unavailable.', status: 503 };

  await appendAudit(
    `${advisorUserId} (advisor:${engagement.advisorName})`,
    engagement.clientWs,
    input.entity,
    null,
  ).catch(() => undefined);

  const now = new Date().toISOString();
  const matchedScope = engagement.grantedScopes.find((s) => canAdvisorAccessEntity([s], input.entity)) ?? engagement.grantedScopes[0] ?? 'finance';
  const workEntry = {
    id: uid('work'),
    at: now,
    actorName: engagement.advisorName,
    scope: input.scope && isAdvisorScope(input.scope) ? input.scope : matchedScope,
    summary: (input.summary ?? `Updated ${input.entity}`).trim().slice(0, 280),
  };
  const updated: ServiceEngagement = {
    ...engagement,
    workLog: [workEntry, ...engagement.workLog].slice(0, 100),
    updatedAt: now,
  };
  await saveEngagements(engagements.map((e) => (e.id === engagementId ? updated : e)));

  return { engagement: updated, saved: true };
}

export async function logAdvisorWorkEntry(
  advisorUserId: string,
  engagementId: string,
  input: { scope: AdvisorModuleScope; summary: string },
): Promise<ServiceEngagement | { error: string }> {
  const engagements = await loadEngagements();
  const engagement = engagements.find((e) => e.id === engagementId && e.advisorUserId === advisorUserId);
  if (!engagement) return { error: 'Engagement not found.' };
  if (engagement.status !== 'active') return { error: `Engagement is ${engagement.status}.` };
  if (!engagement.grantedScopes.includes(input.scope)) {
    return { error: `Scope "${input.scope}" is not granted on this engagement.` };
  }
  const now = new Date().toISOString();
  const updated: ServiceEngagement = {
    ...engagement,
    workLog: [
      { id: uid('work'), at: now, actorName: engagement.advisorName, scope: input.scope, summary: input.summary.trim().slice(0, 280) },
      ...engagement.workLog,
    ].slice(0, 100),
    updatedAt: now,
  };
  await saveEngagements(engagements.map((e) => (e.id === engagementId ? updated : e)));
  return updated;
}

// ── Admin Portal Company & Revenue Analytics ────────────────────────────────────────────────────────────────────────

export interface AdminCompanyRow {
  userId: string;
  ownerEmail: string;
  ownerName: string;
  wsId: string;
  name: string;
  industry: string;
  country: string;
  currency: string;
  seats: number;
  monthlyCents: number;
  comped: boolean;
  subscriptionStatus: string;
  activeAdvisors: number;
  features: Record<FeatureId, boolean>;
}

export async function loadAdminCollections(): Promise<AdminPaymentCollectionRecord[]> {
  return (await getBorgaState<AdminPaymentCollectionRecord[]>(ADMIN_COLLECTIONS_KEY).catch(() => null)) ?? [];
}

async function saveAdminCollections(list: AdminPaymentCollectionRecord[]): Promise<boolean> {
  return setBorgaState(ADMIN_COLLECTIONS_KEY, list);
}

export async function createAdminPaymentCollection(input: {
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
  currency?: string;
  rail?: AdminPaymentRail;
  status?: AdminCollectionStatus;
  reference?: string;
}): Promise<AdminPaymentCollectionRecord | { error: string }> {
  if (!input.targetUserId || !input.targetWs) {
    return { error: 'Target company workspace is required.' };
  }
  if (!Number.isFinite(input.grossCents) || input.grossCents <= 0) {
    return { error: 'Collection amount must be greater than $0.00.' };
  }

  const [config, collections] = await Promise.all([loadAdminConfig(), loadAdminCollections()]);
  const record = buildAdminCollectionRecord({
    id: uid('col'),
    kind: input.kind,
    targetUserId: input.targetUserId,
    targetWs: input.targetWs,
    companyName: input.companyName,
    contactEmail: input.contactEmail,
    engagementId: input.engagementId,
    advisorId: input.advisorId,
    advisorName: input.advisorName,
    description: input.description,
    grossCents: input.grossCents,
    platformFeePct: config.platformFeePct,
    currency: input.currency || config.defaultCurrency,
    rail: input.rail,
    status: input.status,
    reference: input.reference,
  });

  await saveAdminCollections([record, ...collections]);

  if (record.status === 'paid') {
    await applyCollectionPaidEffects(record);
  } else {
    await addNotice(
      {
        id: uid('n-col'),
        title: `Payment request: ${record.description}`,
        body: `Amount due: $${(record.grossCents / 100).toFixed(2)} via ${record.rail.toUpperCase()} (Ref: ${record.reference}).`,
        severity: 'noteworthy',
        source: 'scheduler',
        createdAt: record.issuedAt,
        readAt: null,
      },
      record.targetWs,
      record.targetUserId,
    ).catch(() => undefined);
  }

  return record;
}

async function applyCollectionPaidEffects(record: AdminPaymentCollectionRecord): Promise<void> {
  const now = record.paidAt ?? new Date().toISOString();
  if (record.kind === 'subscription' && isValidUserId(record.targetUserId) && isValidWsId(record.targetWs)) {
    const billingKey = `t::${record.targetUserId}::${record.targetWs}::billing`;
    const cur = (await getBorgaState<BillingRecord>(billingKey).catch(() => null)) ?? {
      status: 'none' as const,
      seats: 1,
      updatedAt: now,
    };
    const nextPeriodEnd = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    await setBorgaState(billingKey, {
      ...cur,
      status: 'active',
      currentPeriodEnd: nextPeriodEnd,
      failedSince: undefined,
      updatedAt: now,
    });
  }

  if (record.kind === 'shared_service_fee' && record.engagementId) {
    const engagements = await loadEngagements();
    const targetEng = engagements.find((e) => e.id === record.engagementId);
    if (targetEng) {
      const updated = addEngagementInvoice(targetEng, {
        id: `inv-${record.id}`,
        description: record.description,
        grossCents: record.grossCents,
        paid: true,
        nowIso: now,
      });
      await saveEngagements(engagements.map((e) => (e.id === targetEng.id ? updated : e)));
    }
  }
}

export async function markAdminCollectionPaid(
  collectionId: string,
  opts: { rail?: AdminPaymentRail; reference?: string } = {},
): Promise<AdminPaymentCollectionRecord | { error: string }> {
  const collections = await loadAdminCollections();
  const target = collections.find((c) => c.id === collectionId);
  if (!target) return { error: 'Payment collection record not found.' };
  if (target.status === 'paid') return target;

  const now = new Date().toISOString();
  const updated: AdminPaymentCollectionRecord = {
    ...target,
    status: 'paid',
    rail: opts.rail ?? target.rail,
    reference: opts.reference?.trim() || target.reference,
    paidAt: now,
  };
  await saveAdminCollections(collections.map((c) => (c.id === collectionId ? updated : c)));
  await applyCollectionPaidEffects(updated);
  return updated;
}

export async function markAdvisorPayoutDisbursed(
  collectionId: string,
  opts: { reference?: string } = {},
): Promise<AdminPaymentCollectionRecord | { error: string }> {
  const collections = await loadAdminCollections();
  const target = collections.find((c) => c.id === collectionId);
  if (!target) return { error: 'Payment collection record not found.' };
  if (target.advisorPayoutCents <= 0) return { error: 'This collection has no advisor payout attached.' };

  const now = new Date().toISOString();
  const updated: AdminPaymentCollectionRecord = {
    ...target,
    advisorPayoutStatus: 'paid',
    payoutPaidAt: now,
    payoutReference: opts.reference?.trim() || `PAYOUT-${Date.now().toString(36).toUpperCase()}`,
  };
  await saveAdminCollections(collections.map((c) => (c.id === collectionId ? updated : c)));
  return updated;
}

export async function loadAdminOverview() {
  const [config, advisors, bookings, proposals, engagements, collections, wsKeys] = await Promise.all([
    loadAdminConfig(),
    loadAdvisors(),
    loadBookings(),
    loadProposals(),
    loadEngagements(),
    loadAdminCollections(),
    listBorgaKeys('u::%::workspaces').catch(() => [] as string[]),
  ]);

  const envOff = parseEnvOff(process.env.BORGA_FEATURES_OFF);
  const effectiveLocked = [...new Set([...envOff, ...config.globalFeaturesOff])];

  const companies: AdminCompanyRow[] = [];
  for (const key of wsKeys) {
    const m = /^u::([^:]+)::workspaces$/.exec(key);
    if (!m) continue;
    const userId = m[1];
    const [user, workspaces] = await Promise.all([
      getUserById(userId).catch(() => null),
      getBorgaState<Workspace[]>(key).catch(() => null),
    ]);
    for (const w of workspaces ?? []) {
      const [invites, billingRec, featOverrides] = await Promise.all([
        getBorgaState<TeamInvite[]>(userWsKey(userId, w.id, 'invites')).catch(() => null),
        getBorgaState<BillingRecord>(`t::${userId}::${w.id}::billing`).catch(() => null),
        getBorgaState<FeatureOverrides>(userWsKey(userId, w.id, 'features')).catch(() => null),
      ]);
      const wsEngagements = engagements.filter((e) => e.clientUserId === userId && e.clientWs === w.id && e.status === 'active');
      const sub = computeWorkspaceSubscriptionBill({
        acceptedInviteEmails: (invites ?? []).filter((i) => i.status === 'accepted').map((i) => i.email),
        ownerEmail: user?.email,
        activeAdvisorEmails: wsEngagements.map((e) => e.advisorEmail),
        pricePerUserCents: config.pricePerUserCents,
      });
      const resolved = resolveFeatures(featOverrides, effectiveLocked);
      companies.push({
        userId,
        ownerEmail: user?.email ?? 'unknown',
        ownerName: user?.name ?? 'Owner',
        wsId: w.id,
        name: w.name,
        industry: w.industry,
        country: w.country ?? 'United States',
        currency: w.currency ?? 'USD',
        seats: sub.seats,
        monthlyCents: billingRec?.comped ? 0 : sub.monthlyCents,
        comped: !!billingRec?.comped,
        subscriptionStatus: billingRec?.comped ? 'comped' : (billingRec?.status ?? 'none'),
        activeAdvisors: wsEngagements.length,
        features: resolved.flags,
      });
    }
  }

  const analytics = summarizePlatformRevenue({
    workspaces: companies.map((c) => ({ seats: c.seats, comped: c.comped })),
    pricePerUserCents: config.pricePerUserCents,
    engagements,
  });

  const breakdowns = buildPlatformAnalyticsBreakdowns({
    companies,
    advisors,
    engagements,
    featureCatalog: FEATURES,
  });

  const collectionsSummary: AdminCollectionsSummary = summarizeAdminCollections(collections);

  return {
    config,
    featureCatalog: FEATURES,
    envLockedFeatures: envOff,
    companies,
    advisors,
    bookings: bookings.slice(0, 50),
    proposals: proposals.slice(0, 50),
    engagements: engagements.slice(0, 100),
    collections: collections.slice(0, 150),
    collectionsSummary,
    analytics,
    breakdowns,
  };
}

// ── Company Team Invites Sent to an Advisor ─────────────────────────────────────────────────────────────────────────

export async function listTeamInvitesForAdvisor(
  advisorUserId: string,
  advisorEmail: string,
): Promise<AdvisorCompanyInvite[]> {
  const email = (advisorEmail ?? '').trim().toLowerCase();
  if (!email) return [];

  const [inviteKeys, engagements, advisorProfile] = await Promise.all([
    listBorgaKeys('u::%::ws::%::invites').catch(() => [] as string[]),
    loadEngagements(),
    getAdvisorByUserId(advisorUserId).catch(() => null),
  ]);

  const out: AdvisorCompanyInvite[] = [];
  for (const key of inviteKeys) {
    const m = /^u::([^:]+)::ws::([^:]+)::invites$/.exec(key);
    if (!m) continue;
    const [, clientUserId, clientWs] = m;
    const invites = (await getBorgaState<TeamInvite[]>(key).catch(() => null)) ?? [];
    const matching = invites.filter((i) => i && typeof i.email === 'string' && i.email.trim().toLowerCase() === email);
    if (!matching.length) continue;

    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(clientUserId)).catch(() => null)) ?? [];
    const wsObj = workspaces.find((w) => w.id === clientWs);
    const companyName = wsObj?.name ?? clientWs;
    const industry = wsObj?.industry ?? 'General';
    const country = wsObj?.country ?? 'United States';

    for (const inv of matching) {
      const existingEng = engagements.find(
        (e) => e.clientUserId === clientUserId && e.clientWs === clientWs && (e.advisorUserId === advisorUserId || e.advisorEmail.toLowerCase() === email) && e.status === 'active',
      );
      out.push({
        inviteId: inv.id,
        clientUserId,
        clientWs,
        clientCompanyName: companyName,
        clientIndustry: industry,
        clientCountry: country,
        invitedBy: inv.invitedBy || 'Company Owner',
        email: inv.email,
        name: inv.name,
        role: inv.role || 'Advisor',
        department: inv.department || 'General',
        status: inv.status,
        invitedAt: inv.invitedAt,
        expiresAt: inv.expiresAt,
        acceptedAt: inv.acceptedAt,
        suggestedScopes: scopesForDepartmentOrRole(inv.department, inv.role, advisorProfile?.defaultScopes),
        engagementId: existingEng?.id,
      });
    }
  }

  return out.sort((a, b) => Date.parse(b.invitedAt || '') - Date.parse(a.invitedAt || ''));
}

export async function respondToCompanyTeamInvite(
  advisorUserId: string,
  input: {
    clientUserId: string;
    clientWs: string;
    inviteId: string;
    decision: 'accepted' | 'declined';
    scopes?: AdvisorModuleScope[];
  },
): Promise<{ invite: TeamInvite; engagement?: ServiceEngagement } | { error: string }> {
  const user = await getUserById(advisorUserId).catch(() => null);
  if (!user) return { error: 'User not found.' };
  const email = user.email.trim().toLowerCase();

  const invKey = userWsKey(input.clientUserId, input.clientWs, 'invites');
  const invites = (await getBorgaState<TeamInvite[]>(invKey).catch(() => null)) ?? [];
  const target = invites.find((i) => i.id === input.inviteId && i.email.trim().toLowerCase() === email);
  if (!target) return { error: 'Team invite not found for your email address.' };
  if (target.status === 'revoked' || target.status === 'expired') {
    return { error: `This invite is already ${target.status}.` };
  }

  const now = new Date().toISOString();
  const nextStatus = input.decision === 'accepted' ? 'accepted' : 'revoked';
  const updatedInvite: TeamInvite = {
    ...target,
    status: nextStatus,
    ...(input.decision === 'accepted' ? { acceptedAt: now } : {}),
  };

  await setBorgaState(
    invKey,
    invites.map((i) => (i.id === target.id ? updatedInvite : i)),
  );

  if (input.decision === 'declined') {
    return { invite: updatedInvite };
  }

  // Ensure the advisor has a profile so they can act in the Shared Services Portal
  let advisor = await getAdvisorByUserId(advisorUserId);
  if (!advisor) {
    advisor = await upsertAdvisorProfile(advisorUserId, user.email, {
      name: user.name,
      headline: `${target.role || 'Advisor'} (${target.department || 'Advisory'})`,
      autoApproveIfOperator: true,
    });
  }

  const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(input.clientUserId)).catch(() => null)) ?? [];
  const wsObj = workspaces.find((w) => w.id === input.clientWs);
  const companyName = wsObj?.name ?? input.clientWs;

  const grantedScopes = input.scopes && input.scopes.length
    ? normalizeScopes(input.scopes)
    : scopesForDepartmentOrRole(target.department, target.role, advisor.defaultScopes);

  const engagements = await loadEngagements();
  const existing = engagements.find(
    (e) => e.clientUserId === input.clientUserId && e.clientWs === input.clientWs && e.advisorUserId === advisorUserId,
  );

  let engagement: ServiceEngagement;
  if (existing) {
    engagement = {
      ...existing,
      status: 'active',
      grantedScopes: [...new Set([...existing.grantedScopes, ...grantedScopes])],
      updatedAt: now,
    };
    await saveEngagements(engagements.map((e) => (e.id === existing.id ? engagement : e)));
  } else {
    const adminCfg = await loadAdminConfig();
    engagement = {
      id: uid('eng'),
      advisorId: advisor.id,
      advisorUserId: advisor.userId,
      advisorName: advisor.agencyName || advisor.name,
      advisorEmail: user.email.toLowerCase(),
      clientUserId: input.clientUserId,
      clientWs: input.clientWs,
      clientCompanyName: companyName,
      source: 'proposal',
      sourceId: target.id,
      title: `${target.role || 'Advisor'} (${target.department || 'Team Invite'})`,
      category: advisor.categories[0] ?? 'accounting',
      grantedScopes,
      status: 'active',
      billingCycle: 'monthly',
      grossCents: 0,
      platformFeePct: adminCfg.platformFeePct,
      platformFeeCents: 0,
      advisorNetCents: 0,
      paidTotalCents: 0,
      platformFeeTotalCents: 0,
      advisorNetTotalCents: 0,
      invoices: [],
      workLog: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveEngagements([engagement, ...engagements]);
  }

  await addNotice({
    id: uid('n-inv'),
    title: `${advisor.agencyName || advisor.name} accepted your team invite`,
    body: `They now have access to: ${engagement.grantedScopes.join(', ')}. Manage their shared tabs anytime under Shared Services.`,
    severity: 'info',
    source: 'scheduler',
    createdAt: now,
    readAt: null,
  }, input.clientWs, input.clientUserId).catch(() => undefined);

  return { invite: updatedInvite, engagement };
}
