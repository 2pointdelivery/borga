import { NextResponse, type NextRequest } from 'next/server';
import { getConnection } from '@/lib/borga/connections-server';
import { guardEngineUrl } from '@/lib/borga/engine-http';
import { requireWorkspace, tooManyRequests } from '@/lib/borga/request-guard';
import { paymentRequired } from '@/lib/borga/billing-server';
import { takeRouteLimit } from '@/lib/borga/route-limits';
import { enqueueRun, getJob } from '@/lib/borga/run-queue';
import { isTerminal } from '@/lib/borga/run-queue-core';
import { workflowDispatch } from '@/lib/borga/workflow-dispatch';
import { getApiKey } from '@/lib/borga/secrets';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { SettingsState } from '@/lib/borga/data';

export const runtime = 'nodejs';

// Per-tenant engine resolution: each company workspace configures its own
// engine endpoint + key in workspace settings; env vars are the global fallback.
const DEFAULT_ENGINE_URL = (process.env.BORGA_ENGINE_URL ?? '').replace(/\/$/, '');
const ENGINE_TIMEOUT = 30000; // 30 seconds for engine operations
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Per-company engine resolution: the company's saved Company Engine connection first, then its legacy
 * workspace settings, then deployment-wide env.
 */
async function resolveEngine(wsId: string | null, userId: string | null): Promise<{ engineUrl: string; token: string | null }> {
  let engineUrl = DEFAULT_ENGINE_URL;
  let token = (await getApiKey('COMPANY_ENGINE_API_KEY')) || process.env.BORGA_ADMIN_TOKEN || (await getApiKey('BORGA_ADMIN_TOKEN')) || '';
  if (wsId && userId) {
    const conn = await getConnection(userId, wsId, 'company_engine');
    if (conn?.baseUrl) {
      engineUrl = conn.baseUrl.replace(/\/$/, '');
      if (conn.apiKey) token = conn.apiKey;
    } else {
      const settings = await getBorgaState<SettingsState>(userWsKey(userId, wsId, 'settings'));
      if (settings?.crmUrl && /^https?:\/\//i.test(settings.crmUrl)) engineUrl = settings.crmUrl.replace(/\/$/, '');
      if (settings?.engineApiKey) token = settings.engineApiKey;
    }
  }
  // The URL is user-supplied and fetched from this server: refuse internal targets.
  if (engineUrl) {
    try {
      await guardEngineUrl(engineUrl);
    } catch {
      engineUrl = '';
    }
  }
  return { engineUrl, token };
}

// Validate engine URL format
function isValidEngineUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// Retry logic for engine requests
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Engine ${operationName} attempt ${attempt}/${MAX_RETRIES} failed:`, error);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`Engine ${operationName} failed after ${MAX_RETRIES} attempts:`, lastError);
  throw lastError;
}

// Validate engine authentication
async function validateEngineAuth(engineUrl: string, adminToken: string | null): Promise<{ valid: boolean; error?: string }> {
  if (!adminToken) {
    return { valid: false, error: 'Engine authentication token not configured' };
  }

  try {
    const response = await fetch(`${engineUrl}/health`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { valid: false, error: `Engine health check failed: ${response.status}` };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Engine unreachable'
    };
  }
}

// Execute workflow on the real engine
async function executeWorkflow(
  engineUrl: string,
  adminToken: string | null,
  workflowName: string,
  agent: string,
  action: string
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!adminToken) {
    return { success: false, error: 'Engine authentication token not configured' };
  }

  try {
    const response = await retryWithBackoff(
      () => fetch(`${engineUrl}/orchestrations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          workflow: workflowName,
          agent,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(ENGINE_TIMEOUT),
      }),
      `execute workflow ${workflowName}`
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Engine workflow error:', response.status, errorText.slice(0, 200));

      try {
        const errorData = JSON.parse(errorText);
        return {
          success: false,
          error: errorData.error?.message || `Engine returned ${response.status}`
        };
      } catch {
        return { success: false, error: `Engine returned ${response.status}` };
      }
    }

    const data = await response.json() as Record<string, unknown>;
    return { success: true, data };
  } catch (error) {
    console.error('Engine execution error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Engine execution failed'
    };
  }
}

