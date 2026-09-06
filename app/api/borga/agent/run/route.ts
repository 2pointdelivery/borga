import { NextResponse, type NextRequest } from 'next/server';
import { buildAgentContext, buildSystemPrompt, resolveLlm, callLlm } from '@/lib/borga/agent-context';
import { executeTool, parseToolCalls } from '@/lib/borga/tools';
import { getBorgaState, setBorgaState, scopedKey } from '@/lib/borga/persistence';
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

const MAX_STEPS = 8;
const MAX_RUNS_STORED = 50;

// Generate a goal-driven fallback plan when no LLM is configured.
// Still executes REAL tool calls against real data.
function planFromGoal(goal: string): Array<{ thought: string; toolName: string; params: Record<string, unknown> }> {
  const g = goal.toLowerCase();
  const steps: Array<{ thought: string; toolName: string; params: Record<string, unknown> }> = [];

  if (/kpi|brief|review|metric|flag|below/.test(g)) {
    steps.push({ thought: 'Querying current KPI state to find below-target metrics.', toolName: 'query_state', params: { entity: 'kpis' } });
    steps.push({ thought: 'Logging morning brief activity to keep the team informed.', toolName: 'log_activity', params: { message: 'Agent performed KPI review — checked all departments for below-target metrics.', kind: 'sync' } });
    steps.push({ thought: 'Storing key KPI findings as an observation for future reference.', toolName: 'store_memory', params: { content: `KPI review completed. Logged observations for ${new Date().toDateString()}.`, kind: 'observation', tags: ['kpi', 'daily-review'], confidence: 85 } });
  } else if (/lead|pipeline|follow.?up|qualify|stage/.test(g)) {
    steps.push({ thought: 'Querying current leads to assess pipeline health.', toolName: 'query_state', params: { entity: 'leads' } });
    steps.push({ thought: 'Creating a follow-up task for the highest-priority leads.', toolName: 'create_task', params: { title: 'Follow up on P0 leads in pipeline', detail: 'Scheduled follow-up: review open proposals and send updated contact.', priority: 'P0', bucket: 'today', assignee: 'Atlas', tags: ['sales', 'pipeline'], due: 'Today 5pm' } });
    steps.push({ thought: 'Logging pipeline review activity.', toolName: 'log_activity', params: { message: 'Lead pipeline review completed — follow-up tasks created for P0 leads.', kind: 'task' } });
  } else if (/grant|fund|opport|sbir|pitch/.test(g)) {
    steps.push({ thought: 'Querying existing funding opportunities to assess current pipeline.', toolName: 'query_state', params: { entity: 'fundraising' } });
    steps.push({ thought: 'Searching knowledge base for grant-related information.', toolName: 'search_knowledge', params: { query: 'grant funding logistics' } });
    steps.push({ thought: 'Creating a task to evaluate new funding opportunities.', toolName: 'create_task', params: { title: 'Evaluate new grant opportunities', detail: 'Scan registries and score by mission fit (target >80% match).', priority: 'P1', bucket: 'week', assignee: 'Nadia', tags: ['fundraising', 'grants'], due: 'This week' } });
    steps.push({ thought: 'Storing observation about funding scan.', toolName: 'store_memory', params: { content: 'Initiated grant opportunity scan. Follow-up task created for Nadia.', kind: 'observation', tags: ['fundraising', 'grants'], confidence: 80 } });
  } else if (/content|social|post|linkedin|twitter/.test(g)) {
    steps.push({ thought: 'Querying recent social posts to assess engagement.', toolName: 'query_state', params: { entity: 'tasks', filter: 'marketing' } });
    steps.push({ thought: 'Creating content calendar task.', toolName: 'create_task', params: { title: 'Draft Q3 social content calendar', detail: 'Create 3 LinkedIn posts and 2 Twitter threads based on 2Point Logistics insights.', priority: 'P1', bucket: 'week', assignee: 'Nova', tags: ['marketing', 'content'], due: 'This week' } });
    steps.push({ thought: 'Logging content workflow initiation.', toolName: 'log_activity', params: { message: 'Content calendar workflow initiated — drafting 5 posts for multi-channel distribution.', kind: 'task' } });
  } else if (/research|market|competitor|industry trend|benchmark|landscape/.test(g)) {
    steps.push({ thought: `Researching the web for: ${goal.slice(0, 100)}`, toolName: 'web_research', params: { question: goal.slice(0, 300) } });
    steps.push({ thought: 'Storing the research findings for future reference.', toolName: 'store_memory', params: { content: `Web research completed for: "${goal.slice(0, 200)}"`, kind: 'fact', tags: ['research', 'web'], confidence: 70 } });
    steps.push({ thought: 'Logging this research run.', toolName: 'log_activity', params: { message: `Completed web research on: "${goal.slice(0, 100)}"`, kind: 'learn' } });
  } else if (/ops|booking|dispatch|driver|route|deliver/.test(g)) {
    steps.push({ thought: 'Checking current ops state for pending bookings.', toolName: 'query_state', params: { entity: 'ops' } });
    steps.push({ thought: 'Creating dispatch task for pending bookings.', toolName: 'create_task', params: { title: 'Assign drivers to pending bookings', detail: 'Review pending bookings without driver assignments and dispatch optimally.', priority: 'P0', bucket: 'today', assignee: 'Borga', tags: ['ops', 'dispatch'], due: 'Today' } });
    steps.push({ thought: 'Logging ops review.', toolName: 'log_activity', params: { message: 'Ops dispatch review completed — pending booking tasks created.', kind: 'sync' } });
  } else {
    // Generic goal — query state, create task, log, store memory
    steps.push({ thought: `Checking current state to understand the context for: ${goal.slice(0, 100)}`, toolName: 'query_state', params: { entity: 'tasks' } });
    steps.push({ thought: 'Creating an action task for this goal.', toolName: 'create_task', params: { title: goal.slice(0, 100), detail: 'Task generated by autonomous agent run.', priority: 'P1', bucket: 'week', assignee: 'Borga', tags: ['agent-run'], due: 'This week' } });
    steps.push({ thought: 'Logging this goal to the activity feed.', toolName: 'log_activity', params: { message: `Agent initiated autonomous run for: "${goal.slice(0, 100)}"`, kind: 'task' } });
    steps.push({ thought: 'Storing this context for future reference.', toolName: 'store_memory', params: { content: `Ran autonomous goal: "${goal.slice(0, 200)}"`, kind: 'context', tags: ['agent-run'], confidence: 75 } });
  }

  return steps;
}

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
  const ctx = await buildAgentContext(agentId, ws, userId);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: `Agent "${agentId}" not found` }, { status: 404 });
  }

  const { agent } = ctx;

  if (!stream) {
    // Non-streaming: run synchronously and return JSON
    const run = await executeAgentRun(runId, agentId, agent.name, goal, maxSteps, ctx, triggeredBy, startedAt, null, ws, companyName, userId);
    await persistRun(run, ws, userId);
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

async function executeAgentRun(
  runId: string, agentId: string, agentName: string, goal: string,
  maxSteps: number, ctx: Awaited<ReturnType<typeof buildAgentContext>>,
  triggeredBy: AgentRun['triggeredBy'], startedAt: string,
  _controller: null,
  ws: string | null = null,
  companyName: string = 'the company',
  userId: string | null = null,
): Promise<AgentRun> {
  const run: AgentRun = { id: runId, agentId, agentName, goal, status: 'running', steps: [], startedAt, triggeredBy };
  if (!ctx) { run.status = 'error'; run.summary = 'Agent context not found'; return run; }

  const provider = await resolveLlm(ctx?.agent?.model || null, ws, userId);
  const systemPrompt = buildSystemPrompt(ctx, goal, companyName);
  let stepCount = 0;
  let summary = '';

  if (!provider) {
    const plan = planFromGoal(goal);
    for (const step of plan.slice(0, maxSteps)) {
      stepCount++;
      run.steps.push({ type: 'thought', content: step.thought, at: new Date().toISOString() });
      run.steps.push({ type: 'tool_call', content: `Calling ${step.toolName}`, tool: step.toolName, params: step.params, at: new Date().toISOString() });
      const result = await executeTool(step.toolName, step.params, agentId, agentName, ws, userId);
      run.steps.push({ type: 'tool_result', content: result.ok ? (result.data === undefined ? '{}' : JSON.stringify(result.data)).slice(0, 300) : result.error ?? 'Error', tool: step.toolName, result: result.data, at: new Date().toISOString() });
    }
    summary = `Completed ${stepCount} actions for: "${goal.slice(0, 80)}". Configure an LLM provider for AI-driven execution.`;
  } else {
    let messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Execute this goal fully using the available tools.\n\nGoal: ${goal}` },
    ];
    for (let i = 0; i < maxSteps; i++) {
      stepCount = i + 1;
      try {
        const llmResponse = await callLlm(messages, provider);
        const summaryMatch = llmResponse.match(/SUMMARY:\s*([\s\S]+?)(?:<tool_call>|$)/);
        if (summaryMatch) summary = summaryMatch[1].trim();
        const thought = llmResponse.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/SUMMARY:[\s\S]*/g, '').trim();
        if (thought) run.steps.push({ type: 'thought', content: thought.slice(0, 1000), at: new Date().toISOString() });
        const toolCalls = parseToolCalls(llmResponse);
        if (!toolCalls.length) break;
        const toolResults: string[] = [];
        for (const tc of toolCalls) {
          run.steps.push({ type: 'tool_call', content: `Calling ${tc.tool}`, tool: tc.tool, params: tc.params, at: new Date().toISOString() });
          const result = await executeTool(tc.tool, tc.params, agentId, agentName, ws, userId);
          const resultStr = result.ok ? (result.data === undefined ? '{}' : JSON.stringify(result.data)).slice(0, 600) : `ERROR: ${result.error}`;
          run.steps.push({ type: 'tool_result', content: resultStr, tool: tc.tool, result: result.data, at: new Date().toISOString() });
          toolResults.push(`Tool: ${tc.tool}\nResult: ${resultStr}`);
        }
        messages = [...messages, { role: 'assistant', content: llmResponse }, { role: 'user', content: `Tool results:\n${toolResults.join('\n\n')}\n\nContinue or write SUMMARY: if done.` }];
      } catch {
        run.status = 'error'; break;
      }
    }
  }

  if (!summary) summary = `${agentName} completed ${stepCount} step${stepCount !== 1 ? 's' : ''} for: "${goal.slice(0, 60)}"`;
  run.steps.push({ type: 'summary', content: summary, at: new Date().toISOString() });
  if (run.status !== 'error') run.status = 'complete';
  run.completedAt = new Date().toISOString();
  run.summary = summary;
  return run;
}

async function persistRun(run: AgentRun, ws?: string | null, userId?: string | null): Promise<void> {
  try {
    const key = ws && userId ? userWsKey(userId, ws, 'agentRuns') : scopedKey(ws, 'agentRuns');
    const existing = (await getBorgaState<AgentRun[]>(key)) ?? [];
    await setBorgaState(key, [run, ...existing].slice(0, MAX_RUNS_STORED));
  } catch {
    // Persist is best-effort
  }
}

// GET /api/borga/agent/run  list recent runs
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
