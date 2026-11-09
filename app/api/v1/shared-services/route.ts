import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { loadBookings, loadEngagements, loadProposals } from '@/lib/borga/shared-services-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('sharedServices', g.auth.userId, g.ws);
  if (gate) return gate;

  const [engagements, proposals, bookings] = await Promise.all([
    loadEngagements(),
    loadProposals(),
    loadBookings(),
  ]);

  const wsEngagements = engagements
    .filter((e) => e.clientUserId === g.auth.userId && e.clientWs === g.ws)
    .slice(0, 100)
    .map((e) => ({
      id: e.id,
      title: e.title,
      advisorName: e.advisorName,
      category: e.category,
      grantedScopes: e.grantedScopes,
      status: e.status,
      billingCycle: e.billingCycle,
      paidTotalCents: e.paidTotalCents,
      platformFeeTotalCents: e.platformFeeTotalCents,
      advisorNetTotalCents: e.advisorNetTotalCents,
    }));

  const wsProposals = proposals
    .filter((p) => p.clientUserId === g.auth.userId && p.clientWs === g.ws)
    .slice(0, 100)
    .map((p) => ({
      id: p.id,
      title: p.title,
      advisorName: p.advisorName,
      category: p.category,
      grossCents: p.grossCents,
      status: p.status,
    }));

  const wsBookings = bookings
    .filter((b) => b.clientUserId === g.auth.userId && b.clientWs === g.ws)
    .slice(0, 100)
    .map((b) => ({
      id: b.id,
      advisorName: b.advisorName,
      scheduledAt: b.scheduledAt,
      topic: b.topic,
      status: b.status,
    }));

  return NextResponse.json({
    ok: true,
    engagements: wsEngagements,
    proposals: wsProposals,
    bookings: wsBookings,
  });
}
