import 'server-only';
import { getAllBorgaStates, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { resolveProviderConfig } from './llm-providers';
import { getApiKey } from './secrets';
import type {
  Agent, AgentMemory, KnowledgeEntry, Task, Lead,
  ActivityEvent, KpiGroup, FinanceEntry,
  Invoice, Bill, Vendor, Customer, Goal,
  JournalEntry, BankTxn, BankAccount, Employee,
} from './data';
import { AGENTS, KNOWLEDGE_SEED, INITIAL_TASKS, INITIAL_LEADS } from './data';
import { deriveBusinessInsights } from './insights';

export interface AgentContext {
  agent: Agent;
  memories: AgentMemory[];
  kbFacts: string;
  taskSummary: string;
  leadSummary: string;
  activitySummary: string;
  kpiSummary: string;
  financeSummary: string;
  insightSummary: string;
  composioAppsSummary: string;
}

/**
 * Live-checks which Composio apps are actually connected (ACTIVE), so the
 * agent's system prompt states this up front instead of the model guessing
 * an app name and burning a step on a doomed composio_action call. Best-effort:
 * returns null (not "no apps") on any failure so the prompt can say "unknown"
 * rather than falsely claiming nothing is connected.
 */
async function getConnectedComposioApps(): Promise<string[] | null> {
  try {
    const apiKey = await getApiKey('COMPOSIO_API_KEY');
    if (!apiKey) return [];
    const res = await fetch('https://backend.composio.dev/api/v3/connectedAccounts?limit=50', {
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: any[] } | any[];
    const accounts: any[] = Array.isArray(data) ? data : data.items ?? [];
    const active = accounts.filter((a) => a.status === 'ACTIVE' || a.status === 'connected');
    return [...new Set(active.map((a) => String(a.appName ?? '').toLowerCase()).filter(Boolean))];
  } catch {
    return null;
  }
}

export async function buildAgentContext(agentId: string, ws?: string | null, userId?: string | null): Promise<AgentContext | null> {
  // One bulk read; entity lookup is scoped to exactly the key the dashboard
  // itself reads/writes (userWsKey when we have a userId — the real per-user
  // per-workspace row), falling back to the older bare-workspace key only
  // when no userId is available so this never throws.
  const all = await getAllBorgaStates();
  const read = <T>(entity: string): T | null => {
    const scoped = ws ? all[userId ? userWsKey(userId, ws, entity) : scopedKey(ws, entity)] : undefined;
    return ((scoped ?? all[entity]) as T | undefined) ?? null;
  };

  const agents = read<Agent[]>('agents') ?? AGENTS;
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  const memories = (read<AgentMemory[]>('memories') ?? [])
    .filter((m) => m.agentId === agentId)
    .sort((a, b) => new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime())
    .slice(0, 25);

  const kb = (read<KnowledgeEntry[]>('knowledge') ?? KNOWLEDGE_SEED).slice(0, 35);
  const tasks = (read<Task[]>('tasks') ?? INITIAL_TASKS).filter((t) => t.status !== 'done').slice(0, 15);
  const leads = (read<Lead[]>('leads') ?? INITIAL_LEADS)
    .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
    .slice(0, 10);
  const activity = (read<ActivityEvent[]>('activity') ?? []).slice(0, 8);
  const kpiGroups = read<KpiGroup[]>('kpis') ?? [];
  const finance = read<FinanceEntry[]>('finance') ?? [];

  const kbFacts = kb.length
    ? kb.map((k) => `- ${k.title}: ${k.answer}`).join('\n')
    : 'No knowledge base entries yet.';

  const taskSummary = tasks.length
    ? tasks.map((t) => `[${t.id}] [${t.priority}] ${t.title} (${t.status}, ${t.bucket}, assignee: ${t.assignee})`).join('\n')
    : 'No open tasks.';

  const leadSummary = leads.length
    ? leads.map((l) => `[${l.id}] ${l.name} @ ${l.company}: $${l.value.toLocaleString()}, stage=${l.stage}, priority=${l.priority}`).join('\n')
    : 'No active leads.';

  const activitySummary = activity.length
    ? activity.map((e) => `[${e.time}] ${e.agentName}: ${e.message}`).join('\n')
    : 'No recent activity.';

  const kpiSummary = kpiGroups.length
    ? kpiGroups
        .map((g) => {
          const below = g.kpis.filter((k) => k.value < k.target);
          return below.length
            ? `${g.name}: ${below.map((k) => `${k.label} ${k.value}${k.unit} vs target ${k.target}${k.unit}`).join(', ')} BELOW TARGET`
            : `${g.name}: all KPIs on track`;
        })
        .join('\n')
    : '';

  const totalRevenue = finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const totalExpense = finance.filter((f) => f.kind === 'expense' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const totalAR = finance.filter((f) => f.kind === 'invoice' && !f.voidedAt).reduce((s, f) => s + f.amount, 0);
  const financeSummary = finance.length
    ? `Revenue: $${totalRevenue.toLocaleString()} | Expenses: $${totalExpense.toLocaleString()} | AR Outstanding: $${totalAR.toLocaleString()}`
    : '';

  // Cross-module learning: derive live business insights from every module so
  // each agent reasons over the real state of the company, not just its own silo.
  const insights = deriveBusinessInsights({
    finance,
    invoices: read<Invoice[]>('invoices') ?? [],
    bills: read<Bill[]>('bills') ?? [],
    vendors: read<Vendor[]>('vendors') ?? [],
    customers: read<Customer[]>('customers') ?? [],
    leads: read<Lead[]>('leads') ?? INITIAL_LEADS,
    goals: read<Goal[]>('goals') ?? [],
    journals: read<JournalEntry[]>('journals') ?? [],
    bankTxns: read<BankTxn[]>('bankTxns') ?? [],
    bankAccounts: read<BankAccount[]>('bankAccounts') ?? [],
    employees: read<Employee[]>('employees') ?? [],
  });
  const insightSummary = insights
    .map((i) => `- [${i.severity.toUpperCase()}][${i.area}] ${i.title} — ${i.detail} Suggested action: ${i.action}`)
    .join('\n');

  const connectedApps = await getConnectedComposioApps();
  const composioAppsSummary = connectedApps === null
    ? 'Unable to check right now — attempt composio_action normally; it will report if the app is not connected.'
    : connectedApps.length > 0
      ? connectedApps.join(', ')
      : 'None connected. Do not call composio_action until an app is connected in Integrations → Composio Toolkits.';

  return { agent, memories, kbFacts, taskSummary, leadSummary, activitySummary, kpiSummary, financeSummary, insightSummary, composioAppsSummary };
}

export function buildSystemPrompt(ctx: AgentContext, goal: string, companyName = 'the company'): string {
  const { agent, memories, kbFacts, taskSummary, leadSummary, activitySummary, kpiSummary, financeSummary, insightSummary, composioAppsSummary } = ctx;

  const memorySummary = memories.length
    ? memories.map((m) => `[${m.kind}] ${m.content}`).join('\n')
    : 'No stored memories yet.';

  return `You are ${agent.name}, the ${agent.role} at ${companyName}, an autonomous business command center.

${agent.description}
${agent.instructions ? `\nOperating instructions:\n${agent.instructions}\n` : ''}
Your skills: ${agent.skills.join(', ')}

## Current Goal
${goal}

## Your Stored Memories
${memorySummary}

## Knowledge Base (${companyName})
${kbFacts}

## Open Tasks (include IDs when updating)
${taskSummary}

## Active Leads (include IDs when updating)
${leadSummary}

## Recent Activity
${activitySummary}

${kpiSummary ? `## KPI Status\n${kpiSummary}\n` : ''}
${financeSummary ? `## Finance\n${financeSummary}\n` : ''}
## Connected Composio Apps
${composioAppsSummary}
Only call composio_action for an app listed above (case-insensitive app slug, e.g. "gmail", "slack", "hubspot"). If the app you need isn't listed, say so in your reasoning and use create_approval or store_memory instead of guessing.

## Business Intelligence (auto-derived from all modules)
${insightSummary || 'No insights derived yet.'}
Use these findings to ground your decisions and store durable conclusions with store_memory.

## Available Tools
Take real actions using these tools. Output one tool call at a time, then wait for the result before calling the next.

To call a tool, output EXACTLY:
<tool_call>
{"tool": "TOOL_NAME", "params": {PARAMS_JSON}}
</tool_call>

Available tools:
- create_task: params: {title, detail, priority (P0|P1|P2|P3), bucket (today|week|month), assignee, tags (string[]), due}
- update_task: params: {id, patch: {status? (todo|in-progress|done), progress? (0-100), priority?}}
- update_lead: params: {id, patch: {stage? (new|qualified|proposal|won|lost), value?, priority?}}
- store_memory: params: {content, kind (fact|context|instruction|observation), tags (string[]), confidence (0-100)}
- search_knowledge: params: {query}
- browse_web: params: {url} — reads one page; auto-escalates to wigolo's headless-browser fetch (clean markdown, SPA/anti-bot handling) when wigolo is configured, else plain HTTP.
- web_search: params: {query, max_results?} — real multi-engine web search via wigolo (github.com/KnockOutEZ/wigolo). Requires wigolo running (Integrations → Wigolo web research); errors with setup instructions if not reachable.
- web_crawl: params: {url, max_pages?, max_depth?} — multi-page site crawl via wigolo.
- web_research: params: {question} — decomposes a question, fans out sub-queries, fetches sources, and returns a synthesized cited report via wigolo.
- run_workflow: params: {workflowName}
- query_state: params: {entity (tasks|leads|agents|finance|memories|ops|goals), filter?}
- log_activity: params: {message, kind (task|handoff|learn|sync|voice|system)}
- create_approval: params: {title, description, category (budget|spend|hire|policy|other), amount}
- handoff: params: {toAgentId, goal, context}
- list_composio_actions: params: {app} — lists the real available action ids for a connected Composio app (e.g. call with app:"gmail" before guessing an action id). Use this when you're not sure of the exact action id.
- composio_action: params: {app (Composio app slug, e.g. 'gmail'), action (Composio action id, e.g. 'GMAIL_SEND_EMAIL'), parameters (object)} — run a REAL action on a connected Composio integration (Gmail, Slack, HubSpot, Stripe, Calendar, etc.). Only call this for an app listed under "Connected Composio Apps" above — calling it for an unconnected app returns an error naming what's actually connected instead of executing.
- mcp_call: params: {server (name of a configured MCP server), tool (tool name on that server), params (object)} — invoke a tool on a user-configured MCP server (Integrations → MCP Servers). Use query_state with entity "mcpServers" first if you need to see which servers and tools are configured.

## Execution Rules
1. Think step-by-step before acting. State what you plan to do.
2. Use tool calls to take REAL actions, not just describe them.
3. After each tool result, decide whether more actions are needed.
4. Store important findings using store_memory.
5. When complete, write a concise summary prefixed with "SUMMARY: ".
6. Do NOT fabricate data — use query_state to look up actual state.`;
}

// Provider → env key / base URL resolution is now dynamic (DB-backed per workspace).
// See lib/borga/llm-providers.ts.

// Maps a model id (possibly provider-prefixed) to the provider that should serve it.
export const MODEL_PROVIDER_PREFIX: { prefix: string; provider: string; strip: boolean }[] = [
  { prefix: 'anthropic/', provider: 'llm-claude', strip: true },
  { prefix: 'openai/', provider: 'llm-openai', strip: true },
  { prefix: 'nvidia/', provider: 'llm-nvidia', strip: true },
  { prefix: 'google/', provider: 'llm-gemini', strip: true },
  { prefix: 'groq/', provider: 'llm-groq', strip: true },
  { prefix: 'meta/', provider: 'llm-nvidia', strip: true },
  { prefix: 'mistralai/', provider: 'llm-nvidia', strip: true },
  { prefix: 'deepseek-ai/', provider: 'llm-nvidia', strip: true },
  { prefix: 'qwen/', provider: 'llm-nvidia', strip: true },
  { prefix: 'mistral/', provider: 'llm-nvidia', strip: true },
  { prefix: 'stealth/', provider: 'llm-openrouter', strip: false },
  { prefix: 'openrouter/', provider: 'llm-openrouter', strip: false },
];

/**
 * Resolve the LLM to use for a run.
 * - With no override, returns the globally selected provider/model (the default).
 * - With a per-agent `model` override, switches to the matching provider and
 *   normalises the model id (strips the provider prefix except for OpenRouter,
 *   which requires it). Falls back to the global default if the override's
 *   provider has no API key configured.
 */
export async function resolveLlm(modelOverride?: string | null, ws?: string | null, userId?: string | null): Promise<{ providerId: string; model: string; apiKey: string; baseUrl: string } | null> {
  const globalLlm = await getConfiguredLlm(ws, userId);
  if (!modelOverride || modelOverride === 'demo' || modelOverride === 'default') return globalLlm;
  const hit = MODEL_PROVIDER_PREFIX.find((m) => modelOverride.toLowerCase().startsWith(m.prefix));
  if (!hit) return globalLlm;
  const providerId = hit.provider;
  const cfg = await resolveProviderConfig(providerId, ws, userId);
  const envKey = cfg.envVar;
  const apiKey = envKey ? await getApiKey(envKey) : '';
  const baseUrl = cfg.baseUrl;
  if (!baseUrl || (envKey && !apiKey)) return globalLlm;
  const model = hit.strip ? modelOverride.slice(hit.prefix.length) : modelOverride;
  return { providerId, model, apiKey, baseUrl };
}

export async function getConfiguredLlm(ws?: string | null, userId?: string | null): Promise<{ providerId: string; model: string; apiKey: string; baseUrl: string } | null> {
  try {
    const all = await getAllBorgaStates();
    const llmKey = ws ? (userId ? userWsKey(userId, ws, 'llm') : scopedKey(ws, 'llm')) : undefined;
    const llm = ((llmKey ? all[llmKey] : undefined) ?? all['llm']) as
      | { providerId?: string; model?: string }
      | undefined;
    if (!llm?.providerId || llm.providerId === 'llm-demo') return null;

    const cfg = await resolveProviderConfig(llm.providerId, ws, userId);
    const envKey = cfg.envVar;
    const apiKey = envKey ? await getApiKey(envKey) : '';
    const baseUrl = cfg.baseUrl;

    if (!baseUrl) return null;
    if (envKey && !apiKey) return null; // key required but not set

    return { providerId: llm.providerId, model: llm.model ?? '', apiKey, baseUrl };
  } catch {
    return null;
  }
}

export async function callLlm(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  provider: { providerId: string; model: string; apiKey: string; baseUrl: string },
): Promise<string> {
  const { providerId, model, apiKey, baseUrl } = provider;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Claude uses a different API shape
  if (providerId === 'llm-claude') {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMsgs = messages.filter((m) => m.role !== 'system');
    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { ...headers, 'anthropic-version': '2023-06-01', 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, system, messages: userMsgs, max_tokens: 1024 }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
    const d = (await res.json()) as { content?: { text?: string }[] };
    return d.content?.[0]?.text?.trim() ?? '';
  }

  // OpenAI-compatible (NVIDIA, Groq, OpenAI, OpenRouter, Ollama, custom)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, max_tokens: 1024, temperature: 0.4 }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`LLM API error ${res.status}: ${await res.text().catch(() => '')}`);
  const d = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return d.choices?.[0]?.message?.content?.trim() ?? '';
}
