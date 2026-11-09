import { NextResponse, type NextRequest } from 'next/server';
import { operatorFromRequest } from '@/lib/auth/operator';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { setComped } from '@/lib/borga/billing-server';
import {
  createAdminPaymentCollection,
  loadAdminOverview,
  markAdminCollectionPaid,
  markAdvisorPayoutDisbursed,
  saveAdminConfig,
  setWorkspaceFeatureByAdmin,
  toggleGlobalFeature,
  vetAdvisorProfile,
} from '@/lib/borga/shared-services-server';
import {
  normalizePaymentRailsConfig,
  type AdminCollectionKind,
  type AdminCollectionStatus,
  type AdminPaymentRail,
  type AdminPaymentRailsConfig,
  type AdvisorStatus,
} from '@/lib/borga/shared-services';

export const runtime = 'nodejs';

const forbidden = () =>
  NextResponse.json({ ok: false, error: 'Only a deployment administrator can access the Admin Portal.' }, { status: 403 });

export async function GET(req: NextRequest) {
  const op = await operatorFromRequest(req);
  if (!op) return forbidden();
  const overview = await loadAdminOverview();
  return NextResponse.json({ ok: true, operator: op, ...overview });
}

export async function POST(req: NextRequest) {
  const op = await operatorFromRequest(req);
  if (!op) return forbidden();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') {
    return NextResponse.json({ ok: false, error: 'action is required.' }, { status: 400 });
  }

  switch (body.action) {
    case 'saveConfig': {
      const config = await saveAdminConfig({
        platformName: typeof body.platformName === 'string' ? body.platformName : undefined,
        supportEmail: typeof body.supportEmail === 'string' ? body.supportEmail : undefined,
        defaultCurrency: typeof body.defaultCurrency === 'string' ? body.defaultCurrency : undefined,
        defaultTimezone: typeof body.defaultTimezone === 'string' ? body.defaultTimezone : undefined,
        pricePerUserCents: typeof body.pricePerUserCents === 'number' ? body.pricePerUserCents : undefined,
        platformFeePct: typeof body.platformFeePct === 'number' ? body.platformFeePct : undefined,
        trialDays: typeof body.trialDays === 'number' ? body.trialDays : undefined,
        maxWorkspacesPerUser: typeof body.maxWorkspacesPerUser === 'number' ? body.maxWorkspacesPerUser : undefined,
        autoApproveAdvisors: typeof body.autoApproveAdvisors === 'boolean' ? body.autoApproveAdvisors : undefined,
        allowUpfrontPackages: typeof body.allowUpfrontPackages === 'boolean' ? body.allowUpfrontPackages : undefined,
        minAdvisorRateCents: typeof body.minAdvisorRateCents === 'number' ? body.minAdvisorRateCents : undefined,
        defaultDailyAiRunCap: typeof body.defaultDailyAiRunCap === 'number' ? body.defaultDailyAiRunCap : undefined,
        requireHumanApprovalForPayments:
          typeof body.requireHumanApprovalForPayments === 'boolean' ? body.requireHumanApprovalForPayments : undefined,
        signupModeOverride: body.signupModeOverride as 'default' | 'open' | 'invite' | 'closed' | undefined,
        billingModeOverride: body.billingModeOverride as 'default' | 'off' | 'enforce' | undefined,
        maintenanceBanner: typeof body.maintenanceBanner === 'string' ? body.maintenanceBanner : undefined,
        paymentRails:
          body.paymentRails && typeof body.paymentRails === 'object'
            ? normalizePaymentRailsConfig(body.paymentRails as Partial<AdminPaymentRailsConfig>)
            : undefined,
      });
      return NextResponse.json({ ok: true, config });
    }

    case 'createCollection': {
      const result = await createAdminPaymentCollection({
        kind: (body.kind as AdminCollectionKind) ?? 'subscription',
        targetUserId: String(body.targetUserId ?? ''),
        targetWs: String(body.targetWs ?? ''),
        companyName: String(body.companyName ?? ''),
        contactEmail: String(body.contactEmail ?? ''),
        engagementId: typeof body.engagementId === 'string' ? body.engagementId : undefined,
        advisorId: typeof body.advisorId === 'string' ? body.advisorId : undefined,
        advisorName: typeof body.advisorName === 'string' ? body.advisorName : undefined,
        description: typeof body.description === 'string' ? body.description : undefined,
        grossCents: Number(body.grossCents ?? 0),
        currency: typeof body.currency === 'string' ? body.currency : undefined,
        rail: body.rail as AdminPaymentRail | undefined,
        status: body.status as AdminCollectionStatus | undefined,
        reference: typeof body.reference === 'string' ? body.reference : undefined,
      });
      if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, collection: result });
    }

    case 'markCollectionPaid': {
      const collectionId = String(body.collectionId ?? '');
      if (!collectionId) return NextResponse.json({ ok: false, error: 'collectionId is required.' }, { status: 400 });
      const result = await markAdminCollectionPaid(collectionId, {
        rail: body.rail as AdminPaymentRail | undefined,
        reference: typeof body.reference === 'string' ? body.reference : undefined,
      });
      if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
      return NextResponse.json({ ok: true, collection: result });
    }

    case 'markPayoutDisbursed': {
      const collectionId = String(body.collectionId ?? '');
      if (!collectionId) return NextResponse.json({ ok: false, error: 'collectionId is required.' }, { status: 400 });
      const result = await markAdvisorPayoutDisbursed(collectionId, {
        reference: typeof body.reference === 'string' ? body.reference : undefined,
      });
      if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, collection: result });
    }

    case 'toggleGlobalFeature': {
      const featureId = String(body.featureId ?? '');
      const enabled = body.enabled === true;
      const config = await toggleGlobalFeature(featureId, enabled);
      if (!config) return NextResponse.json({ ok: false, error: 'Unknown feature id.' }, { status: 400 });
      return NextResponse.json({ ok: true, config });
    }

    case 'toggleWorkspaceFeature': {
      const userId = String(body.userId ?? '');
      const ws = String(body.ws ?? '');
      const featureId = String(body.featureId ?? '');
      const enabled = body.enabled === true;
      const ok = await setWorkspaceFeatureByAdmin(userId, ws, featureId, enabled);
      if (!ok) return NextResponse.json({ ok: false, error: 'Invalid userId, ws or featureId.' }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case 'setComped': {
      const userId = String(body.userId ?? '');
      const ws = String(body.ws ?? '');
      const comped = body.comped === true;
      if (!isValidUserId(userId) || !isValidWsId(ws)) {
        return NextResponse.json({ ok: false, error: 'Valid userId and ws are required.' }, { status: 400 });
      }
      await setComped(userId, ws, comped);
      return NextResponse.json({ ok: true });
    }

    case 'vetAdvisor': {
      const advisorId = String(body.advisorId ?? '');
      const status = String(body.status ?? '') as AdvisorStatus;
      if (!advisorId || !['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
        return NextResponse.json({ ok: false, error: 'advisorId and valid status are required.' }, { status: 400 });
      }
      const advisor = await vetAdvisorProfile(advisorId, status);
      if (!advisor) return NextResponse.json({ ok: false, error: 'Advisor not found.' }, { status: 404 });
      return NextResponse.json({ ok: true, advisor });
    }

    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
