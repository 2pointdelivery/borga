import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { getConfiguredLlm } from '@/lib/borga/agent-context';
import { fallbackStatus } from '@/lib/borga/llm-fallback';

export const runtime = 'nodejs';

/** GET ?ws= -> the company's fallback chain: the model in use, the other activated models, and which are cooling down. */
export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  const primary = await getConfiguredLlm(ws, userId).catch(() => null);
  return NextResponse.json({ ok: true, ...(await fallbackStatus({ ws, userId }, primary)) });
}
