import 'server-only';
import { buildAgentContext, buildSystemPrompt, resolveLlm, callLlm } from './agent-context';
import { executeTool, parseToolCalls } from './tools';
import { getBorgaState, setBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';
import type { AgentRun, ActivityEvent } from './data';

/**
 * Always-on home: the agent loop as a plain library, runnable anywhere —
 * HTTP route, cron job, or a future always-on host — with explicit ws/userId
 * instead of a browser session. Moving the heartbeat off the laptop is now a
 * relocation (new caller), not a rewrite.
 */

export const MAX_RUN_STEPS = 8;
export const MAX_RUNS_STORED = 50;

// Generate a goal-driven fallback plan when no LLM is configured.
// Still executes REAL tool calls against real data.
export function planFromGoal(goal: string): Array<{ thought: string; toolName: string; params: Record<string, unknown> }> {
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
    steps.push({ thought: 'Creating content calendar task.', toolName: 'create_task', params: { title: 'Draft Q3 social content calendar', detail: 'Create 3 LinkedIn posts and 2 Twitter threads based on the latest company insights.', priority: 'P1', bucket: 'week', assignee: 'Nova', tags: ['marketing', 'content'], due: 'This week' } });
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

export async function persistRun(run: AgentRun, ws?: string | null, userId?: string | null): Promise<void> {
  try {
    const key = ws && userId ? userWsKey(userId, ws, 'agentRuns') : scopedKey(ws, 'agentRuns');
    const existing = (await getBorgaState<AgentRun[]>(key)) ?? [];
    await setBorgaState(key, [run, ...existing].slice(0, MAX_RUNS_STORED));
  } catch {
    // Persist is best-effort
  }
}

/** Rough per-1M-token rates (USD in/out) for the models Borga actually serves. */
const COST_PER_MTOK: { match: RegExp; in: number; out: number }[] = [
  { match: /sonnet|opus|claude/i, in: 3, out: 15 },
  { match: /gpt-4o/i, in: 2.5, out: 10 },
  { match: /gpt-4|o1|o3/i, in: 5, out: 15 },
  { match: /llama|mixtral|qwen|deepseek|gemini-flash|groq/i, in: 0.1, out: 0.3 },
  { match: /gemini/i, in: 1, out: 4 },
];

/**
 * Tier 6 audit trail: every run leaves one plain activity entry — which tools
 * ran, what was held for approval, which model served it, and a rough cost
 * estimate so a runaway loop is visible immediately.
 */
export async function auditRun(
  run: AgentRun,
  model: string | null,
  providerId: string | null,
  promptChars: number,
  ws?: string | null,
  userId?: string | null,
): Promise<void> {
  try {
    const toolsUsed = [...new Set(run.steps.filter((s) => s.type === 'tool_call' && s.tool).map((s) => s.tool))];
    const held = run.steps.filter((s) => s.type === 'tool_result' && /pending_approval/.test(s.content)).length;
    const replyChars = run.steps.filter((s) => s.type === 'thought' || s.type === 'summary').reduce((n, s) => n + s.content.length, 0);
    const rates = COST_PER_MTOK.find((r) => r.match.test(model ?? providerId ?? '')) ?? { in: 1, out: 3 };
    const estCost = ((promptChars / 4 / 1e6) * rates.in + (replyChars / 4 / 1e6) * rates.out).toFixed(4);
    const key = ws && userId ? userWsKey(userId, ws, 'activity') : scopedKey(ws, 'activity');
    const existing = (await getBorgaState<ActivityEvent[]>(key)) ?? [];
    const entry: ActivityEvent = {
      id: `e-run-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      agentId: run.agentId,
      agentName: run.agentName,
      actor: run.triggeredBy === 'user' ? 'agent' : 'system',
      kind: 'system',
      message: `Run ${run.status}: "${run.goal.slice(0, 80)}" — ${run.steps.length} steps, tools [${toolsUsed.join(', ') || 'none'}]${held ? `, ${held} held for approval` : ''}, model ${model ?? 'structured-planner'} (≈$${estCost} est).`,
    };
    await setBorgaState(key, [entry, ...existing].slice(0, 200));
  } catch {
    // Audit is best-effort
  }
}

export async function executeAgentRun(
  runId: string, agentId: string, agentName: string, goal: string,
  maxSteps: number, ctx: Awaited<ReturnType<typeof buildAgentContext>>,
  triggeredBy: AgentRun['triggeredBy'], startedAt: string,
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