// Get workflow status from engine
async function getWorkflowStatus(engineUrl: string, adminToken: string | null, workflowId: string): Promise<{
  success: boolean;
  status?: string;
  progress?: number;
  error?: string
}> {
  if (!adminToken) {
    return { success: false, error: 'Engine authentication token not configured' };
  }

  try {
    const response = await fetch(`${engineUrl}/orchestrations/${encodeURIComponent(workflowId)}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, error: `Engine returned ${response.status}` };
    }

    const data = await response.json() as Record<string, unknown>;
    return {
      success: true,
      status: data.status as string,
      progress: data.progress as number,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get workflow status'
    };
  }
}

/**
 * Drives company orchestration. With a configured Company Engine the workflow
 * is proxied to it; without one the run is handed to the workspace's own AI
 * worker pool (run queue): the named workflow becomes a concrete goal for the
 * matching specialist agent, and the dashboard watches progress in Runs & Queue.
 * There is no fabricated local mode — every reported step is a real one.
 */
export async function POST(req: NextRequest) {
  let body: { action?: string; workflowName?: string; agent?: string; workflowId?: string; ws?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  // Session + a workspace the caller actually owns. The dashboard header is
  // also required: a cross-site post must not be able to spend LLM calls.
  const g = await requireWorkspace(req, body.ws, { csrf: true });
  if (!g.ok) return g.res;
  const { userId, ws } = g;

  const action = body.action ?? 'run';
  const workflowName = String(body.workflowName ?? 'unnamed workflow').slice(0, 100);
  const agent = String(body.agent ?? 'Borga').slice(0, 50);

  const unpaid = await paymentRequired(userId, ws);
  if (unpaid) return NextResponse.json({ ok: false, error: unpaid.error, billing: unpaid.billing }, { status: 402 });

  // Every workflow run spends real model calls (remote engine or the local
  // worker pool): cap how often one workspace can start them.
  const limit = takeRouteLimit('workflowRun', `${userId}:${ws}`);
  if (limit.limited) return tooManyRequests(limit.retryAfterSec, 'Too many workflow runs. Try again later.');

  const { engineUrl: ENGINE_URL, token: adminToken } = await resolveEngine(ws, userId);
  const remoteConfigured = isValidEngineUrl(ENGINE_URL);

  if (action === 'status') {
    // Remote passthrough, or the local queue job this run created.
    if (remoteConfigured && body.workflowId) {
      const validation = await validateEngineAuth(ENGINE_URL, adminToken);
      if (validation.valid) {
        const result = await getWorkflowStatus(ENGINE_URL, adminToken, body.workflowId);
        if (result.success) {
          return NextResponse.json({ ok: true, engine: ENGINE_URL, mode: 'remote', workflowId: body.workflowId, status: result.status, progress: result.progress });
        }
        return NextResponse.json({ ok: false, engine: ENGINE_URL, mode: 'error', workflowId: body.workflowId, error: result.error }, { status: 502 });
      }
    }
    const jobId = typeof body.workflowId === 'string' && body.workflowId.startsWith('job-') ? body.workflowId : null;
    if (jobId) {
      const job = await getJob(jobId, ws, userId);
      if (!job) return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 });
      return NextResponse.json({
        ok: true,
        mode: 'queue',
        jobId: job.id,
        status: job.status,
        agentName: job.agentName,
        steps: job.steps?.length ?? 0,
        summary: job.runId ? (job.error ?? undefined) : undefined,
        done: isTerminal(job),
      });
    }
    return NextResponse.json({ ok: false, error: 'workflowId is required for status' }, { status: 400 });
  }

  if (action !== 'run') {
    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  // Remote engine first, when one is configured and healthy.
  if (remoteConfigured) {
    const validation = await validateEngineAuth(ENGINE_URL, adminToken);
    if (validation.valid) {
      const result = await executeWorkflow(ENGINE_URL, adminToken, workflowName, agent, action);
      if (result.success) {
        return NextResponse.json({ ok: true, engine: ENGINE_URL, mode: 'remote', workflow: workflowName, agent, data: result.data });
      }
      console.warn('Remote engine failed; falling back to the run queue:', result.error);
    } else {
      console.warn('Remote engine unavailable; falling back to the run queue:', validation.error);
    }
  }

  // No (healthy) engine: hand the workflow to this workspace's AI workers.
  const dispatch = workflowDispatch(workflowName);
  const job = await enqueueRun({
    agentId: dispatch.agentId,
    agentName: dispatch.agentName,
    goal: dispatch.goal,
    triggeredBy: 'user',
    ws,
    userId,
    maxSteps: 6,
  });
  return NextResponse.json({
    ok: true,
    mode: 'queue',
    workflow: workflowName,
    jobId: job.id,
    agentId: dispatch.agentId,
    agentName: dispatch.agentName,
    status: job.status,
  });
}

export async function GET(req: NextRequest) {
  const g = await requireWorkspace(req, new URL(req.url).searchParams.get('ws'));
  if (!g.ok) return g.res;

  const { engineUrl: ENGINE_URL, token: adminToken } = await resolveEngine(g.ws, g.userId);
  const configured = isValidEngineUrl(ENGINE_URL);
  const validation = configured ? await validateEngineAuth(ENGINE_URL, adminToken) : { valid: false, error: 'No engine endpoint configured for this workspace' };

  return NextResponse.json({
    ok: validation.valid,
    workspace: g.ws,
    engine: ENGINE_URL || null,
    mode: validation.valid ? 'connected' : 'run-queue',
    endpoints: ['/orchestrations', '/health'],
    auth: 'Bearer token (workspace engine key or BORGA_ADMIN_TOKEN)',
    // Without a remote engine, workflow runs are executed by this workspace's own AI worker pool.
    localFallback: false,
    runQueueFallback: true,
    error: validation.error,
  });
}
