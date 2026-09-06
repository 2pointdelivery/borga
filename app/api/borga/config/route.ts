import { NextResponse } from 'next/server';
import { listKeyStatuses, setApiKey, deleteApiKey, isAllowedKey } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

export async function GET() {
  const statuses = await listKeyStatuses();
  return NextResponse.json({ keys: statuses });
}

export async function POST(req: Request) {
  let body: { action?: string; envVar?: string; value?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { action, envVar, value } = body;

  if (!envVar || !isAllowedKey(envVar)) {
    return NextResponse.json({ ok: false, error: 'envVar is not in the configurable allowlist.' }, { status: 400 });
  }

  try {
    if (action === 'set') {
      if (!value?.trim()) {
        return NextResponse.json({ ok: false, error: 'value is required for set action.' }, { status: 400 });
      }
      const ok = await setApiKey(envVar, value.trim());
      return NextResponse.json({ ok });
    }

    if (action === 'delete') {
      const ok = await deleteApiKey(envVar);
      return NextResponse.json({ ok });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('Config API error:', err);
    return NextResponse.json({ ok: false, error: err.message ?? 'An error occurred while saving the configuration.' }, { status: 500 });
  }
}
