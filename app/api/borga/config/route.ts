import { NextResponse, type NextRequest } from 'next/server';
import { operatorFromRequest } from '@/lib/auth/operator';
import { sessionUserId } from '@/lib/borga/features-server';
import { listKeyStatuses, setApiKey, deleteApiKey, isAllowedKey } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

/**
 * These are deployment-wide keys shared by every company on this server, so only a deployment
 * operator (BORGA_OPERATOR_EMAILS) may change them. Everyone else can see whether a provider is
 * configured, but not the masked value or where it comes from.
 */
export async function GET(req: NextRequest) {
  if (!(await sessionUserId(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const operator = !!(await operatorFromRequest(req));
  const statuses = await listKeyStatuses();
  return NextResponse.json({
    operator,
    keys: operator ? statuses : statuses.map((k) => ({ ...k, masked: null })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await operatorFromRequest(req))) {
    return NextResponse.json({ ok: false, error: 'Shared API keys can only be changed by the deployment administrator.' }, { status: 403 });
  }
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
