import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { getSyncStates, listSyncJobs, runSyncJob } from '@/lib/borga/sync-jobs';
import '@/lib/borga/sync-registry';

export const runtime = 'nodejs';

/** GET: status of every registered sync job. POST {jobId}: run one now. */
export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  return NextResponse.json({ ok: true, jobs: await getSyncStates(userId, ws) });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  const job = listSyncJobs().find((j) => j.id === jobId);
  if (!job) return NextResponse.json({ ok: false, error: 'Unknown job' }, { status: 404 });
  return NextResponse.json({ ok: true, ...(await runSyncJob(userId, ws, job, true)) });
}
