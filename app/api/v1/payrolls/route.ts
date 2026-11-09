import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { PayrollRun } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('payroll', g.auth.userId, g.ws);
  if (gate) return gate;
  const runs = (await getBorgaState<PayrollRun[]>(userWsKey(g.auth.userId, g.ws, 'payrollRuns'))) ?? [];
  return NextResponse.json({
    ok: true,
    payrolls: runs.slice(0, 100).map((r: PayrollRun & { gross?: number; employerCost?: number }) => ({
      id: r.id, period: (r as { monthKey?: string }).monthKey ?? r.id,
      gross: r.gross ?? 0, employerCost: r.employerCost ?? 0, status: r.status,
    })),
  });
}
