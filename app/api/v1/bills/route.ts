import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Bill, BillLine } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const bills = (await getBorgaState<Bill[]>(userWsKey(auth.userId, ws, 'bills'))) ?? [];
  const status = new URL(req.url).searchParams.get('status');
  const rows = (status ? bills.filter((b) => b.status === status) : bills).slice(0, 100).map((b) => ({
    id: b.id, vendor: b.vendorName ?? b.vendorId, number: b.number,
    amount: b.amount, status: b.status, due: b.due,
  }));
  return NextResponse.json({ ok: true, bills: rows });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const body = (await req.json().catch(() => null)) as {
    vendorId?: string; vendorName?: string; lines?: Array<{ description?: string; label?: string; qty?: number; unitPrice?: number; amount?: number }>; due?: string;
  } | null;
  if (!body?.vendorId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'vendorId and at least one line are required.' }, { status: 400 });
  }
  const lines: BillLine[] = body.lines.map((l, i) => ({
    id: `bl-${i}`,
    description: l.description ?? l.label ?? `Line ${i + 1}`,
    qty: l.qty ?? 1,
    unitPrice: l.unitPrice ?? l.amount ?? 0,
  }));
  const amount = lines.reduce((t, l) => t + l.qty * l.unitPrice, 0);
  const bills = (await getBorgaState<Bill[]>(userWsKey(auth.userId, ws, 'bills'))) ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const bill: Bill = {
    id: `b-${Date.now().toString(36)}`, vendorId: body.vendorId, vendorName: body.vendorName ?? body.vendorId,
    number: `BILL-${bills.length + 1}`, amount, received: today,
    due: body.due ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    status: 'unpaid', lines,
  };
  await setBorgaState(userWsKey(auth.userId, ws, 'bills'), [bill, ...bills]);
  return NextResponse.json({ ok: true, bill: { id: bill.id, amount } }, { status: 201 });
}
