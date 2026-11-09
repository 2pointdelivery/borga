import { NextResponse, type NextRequest } from 'next/server';
import { autopilotStatus, runAutopilotTick, setWorkspaceAutopilotPaused } from '@/lib/borga/autopilot';
import { loadSettings } from '@/lib/borga/heartbeat-settings';
import { loadFeatures } from '@/lib/borga/features-server';
import { requireSession, requireWorkspace } from '@/lib/borga/request-guard';

export const runtime = 'nodejs';

/**
 * Autopilot status and workspace pause/resume. The loop itself lives in the
 * server process (lib/borga/autopilot.ts); this route only reports it and
 * flips the same durable switches Settings uses, behind the standard
 * session + ownership guard.
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const guard = await requireSession(req);
  if (!guard.ok) return guard.res;
  const ws = url.searchParams.get('ws');

  if (!ws) return NextResponse.json({ ok: true, autopilot: autopilotStatus() });

  const scoped = await requireWorkspace(req, ws);
  if (!scoped.ok) return scoped.res;
  const [settings, flags] = await Promise.all([
    loadSettings(scoped.ws, guard.userId),
    loadFeatures(guard.userId, scoped.ws),
  ]);
  return NextResponse.json({
    ok: true,
    autopilot: autopilotStatus(),
    workspace: {
      paused: settings?.heartbeatPaused === true,
      autonomousMode: settings?.autonomousMode !== false || settings?.autonomousModeChosen !== true,
      quietHours: settings?.quietHours ?? null,
      heartbeatFeature: flags.flags.heartbeat,
    },
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireSession(req, { csrf: true });
  if (!guard.ok) return guard.res;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const scoped = await requireWorkspace(req, body.ws, { csrf: true });
  if (!scoped.ok) return scoped.res;

  if (body.action === 'tick') {
    return NextResponse.json({ ok: true, tick: await runAutopilotTick() });
  }

  if (body.action === 'pause' || body.action === 'resume') {
    const paused = body.action === 'pause';
    const saved = await setWorkspaceAutopilotPaused(guard.userId, scoped.ws, paused);
    if (!saved) return NextResponse.json({ ok: false, error: 'Could not save the autopilot switch.' }, { status: 500 });
    return NextResponse.json({ ok: true, paused });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${String(body.action)}` }, { status: 400 });
}
