import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import { getUserById } from '@/lib/auth/queries';
import { isOperator } from '@/lib/auth/signup-policy';
import {
  ADVISOR_MODULE_SCOPES,
  ADVISOR_SCOPE_LABELS,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  isAdvisorScope,
  isServiceCategory,
  normalizeScopes,
  type AdvisorModuleScope,
  type AvailabilitySlot,
  type EngagementStatus,
  type ServiceCategory,
  type ServicePackage,
} from '@/lib/borga/shared-services';
import {
  advisorReadClientWorkspace,
  advisorWriteClientEntity,
  billEngagementMilestone,
  bookAdvisorCall,
  createServiceProposal,
  getAdvisorByUserId,
  listAdvisors,
  listTeamInvitesForAdvisor,
  loadAdminConfig,
  loadBookings,
  loadEngagements,
  loadProposals,
  logAdvisorWorkEntry,
  purchaseServicePackage,
  respondToCompanyTeamInvite,
  respondToProposal,
  updateBookingStatus,
  updateEngagementAccess,
  upsertAdvisorProfile,
} from '@/lib/borga/shared-services-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const engagementId = url.searchParams.get('engagementId');
  const categoryParam = url.searchParams.get('category');

  // If an advisor is loading a client workspace they have active module-scoped access to:
  if (engagementId) {
    const view = await advisorReadClientWorkspace(userId, engagementId);
    if ('error' in view) {
      return NextResponse.json({ ok: false, error: view.error }, { status: view.status });
    }
    return NextResponse.json({ ok: true, ...view });
  }

  let validWs: string | null = null;
  if (wsParam) {
    if (!isValidWsId(wsParam) || !(await ownsWorkspace(userId, wsParam))) {
      return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
    }
    const gate = await featureGate('sharedServices', userId, wsParam);
    if (gate) return gate;
    validWs = wsParam;
  }

  const [user, config, myAdvisorProfile, advisors, bookings, proposals, engagements] = await Promise.all([
    getUserById(userId).catch(() => null),
    loadAdminConfig(),
    getAdvisorByUserId(userId),
    listAdvisors({
      onlyApproved: true,
      category: categoryParam && isServiceCategory(categoryParam) ? categoryParam : undefined,
    }),
    loadBookings(),
    loadProposals(),
    loadEngagements(),
  ]);

  const myClientBookings = validWs
    ? bookings.filter((b) => b.clientUserId === userId && b.clientWs === validWs)
    : [];
  const myClientProposals = validWs
    ? proposals.filter((p) => p.clientUserId === userId && p.clientWs === validWs)
    : [];
  const myClientEngagements = validWs
    ? engagements.filter((e) => e.clientUserId === userId && e.clientWs === validWs)
    : [];

  const myAdvisorBookings = bookings.filter((b) => b.advisorUserId === userId);
  const myAdvisorProposals = proposals.filter((p) => p.advisorUserId === userId);
  const myAdvisorEngagements = engagements.filter((e) => e.advisorUserId === userId);
  const myAdvisorTeamInvites = user?.email ? await listTeamInvitesForAdvisor(userId, user.email) : [];

  return NextResponse.json({
    ok: true,
    user: user ? { id: user.id, name: user.name, email: user.email, isOperator: isOperator(user.email, process.env) } : null,
    config: {
      pricePerUserCents: config.pricePerUserCents,
      platformFeePct: config.platformFeePct,
      maintenanceBanner: config.maintenanceBanner,
    },
    catalog: {
      categories: SERVICE_CATEGORIES.map((id) => ({ id, label: SERVICE_CATEGORY_LABELS[id] })),
      scopes: ADVISOR_MODULE_SCOPES.map((id) => ({ id, ...ADVISOR_SCOPE_LABELS[id] })),
    },
    myAdvisorProfile,
    advisors,
    client: {
      ws: validWs,
      bookings: myClientBookings,
      proposals: myClientProposals,
      engagements: myClientEngagements,
    },
    advisor: {
      bookings: myAdvisorBookings,
      proposals: myAdvisorProposals,
      engagements: myAdvisorEngagements,
      teamInvites: myAdvisorTeamInvites,
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ ok: false, error: 'action is required.' }, { status: 400 });
  }

  switch (body.action) {
    case 'saveAdvisorProfile': {
      const user = await getUserById(userId).catch(() => null);
      if (!user) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 });
      const name = String(body.name ?? user.name ?? '').trim();
      if (!name) return NextResponse.json({ ok: false, error: 'Advisor name is required.' }, { status: 400 });
      const profile = await upsertAdvisorProfile(userId, user.email, {
        name,
        agencyName: typeof body.agencyName === 'string' ? body.agencyName : undefined,
        headline: typeof body.headline === 'string' ? body.headline : undefined,
        bio: typeof body.bio === 'string' ? body.bio : undefined,
        categories: body.categories,
        defaultScopes: body.defaultScopes,
        hourlyRateCents: typeof body.hourlyRateCents === 'number' ? body.hourlyRateCents : undefined,
        currency: typeof body.currency === 'string' ? body.currency : undefined,
        availabilitySlots: Array.isArray(body.availabilitySlots) ? (body.availabilitySlots as AvailabilitySlot[]) : undefined,
        packages: Array.isArray(body.packages) ? (body.packages as ServicePackage[]) : undefined,
        calComUrl: typeof body.calComUrl === 'string' ? body.calComUrl : undefined,
        calComEventTypeId: typeof body.calComEventTypeId === 'number' ? body.calComEventTypeId : undefined,
        autoApproveIfOperator: body.autoApproveIfOperator !== false,
      });
      return NextResponse.json({ ok: true, profile });
    }

    case 'bookCall': {
      const ws = String(body.ws ?? '');
      if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
        return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
      }
      const gate = await featureGate('sharedServices', userId, ws);
      if (gate) return gate;
      const advisorId = String(body.advisorId ?? '');
      const scheduledAt = String(body.scheduledAt ?? '');
      const topic = String(body.topic ?? '');
      if (!advisorId || !scheduledAt || !topic.trim()) {
        return NextResponse.json({ ok: false, error: 'advisorId, scheduledAt and topic are required.' }, { status: 400 });
      }
      const res = await bookAdvisorCall(userId, ws, {
        advisorId,
        category: isServiceCategory(body.category) ? body.category : undefined,
        scheduledAt,
        durationMin: typeof body.durationMin === 'number' ? body.durationMin : undefined,
        topic,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        packageId: typeof body.packageId === 'string' ? body.packageId : undefined,
      });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, booking: res });
    }

    case 'updateBookingStatus': {
      const bookingId = String(body.bookingId ?? '');
      const status = String(body.status ?? '') as 'scheduled' | 'completed' | 'canceled';
      if (!bookingId || !['scheduled', 'completed', 'canceled'].includes(status)) {
        return NextResponse.json({ ok: false, error: 'bookingId and valid status are required.' }, { status: 400 });
      }
      const updated = await updateBookingStatus(userId, bookingId, status);
      if (!updated) return NextResponse.json({ ok: false, error: 'Booking not found or access denied.' }, { status: 404 });
      return NextResponse.json({ ok: true, booking: updated });
    }

    case 'createProposal': {
      const clientUserId = String(body.clientUserId ?? '');
      const clientWs = String(body.clientWs ?? '');
      const title = String(body.title ?? '');
      const category = isServiceCategory(body.category) ? body.category : ('accounting' as ServiceCategory);
      const billingCycle = body.billingCycle === 'one_time' ? 'one_time' : 'monthly';
      const grossCents = Number(body.grossCents ?? 0);
      if (!isValidUserId(clientUserId) || !isValidWsId(clientWs) || !title.trim() || !(grossCents > 0)) {
        return NextResponse.json({ ok: false, error: 'clientUserId, clientWs, title and positive grossCents are required.' }, { status: 400 });
      }
      const res = await createServiceProposal(userId, {
        bookingId: typeof body.bookingId === 'string' ? body.bookingId : undefined,
        clientUserId,
        clientWs,
        title,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        category,
        requestedScopes: normalizeScopes(body.requestedScopes),
        billingCycle,
        grossCents,
        deliverables: Array.isArray(body.deliverables) ? body.deliverables.map(String) : undefined,
      });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, proposal: res });
    }

    case 'respondProposal': {
      const ws = String(body.ws ?? '');
      if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
        return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
      }
      const proposalId = String(body.proposalId ?? '');
      const decision = body.decision === 'accepted' ? 'accepted' : body.decision === 'declined' ? 'declined' : null;
      if (!proposalId || !decision) {
        return NextResponse.json({ ok: false, error: 'proposalId and decision (accepted | declined) are required.' }, { status: 400 });
      }
      const overrideScopes = Array.isArray(body.grantedScopes) ? normalizeScopes(body.grantedScopes) : undefined;
      const res = await respondToProposal(userId, ws, proposalId, decision, overrideScopes);
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, ...res });
    }

    case 'purchasePackage': {
      const ws = String(body.ws ?? '');
      if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
        return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
      }
      const gate = await featureGate('sharedServices', userId, ws);
      if (gate) return gate;
      const advisorId = String(body.advisorId ?? '');
      const packageId = String(body.packageId ?? '');
      if (!advisorId || !packageId) {
        return NextResponse.json({ ok: false, error: 'advisorId and packageId are required.' }, { status: 400 });
      }
      const res = await purchaseServicePackage(userId, ws, {
        advisorId,
        packageId,
        kickoffAt: typeof body.kickoffAt === 'string' && body.kickoffAt.trim() ? body.kickoffAt.trim() : undefined,
        grantedScopes: Array.isArray(body.grantedScopes) ? normalizeScopes(body.grantedScopes) : undefined,
      });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, ...res });
    }

    case 'updateEngagementAccess': {
      const ws = String(body.ws ?? '');
      if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
        return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
      }
      const engagementId = String(body.engagementId ?? '');
      const status = typeof body.status === 'string' && ['active', 'paused', 'completed', 'revoked'].includes(body.status)
        ? (body.status as EngagementStatus)
        : undefined;
      const grantedScopes = Array.isArray(body.grantedScopes) ? normalizeScopes(body.grantedScopes) : undefined;
      const res = await updateEngagementAccess(userId, ws, engagementId, { status, grantedScopes });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 404 });
      return NextResponse.json({ ok: true, engagement: res });
    }

    case 'billMilestone': {
      const engagementId = String(body.engagementId ?? '');
      const description = String(body.description ?? '');
      const grossCents = Number(body.grossCents ?? 0);
      if (!engagementId || !description.trim() || !(grossCents > 0)) {
        return NextResponse.json({ ok: false, error: 'engagementId, description and positive grossCents are required.' }, { status: 400 });
      }
      const res = await billEngagementMilestone(userId, engagementId, { description, grossCents });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, engagement: res });
    }

    case 'advisorWriteEntity': {
      const engagementId = String(body.engagementId ?? '');
      const entity = String(body.entity ?? '');
      if (!engagementId || !entity) {
        return NextResponse.json({ ok: false, error: 'engagementId and entity are required.' }, { status: 400 });
      }
      const res = await advisorWriteClientEntity(userId, engagementId, {
        entity,
        value: body.value,
        scope: isAdvisorScope(body.scope) ? (body.scope as AdvisorModuleScope) : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
      });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
      return NextResponse.json({ ok: true, ...res });
    }

    case 'logAdvisorWork': {
      const engagementId = String(body.engagementId ?? '');
      const scope = String(body.scope ?? '');
      const summary = String(body.summary ?? '');
      if (!engagementId || !isAdvisorScope(scope) || !summary.trim()) {
        return NextResponse.json({ ok: false, error: 'engagementId, valid scope and summary are required.' }, { status: 400 });
      }
      const res = await logAdvisorWorkEntry(userId, engagementId, { scope, summary });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, engagement: res });
    }

    case 'respondTeamInvite': {
      const clientUserId = String(body.clientUserId ?? '');
      const clientWs = String(body.clientWs ?? '');
      const inviteId = String(body.inviteId ?? '');
      const decision = body.decision === 'accepted' ? 'accepted' : body.decision === 'declined' ? 'declined' : null;
      if (!isValidUserId(clientUserId) || !isValidWsId(clientWs) || !inviteId || !decision) {
        return NextResponse.json({ ok: false, error: 'clientUserId, clientWs, inviteId and decision (accepted | declined) are required.' }, { status: 400 });
      }
      const scopes = Array.isArray(body.scopes) ? normalizeScopes(body.scopes) : undefined;
      const res = await respondToCompanyTeamInvite(userId, { clientUserId, clientWs, inviteId, decision, scopes });
      if ('error' in res) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      return NextResponse.json({ ok: true, ...res });
    }

    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
