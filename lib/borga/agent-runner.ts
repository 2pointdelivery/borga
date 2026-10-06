import 'server-only';
import { buildAgentContext, buildSystemPrompt, resolveLlm, callLlm } from './agent-context';
import { executeTool, parseToolCalls } from './tools';
import { getBorgaState, setBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';
import type { AgentRun, AgentRunStep, ActivityEvent, PlannedStep } from './data';
import { planFromGoal as planFromGoalPure, type PlanStep } from './plan-from-goal';

/**
 * Always-on home: the agent loop as a plain library, runnable anywhere —
 * HTTP route, cron job, or a future always-on host — with explicit ws/userId
 * instead of a browser session. Moving the heartbeat off the laptop is now a
 * relocation (new caller), not a rewrite.
 */

export const MAX_RUN_STEPS = 8;
export const MAX_RUNS_STORED = 50;

export const planFromGoal = planFromGoalPure;
export type { PlanStep };

/** Progress/stop hooks the run queue passes in so queued runs stream and cancel between steps. */
export interface RunHooks {
  /** Called once per appended step — lets a queue persist live progress. */
  onStep?: (step: AgentRunStep) => void;
  /** Polled between steps; a true return stops the run gracefully ('stopped'). */
  shouldStop?: () => Promise<boolean> | boolean;
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
  hooks?: RunHooks,
): Promise<AgentRun> {
  const run: AgentRun = { id: runId, agentId, agentName, goal, status: 'running', steps: [], startedAt, triggeredBy };
  if (!ctx) { run.status = 'error'; run.summary = 'Agent context not found'; return run; }

  const push = (step: AgentRunStep) => { run.steps.push(step); hooks?.onStep?.(step); };
  const stopRequested = async () => (hooks?.shouldStop ? await hooks.shouldStop() : false);

  const provider = await resolveLlm(ctx?.agent?.model || null, ws, userId);
  const systemPrompt = buildSystemPrompt(ctx, goal, companyName);
  let stepCount = 0;
  let summary = '';
  let stopped = false;

  if (!provider) {
    const plan = planFromGoal(goal);
    for (const step of plan.slice(0, maxSteps)) {
      if (await stopRequested()) { stopped = true; break; }
      stepCount++;
      push({ type: 'thought', content: step.thought, at: new Date().toISOString() });
      push({ type: 'tool_call', content: `Calling ${step.toolName}`, tool: step.toolName, params: step.params, at: new Date().toISOString() });
      const result = await executeTool(step.toolName, step.params, agentId, agentName, ws, userId);
      push({ type: 'tool_result', content: result.ok ? (result.data === undefined ? '{}' : JSON.stringify(result.data)).slice(0, 300) : result.error ?? 'Error', tool: step.toolName, result: result.data, at: new Date().toISOString() });
    }
    summary = stopped
      ? 'Stopped by user between steps.'
      : `Completed ${stepCount} actions for: "${goal.slice(0, 80)}". Configure an LLM provider for AI-driven execution.`;
  } else {
    let messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Execute this goal fully using the available tools.\n\nGoal: ${goal}` },
    ];
    for (let i = 0; i < maxSteps; i++) {
      if (await stopRequested()) { stopped = true; break; }
      stepCount = i + 1;
      try {
        const llmResponse = await callLlm(messages, provider);
        const summaryMatch = llmResponse.match(/SUMMARY:\s*([\s\S]+?)(?:<tool_call>|$)/);
        if (summaryMatch) summary = summaryMatch[1].trim();
        const thought = llmResponse.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/SUMMARY:[\s\S]*/g, '').trim();
        if (thought) push({ type: 'thought', content: thought.slice(0, 1000), at: new Date().toISOString() });
        const toolCalls = parseToolCalls(llmResponse);
        if (!toolCalls.length) break;
        const toolResults: string[] = [];
        for (const tc of toolCalls) {
          if (await stopRequested()) { stopped = true; break; }
          push({ type: 'tool_call', content: `Calling ${tc.tool}`, tool: tc.tool, params: tc.params, at: new Date().toISOString() });
          const result = await executeTool(tc.tool, tc.params, agentId, agentName, ws, userId);
          const resultStr = result.ok ? (result.data === undefined ? '{}' : JSON.stringify(result.data)).slice(0, 600) : `ERROR: ${result.error}`;
          push({ type: 'tool_result', content: resultStr, tool: tc.tool, result: result.data, at: new Date().toISOString() });
          toolResults.push(`Tool: ${tc.tool}\nResult: ${resultStr}`);
        }
        if (stopped) break;
        messages = [...messages, { role: 'assistant', content: llmResponse }, { role: 'user', content: `Tool results:\n${toolResults.join('\n\n')}\n\nContinue or write SUMMARY: if done.` }];
      } catch {
        run.status = 'error'; break;
      }
    }
  }

  if (stopped) run.status = 'stopped';
  else if (run.status !== 'error') run.status = 'complete';
  if (!summary) summary = stopped
    ? `${agentName} stopped after ${stepCount} step${stepCount !== 1 ? 's' : ''}.`
    : `${agentName} completed ${stepCount} step${stepCount !== 1 ? 's' : ''} for: "${goal.slice(0, 60)}"`;
  push({ type: 'summary', content: summary, at: new Date().toISOString() });
  run.completedAt = new Date().toISOString();
  run.summary = summary;
  return run;
}

/**
 * Executes an exact, human-edited plan from the Planner's "execute as-is"
 * mode: the steps run verbatim (real tool calls, in order), regardless of
 * whether an LLM is configured — the plan IS the intelligence here.
 */
export async function executePlannedSteps(
  runId: string, agentId: string, agentName: string, goal: string,
  plan: PlannedStep[], ctx: Awaited<ReturnType<typeof buildAgentContext>>,
  triggeredBy: AgentRun['triggeredBy'], startedAt: string,
  ws: string | null = null,
  userId: string | null = null,
  hooks?: RunHooks,
): Promise<AgentRun> {
  const run: AgentRun = { id: runId, agentId, agentName, goal, status: 'running', steps: [], startedAt, triggeredBy };
  if (!ctx) { run.status = 'error'; run.summary = 'Agent context not found'; return run; }
  const push = (step: AgentRunStep) => { run.steps.push(step); hooks?.onStep?.(step); };
  const stopRequested = async () => (hooks?.shouldStop ? await hooks.shouldStop() : false);
  let stopped = false;
  let done = 0;

  for (const step of plan) {
    if (await stopRequested()) { stopped = true; break; }
    push({ type: 'thought', content: step.thought.slice(0, 1000), at: new Date().toISOString() });
    push({ type: 'tool_call', content: `Calling ${step.toolName}`, tool: step.toolName, params: step.params, at: new Date().toISOString() });
    const result = await executeTool(step.toolName, step.params, agentId, agentName, ws, userId);
    const resultStr = result.ok ? (result.data === undefined ? '{}' : JSON.stringify(result.data)).slice(0, 600) : `ERROR: ${result.error}`;
    push({ type: 'tool_result', content: resultStr, tool: step.toolName, result: result.data, at: new Date().toISOString() });
    done++;
  }

  const summary = stopped
    ? `Stopped by user after ${done} of ${plan.length} planned steps.`
    : `Executed the ${plan.length}-step plan for: "${goal.slice(0, 60)}"`;
  run.status = stopped ? 'stopped' : 'complete';
  push({ type: 'summary', content: summary, at: new Date().toISOString() });
  run.completedAt = new Date().toISOString();
  run.summary = summary;
  return run;
}
