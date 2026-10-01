import { NextResponse, type NextRequest } from 'next/server';
import { buildAgentContext, buildSystemPrompt, resolveLlm, callLlm } from '@/lib/borga/agent-context';
import { executeTool, parseToolCalls } from '@/lib/borga/tools';
import { executeAgentRun, persistRun, auditRun, planFromGoal } from '@/lib/borga/agent-runner';
import { getBorgaState, scopedKey } from '@/lib/borga/persistence';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { userWsKey } from '@/lib/borga/keys';
import type { AgentRun, AgentRunStep } from '@/lib/borga/data';

function isValidWsId(ws: unknown): ws is string {
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

export const runtime = 'nodejs';

// Non-streaming execution, persistence, and audit live in lib/borga/agent-runner.ts
// (shared with the heartbeat lib and cron — one implementation everywhere).
const MAX_STEPS = 8;

function sendEvent(controller: ReadableStreamDefaultController, data: object): void {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
  controller.enqueue(encoded);
}

export async function POST(req: NextRequest) {
  const csrfHeader = req.headers.get('X-Borga-Client');
  if (csrfHeader !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const userId = await getUserId(req);

  let body: { agentId?: string; goal?: string; maxSteps?: number; stream?: boolean; triggeredBy?: string; ws?: string; companyName?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const agentId = body.agentId ?? 'a-borga';
  const goal = (body.goal ?? '').trim();
  const maxSteps = Math.min(body.maxSteps ?? MAX_STEPS, MAX_STEPS);
  const stream = body.stream !== false;
  const triggeredBy = (body.triggeredBy as AgentRun['triggeredBy']) ?? 'user';
  const ws = isValidWsId(body.ws) ? body.ws : null;
  const companyName = (body.companyName ?? 'the company').slice(0, 80);

  if (!goal) {
    return NextResponse.json({ ok: false, error: 'goal is required' }, { status: 400 });
  }

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();

  // Load agent context
  const ctx = await buildAgentContext(agentId, ws, userId, goal);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: `Agent "${agentId}" not found` }, { status: 404 });
  }

  const { agent } = ctx;

  if (!stream) {
    // Non-streaming: run synchronously and return JSON (shared lib runner)
    const run = await executeAgentRun(runId, agentId, agent.name, goal, maxSteps, ctx, triggeredBy, startedAt, ws, companyName, userId);
    await persistRun(run, ws, userId);
    const provider = await resolveLlm(ctx.agent.model || null, ws, userId);
    await auditRun(run, provider?.model ?? null, provider?.providerId ?? null, goal.length, ws, userId);
    return NextResponse.json({ ok: true, run });
  }

  // Streaming SSE response
  const readable = new ReadableStream({
    async start(controller) {
      const run: AgentRun = {
        id: runId,
        agentId,
        agentName: agent.name,
        goal,
        status: 'running',
        steps: [],
        startedAt,
        triggeredBy,
      };

      try {
        sendEvent(controller, { type: 'start', runId, agentId, agentName: agent.name, goal });

        const provider = await resolveLlm(agent.model || null, ws, userId);
        const systemPrompt = buildSystemPrompt(ctx, goal, companyName);

        let messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Execute this goal fully. Use the available tools to take real actions.\n\nGoal: ${goal}` },
        ];

        let stepCount = 0;
        let summary = '';

        if (!provider) {
          // No LLM configured — use structured fallback plan with real tool execution
          sendEvent(controller, { type: 'thought', content: `No LLM configured. Executing structured plan for: "${goal.slice(0, 80)}"` });
          const plan = planFromGoal(goal);

          for (const step of plan.slice(0, maxSteps)) {
            stepCount++;
            const thoughtStep: AgentRunStep = { type: 'thought', content: step.thought, at: new Date().toISOString() };
            run.steps.push(thoughtStep);
            sendEvent(controller, { type: 'thought', step: stepCount, content: step.thought });

            const callStep: AgentRunStep = {
              type: 'tool_call', content: `Calling ${step.toolName}`, tool: step.toolName,
              params: step.params, at: new Date().toISOString(),
            };
            run.steps.push(callStep);
            sendEvent(controller, { type: 'tool_call', step: stepCount, tool: step.toolName, params: step.params });

            const result = await executeTool(step.toolName, step.params, agentId, agent.name, ws, userId);
            const resultStep: AgentRunStep = {
              type: 'tool_result', content: result.ok ? JSON.stringify(result.data).slice(0, 300) : result.error ?? 'Error',
              tool: step.toolName, result: result.data, at: new Date().toISOString(),
            };
            run.steps.push(resultStep);
            sendEvent(controller, { type: 'tool_result', step: stepCount, tool: step.toolName, ok: result.ok, data: result.data, error: result.error });
          }

          summary = `Completed ${stepCount} actions for goal: "${goal.slice(0, 80)}". No LLM configured — used structured plan. Configure a provider in Tools tab for AI-driven execution.`;
        } else {
          // LLM-driven agentic loop
          for (let i = 0; i < maxSteps; i++) {
            stepCount = i + 1;
            sendEvent(controller, { type: 'thinking', step: stepCount });

            let llmResponse: string;
            try {
              llmResponse = await callLlm(messages, provider);
            } catch (e) {
              sendEvent(controller, { type: 'error', error: `LLM call failed: ${(e as Error).message}` });
              run.status = 'error';
              break;
            }

            // Extract the summary if present
            const summaryMatch = llmResponse.match(/SUMMARY:\s*([\s\S]+?)(?:<tool_call>|$)/);
            if (summaryMatch) summary = summaryMatch[1].trim();

            // Extract thought (everything before first tool_call)
            const thoughtText = llmResponse.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/SUMMARY:[\s\S]*/g, '').trim();
            if (thoughtText) {
              const thoughtStep: AgentRunStep = { type: 'thought', content: thoughtText.slice(0, 1000), at: new Date().toISOString() };
              run.steps.push(thoughtStep);
              sendEvent(controller, { type: 'thought', step: stepCount, content: thoughtText.slice(0, 500) });
            }

            // Parse and execute tool calls
            const toolCalls = parseToolCalls(llmResponse);
            if (!toolCalls.length) {
              // No more tool calls — done
              break;
            }

            const toolResults: string[] = [];
            for (const tc of toolCalls) {
              const callStep: AgentRunStep = {
                type: 'tool_call', content: `Calling ${tc.tool}`, tool: tc.tool,
                params: tc.params, at: new Date().toISOString(),
              };
              run.steps.push(callStep);
              sendEvent(controller, { type: 'tool_call', step: stepCount, tool: tc.tool, params: tc.params });

              const result = await executeTool(tc.tool, tc.params, agentId, agent.name, ws, userId);
              const resultStr = result.ok
                ? (result.data === undefined ? '{}' : JSON.stringify(result.data)).slice(0, 600)
                : `ERROR: ${result.error}`;

              const resultStep: AgentRunStep = {
                type: 'tool_result', content: resultStr, tool: tc.tool,
                result: result.data, at: new Date().toISOString(),
              };
              run.steps.push(resultStep);
              sendEvent(controller, { type: 'tool_result', step: stepCount, tool: tc.tool, ok: result.ok, data: result.data, error: result.error });
              toolResults.push(`Tool: ${tc.tool}\nResult: ${resultStr}`);
            }

            // Feed results back to LLM
            messages = [
              ...messages,
              { role: 'assistant', content: llmResponse },
              { role: 'user', content: `Tool results:\n${toolResults.join('\n\n')}\n\nContinue executing the goal. If the goal is fully complete, write your SUMMARY: and stop calling tools.` },
            ];
          }
        }

        if (!summary) {
          summary = `${agent.name} completed ${stepCount} step${stepCount !== 1 ? 's' : ''} for: "${goal.slice(0, 60)}"`;
        }

        const summaryStep: AgentRunStep = { type: 'summary', content: summary, at: new Date().toISOString() };
        run.steps.push(summaryStep);
        run.status = 'complete';
        run.completedAt = new Date().toISOString();
        run.summary = summary;

        sendEvent(controller, { type: 'summary', content: summary });
        sendEvent(controller, { type: 'complete', runId, summary, steps: run.steps.length });

        await persistRun(run, ws, userId);
        await auditRun(run, provider?.model ?? null, provider?.providerId ?? null, messages.reduce((n, m) => n + m.content.length, 0), ws, userId);
      } catch (e) {
        const errMsg = (e as Error).message;
        sendEvent(controller, { type: 'error', error: errMsg });
        const run2 = { id: runId, agentId, agentName: agent.name, goal, status: 'error' as const, steps: [], startedAt, triggeredBy };
        await persistRun(run2, ws, userId);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// GET /api/borga/agent/run — list recent runs
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') ?? '';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);
  const wsParam = searchParams.get('ws');
  const ws = isValidWsId(wsParam) ? wsParam : null;
  const userId = await getUserId(req);

  const key = ws && userId ? userWsKey(userId, ws, 'agentRuns') : scopedKey(ws, 'agentRuns');
  const runs = (await getBorgaState<AgentRun[]>(key)) ?? [];
  const filtered = agentId ? runs.filter((r) => r.agentId === agentId) : runs;
  return NextResponse.json({ ok: true, runs: filtered.slice(0, limit) });
}
