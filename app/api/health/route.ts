import { NextResponse } from 'next/server';
import { healthCheck } from '@/lib/borga/persistence';

export const runtime = 'nodejs';

export async function GET() {
  let dbOk = false;
  let dbLatency = -1;
  try {
    const start = Date.now();
    // Runs a real `SELECT — LIMIT 1` so connectivity is not confused with a
    // missing sentinel row.
    dbOk = await healthCheck();
    dbLatency = Date.now() - start;
  } catch {
    dbOk = false;
  }

  return NextResponse.json(
    {
      success: true,
      data: {
        status: 'ok',
        uptime: process.uptime(),
        db: dbOk ? 'connected' : 'unavailable',
        dbLatencyMs: dbLatency,
        timestamp: new Date().toISOString(),
      },
    },
    {
      status: 200,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
