import 'server-only';
import { z } from 'zod';
import { mirrorMemory } from './supermemory-mirror';
import { smPassages } from './supermemory';
import { getBorgaState, setBorgaState, getAllBorgaStates, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { getApiKey, decryptSecret } from './secrets';
import { mcpCallTool } from './mcp-client';
import type { Task, Lead, AgentMemory, Approval, KnowledgeEntry, ActivityEvent, SettingsState, McpServer, ScheduledTask } from './data';
import { INITIAL_TASKS, INITIAL_LEADS, KNOWLEDGE_SEED, AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD } from './data';

/**
 * Tier 2 tool registry — single source of truth for every capability.
 * Adding a capability = add one entry here + one case in executeTool.
 * `needsConfirm` flags the never-list for the Tier 6 gate (send / spend /
 * delete / change-setting). Tier 6 enforces; Tier 2 only flags.
 */
export interface ToolDef {
  name: string;
  /** Reader-style description — the model picks tools from this. */
  description: string;
  schema: z.ZodType<Record<string, unknown>>;
  needsConfirm: boolean;
}

const priorityEnum = z.enum(['P0', 'P1', 'P2', 'P3']);
const bucketEnum = z.enum(['today', 'week', 'month']);

export const TOOL_DEFS: ToolDef[] = [
  { name: 'create_task', description: 'Use this to create a follow-up or action task (e.g. pipeline follow-up, KPI fix).', schema: z.object({ title: z.string().min(1).max(200), detail: z.string().max(500).optional(), priority: priorityEnum.optional(), bucket: bucketEnum.optional(), assignee: z.string().max(50).optional(), tags: z.array(z.string()).max(8).optional(), due: z.string().max(50).optional() }).passthrough(), needsConfirm: false },
  { name: 'update_task', description: 'Use this to advance a task by id (status, progress, priority).', schema: z.object({ id: z.string().min(1), patch: z.object({ status: z.enum(['todo', 'in-progress', 'done']).optional(), progress: z.number().optional(), priority: priorityEnum.optional(), detail: z.string().max(500).optional() }).passthrough() }).passthrough(), needsConfirm: false },
  { name: 'update_lead', description: 'Use this to move a sales lead to a new stage or update its value/priority.', schema: z.object({ id: z.string().min(1), patch: z.object({ stage: z.enum(['new', 'qualified', 'proposal', 'won', 'lost']).optional(), value: z.number().nonnegative().optional(), priority: priorityEnum.optional() }).passthrough() }).passthrough(), needsConfirm: false },
  { name: 'store_memory', description: 'Use this to remember a durable fact about the user or business for future sessions.', schema: z.object({ content: z.string().min(1).max(2000), kind: z.enum(['fact', 'context', 'instruction', 'observation']).optional(), tags: z.array(z.string()).max(10).optional(), confidence: z.number().min(0).max(100).optional() }).passthrough(), needsConfirm: false },
  { name: 'search_knowledge', description: 'Use this to look up the company knowledge base for services, policies, or facts.', schema: z.object({ query: z.string().min(1) }).passthrough(), needsConfirm: false },
  { name: 'browse_web', description: 'Use this to read one public web page (http/https only, no internal hosts).', schema: z.object({ url: z.string().min(1) }).passthrough(), needsConfirm: false },
  { name: 'web_search', description: 'Use this for real multi-engine web search via wigolo (requires wigolo running).', schema: z.object({ query: z.string().min(1), max_results: z.number().int().min(1).max(20).optional(), q: z.string().optional() }).passthrough(), needsConfirm: false },
  { name: 'web_crawl', description: 'Use this to crawl a site up to max_pages/max_depth via wigolo.', schema: z.object({ url: z.string().min(1), max_pages: z.number().int().min(1).max(200).optional(), max_depth: z.number().int().min(0).max(5).optional() }).passthrough(), needsConfirm: false },
  { name: 'web_research', description: 'Use this to synthesize a cited research report on a question via wigolo.', schema: z.object({ question: z.string().min(1), query: z.string().optional() }).passthrough(), needsConfirm: false },
  { name: 'list_tickets', description: 'Use this to read support tickets (Support Desk). Optional filter on status/priority/text; returns key, subject, status, priority, assignee and SLA-relevant timestamps.', schema: z.object({ status: z.enum(['open', 'in-progress', 'pending', 'resolved', 'closed', 'active']).optional(), priority: z.enum(['critical', 'high', 'medium', 'low']).optional(), query: z.string().max(200).optional() }).passthrough(), needsConfirm: false },
  { name: 'find_similar_tickets', description: 'Use this to find resolved support tickets similar to a ticket (id) or a described problem (query), to reuse what worked. Requires the Supermemory feature with ticket indexing on.', schema: z.object({ id: z.string().max(40).optional(), query: z.string().max(500).optional() }).passthrough(), needsConfirm: false },
  { name: 'create_ticket', description: 'Use this to open a support ticket (e.g. a customer problem found while working). Does not email anyone.', schema: z.object({ subject: z.string().min(1).max(200), description: z.string().max(5000).optional(), priority: z.enum(['critical', 'high', 'medium', 'low']).optional(), type: z.enum(['incident', 'request', 'bug', 'task', 'question']).optional(), requesterEmail: z.string().max(254).optional(), requesterName: z.string().max(120).optional() }).passthrough(), needsConfirm: false },
  { name: 'update_ticket', description: 'Use this to triage a ticket by key (e.g. SUP-12): status, priority, assignee, plus an optional internal note. Never contacts the customer.', schema: z.object({ id: z.string().min(1).max(40), status: z.enum(['open', 'in-progress', 'pending', 'resolved', 'closed']).optional(), priority: z.enum(['critical', 'high', 'medium', 'low']).optional(), assignee: z.string().max(120).optional(), note: z.string().max(5000).optional() }).passthrough(), needsConfirm: false },
  { name: 'draft_ticket_reply', description: 'Use this to prepare a reply to a ticket requester. It is saved as an internal DRAFT note; a human reviews and sends it from the Support Desk. The agent cannot email customers.', schema: z.object({ id: z.string().min(1).max(40), body: z.string().min(1).max(5000) }).passthrough(), needsConfirm: false },
  { name: 'run_workflow', description: 'Use this to trigger a named company workflow on the engine.', schema: z.object({ workflowName: z.string().min(1).max(100) }).passthrough(), needsConfirm: true },
  { name: 'query_state', description: 'Use this to read live workspace state (tasks, leads, agents, finance, memories, ops, goals, kpis, fundraising, mcpServers, notices, scheduledTasks) with an optional filter.', schema: z.object({ entity: z.enum(['tasks', 'leads', 'agents', 'finance', 'memories', 'ops', 'goals', 'kpis', 'fundraising', 'mcpServers', 'notices', 'scheduledTasks']), filter: z.string().optional() }).passthrough(), needsConfirm: false },
  { name: 'schedule_check', description: 'Use this when the user asks to be reminded or checked on later ("remind me", "watch this", "check daily"). Creates a heartbeat check that runs on its own and holds a notice for them. Check scheduledTasks first to avoid duplicates.', schema: z.object({ name: z.string().min(1).max(100), goal: z.string().min(1).max(1000), interval: z.enum(['hourly', 'daily', 'weekly', 'monthly']), urgent: z.boolean().optional() }).passthrough(), needsConfirm: false },
  { name: 'log_activity', description: 'Use this to leave a visible note in the activity feed about what was done.', schema: z.object({ message: z.string().min(1).max(500), kind: z.enum(['task', 'handoff', 'learn', 'sync', 'voice', 'system']).optional() }).passthrough(), needsConfirm: false },
  { name: 'create_approval', description: 'Use this to request human sign-off for budget/spend/hire/policy instead of acting directly. Safe to run freely.', schema: z.object({ title: z.string().min(1).max(200), description: z.string().max(1000).optional(), category: z.enum(['budget', 'spend', 'hire', 'policy', 'other']).optional(), amount: z.number().nonnegative().optional() }).passthrough(), needsConfirm: false },
  { name: 'handoff', description: 'Use this to hand a goal plus context to another specialist agent.', schema: z.object({ toAgentId: z.string().min(1).max(50), goal: z.string().min(1).max(500), context: z.string().max(1000).optional() }).passthrough(), needsConfirm: false },
  { name: 'list_composio_actions', description: 'Use this to list real action ids for a connected Composio app before calling one.', schema: z.object({ app: z.string().min(1) }).passthrough(), needsConfirm: false },
  { name: 'composio_action', description: 'Use this to run a REAL action on a connected Composio app (e.g. gmail send). May send messages or move money — needs human confirmation (Tier 6 gate).', schema: z.object({ app: z.string().min(1), action: z.string().min(1), parameters: z.record(z.unknown()).optional() }).passthrough(), needsConfirm: true },
  { name: 'mcp_call', description: 'Use this to invoke a tool on a user-configured MCP server. External side effects possible — needs human confirmation (Tier 6 gate).', schema: z.object({ server: z.string().min(1), tool: z.string().min(1), params: z.record(z.unknown()).optional() }).passthrough(), needsConfirm: true },
  { name: 'delegate', description: 'Use this to hand a focused goal to a specialist agent and get its report back. Runs them now (up to 4 steps) with their own prompt and tools; their consequential actions still pause for your approval individually. Sub-agents cannot delegate further.', schema: z.object({ toAgentId: z.string().min(1).max(50), goal: z.string().min(1).max(500), context: z.string().max(1000).optional() }).passthrough(), needsConfirm: false },
];

export const TOOL_NAMES = TOOL_DEFS.map((d) => d.name);

export function getToolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((d) => d.name === name);
}

/** Validate params against the registry; returns plain-language error for the model. */
export function validateToolParams(toolName: string, params: Record<string, unknown>): string | null {
  const def = getToolDef(toolName);
  if (!def) return `Unknown tool "${toolName}". Use one of: ${TOOL_NAMES.join(', ')}`;
  const parsed = def.schema.safeParse(params ?? {});
  if (parsed.success) return null;
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'params'}: ${i.message}`).join('; ');
  return `Invalid params for "${toolName}": ${issues}`;
}

/** Rendered into the system prompt so the model sees reader-style descriptions. */
export function formatToolsForPrompt(): string {
  return TOOL_DEFS.map((d) => `- ${d.name}: ${d.description}${d.needsConfirm ? ' (needs human confirmation before running)' : ''}`).join('\n');
}

/** Composio action names/apps that move money or reach a third party — held for human approval in every mode (Tier 6 hard gate). */
const SENSITIVE_ACTION_RE = /SEND_EMAIL|SEND_MESSAGE|SEND_DM|POST_MESSAGE|CREATE_MESSAGE|SEND_SMS|SEND_INVITE|PAYMENT|PAYOUT|TRANSFER|CHARGE|REFUND|WITHDRAW|PAY_/i;
const SENSITIVE_APP_RE = /stripe|paypal|wise|plaid|mercury|square|venmo/i;

function isSensitiveComposioAction(app: string, action: string, parameters: Record<string, unknown>, threshold = AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD): boolean {
  if (SENSITIVE_ACTION_RE.test(action)) return true;
  if (SENSITIVE_APP_RE.test(app)) return true;
  const amount = Number((parameters as { amount?: unknown }).amount);
  return Number.isFinite(amount) && amount >= threshold;
}

/**
 * Tier 6 hard confirmation gate. Sits between the model choosing a
 * consequential tool and that tool running, covering typed, spoken, and
 * heartbeat-initiated actions alike. Creates a per-action approval holding
 * the deferred payload and returns pending_approval — never executes.
 * Approving one action never pre-authorizes the next.
 */
async function holdForApproval(
  title: string,
  description: string,
  category: Approval['category'],
  amount: number,
  pending: Partial<Pick<Approval, 'pendingComposio' | 'pendingMcp' | 'pendingWorkflow'>>,
  agentId: string,
  agentName: string,
  ws: string | null | undefined,
  userId: string | null | undefined,
): Promise<ToolResult> {
  const key = (entity: string) => (userId ? userWsKey(userId, ws ?? '', entity) : scopedKey(ws, entity));
  const approvals = (await getBorgaState<Approval[]>(key('approvals'))) ?? [];
  const approval: Approval = {
    id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    title,
    description,
    category,
    amount,
    status: 'pending',
    submittedBy: agentName,
    createdAt: 'Just now',
    ...pending,
  };
  await setBorgaState(key('approvals'), [approval, ...approvals].slice(0, 100));
  if (userId && ws) void import('./email-notify').then((m) => m.notifyEvent(userId, ws, 'approval_requested', { id: approval.id, title, description, amount, submittedBy: agentName })).catch(() => undefined);
  await appendActivity(agentId, agentName, ws, userId, 'system', `Held for approval: "${title}" — waiting on your yes before it runs.`);
  return { ok: true, data: { status: 'pending_approval', approvalId: approval.id } };
}

/**
 * Calls a local/self-hosted wigolo daemon (https://github.com/KnockOutEZ/wigolo) — a
 * keyless, local-first MCP/REST server giving agents real multi-engine search, page
 * fetch, site crawl, and research synthesis. Requires the user to run `npx wigolo serve`
 * (or point WIGOLO_BASE_URL at a remote instance); this only talks to it over REST.
 */
async function wigoloRequest(tool: string, params: Record<string, unknown>): Promise<ToolResult> {
  const base = ((await getApiKey('WIGOLO_BASE_URL')) || 'http://127.0.0.1:3333').replace(/\/$/, '');
  const token = await getApiKey('WIGOLO_API_TOKEN');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${base}/v1/${tool}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(45000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (data as { error?: string; error_reason?: string; hint?: string } | null);
      return {
        ok: false,
        error: err?.error
          ? `wigolo ${tool} failed: ${err.error}${err.hint ? ` (${err.hint})` : ''}`
          : `wigolo is not reachable at ${base} — run "npx wigolo serve" or set WIGOLO_BASE_URL in Integrations.`,
      };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `wigolo is not reachable at ${base} — run "npx wigolo serve" or set WIGOLO_BASE_URL in Integrations. (${(e as Error).message})` };
  }
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  agentId: string,
  agentName: string,
  ws?: string | null,
  userId?: string | null,
): Promise<ToolResult> {
  // The real per-user data (what the dashboard actually reads/writes via
  // /api/borga/data) lives at userWsKey(userId, ws, entity), NOT the bare
  // scopedKey(ws, entity). Without userId this falls back to the older
  // workspace-only key so callers that can't yet supply one don't crash —
  // but every route that CAN resolve a session should pass it, or agent
  // actions silently land in a shadow copy the UI never sees.
  const key = (entity: string) => (userId ? userWsKey(userId, ws ?? '', entity) : scopedKey(ws, entity));
  // Tier 2: typed, named inputs validated up front. Failures return
  // plain-language errors TO THE MODEL (a feature — it reasons and recovers),
  // never a crash. Tier 6 adds the confirmation gate on needsConfirm tools.
  const validationError = validateToolParams(toolName, params);
  if (validationError) return { ok: false, error: validationError };
  switch (toolName) {
    case 'create_task': {
      const tasks = (await getBorgaState<Task[]>(key('tasks'))) ?? INITIAL_TASKS;
      const newTask: Task = {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title: String(params.title ?? 'New task').slice(0, 200),
        detail: String(params.detail ?? '').slice(0, 500),
        priority: (['P0', 'P1', 'P2', 'P3'].includes(String(params.priority))
          ? params.priority
          : 'P1') as Task['priority'],
        status: 'todo',
        bucket: (['today', 'week', 'month'].includes(String(params.bucket))
          ? params.bucket
          : 'week') as Task['bucket'],
        assignee: String(params.assignee ?? agentName).slice(0, 50),
        tags: Array.isArray(params.tags) ? params.tags.map(String).slice(0, 8) : [],
        due: String(params.due ?? 'This week').slice(0, 50),
        progress: 0,
      };
      await setBorgaState(key('tasks'), [newTask, ...tasks].slice(0, 200));
      await appendActivity(agentId, agentName, ws, userId, 'task', `Created task: "${newTask.title}" [${newTask.priority}]`);
      return { ok: true, data: { id: newTask.id, title: newTask.title } };
    }

    case 'update_task': {
      const tasks = (await getBorgaState<Task[]>(key('tasks'))) ?? INITIAL_TASKS;
      const id = String(params.id ?? '');
      const patch = (params.patch as Partial<Task>) ?? {};
      // Sanitize patch to only allow safe fields
      const safe: Partial<Task> = {};
      if (patch.status && ['todo', 'in-progress', 'done'].includes(patch.status)) safe.status = patch.status;
      if (typeof patch.progress === 'number') safe.progress = Math.min(100, Math.max(0, patch.progress));
      if (patch.priority && ['P0', 'P1', 'P2', 'P3'].includes(patch.priority)) safe.priority = patch.priority;
      if (patch.detail) safe.detail = String(patch.detail).slice(0, 500);

      const found = tasks.find((t) => t.id === id);
      if (!found) return { ok: false, error: `Task ${id} not found` };

      const updated = tasks.map((t) => (t.id === id ? { ...t, ...safe } : t));
      await setBorgaState(key('tasks'), updated);
      await appendActivity(agentId, agentName, ws, userId, 'task', `Updated task "${found.title}": ${JSON.stringify(safe)}`);
      return { ok: true, data: { id, applied: safe } };
    }

    case 'update_lead': {
      const leads = (await getBorgaState<Lead[]>(key('leads'))) ?? INITIAL_LEADS;
      const id = String(params.id ?? '');
      const patch = (params.patch as Partial<Lead>) ?? {};
      const safe: Partial<Lead> = {};
      if (patch.stage && ['new', 'qualified', 'proposal', 'won', 'lost'].includes(patch.stage)) safe.stage = patch.stage;
      if (typeof patch.value === 'number' && patch.value >= 0) safe.value = patch.value;
      if (patch.priority && ['P0', 'P1', 'P2', 'P3'].includes(patch.priority)) safe.priority = patch.priority;

      const found = leads.find((l) => l.id === id);
      if (!found) return { ok: false, error: `Lead ${id} not found` };

      const updated = leads.map((l) => (l.id === id ? { ...l, ...safe } : l));
      await setBorgaState(key('leads'), updated);
      await appendActivity(agentId, agentName, ws, userId, 'task',
        `Updated lead ${found.name}${safe.stage ? ` → stage: ${safe.stage}` : ''}${safe.value !== undefined ? `, value: $${safe.value.toLocaleString()}` : ''}`);
      return { ok: true, data: { id, name: found.name, applied: safe } };
    }

    case 'store_memory': {
      const memories = (await getBorgaState<AgentMemory[]>(key('memories'))) ?? [];
      const VALID_KINDS = ['fact', 'context', 'instruction', 'observation'];
      const kind = VALID_KINDS.includes(String(params.kind)) ? String(params.kind) : 'observation';
      const now = new Date().toISOString();
      const mem: AgentMemory = {
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        agentId,
        agentName,
        kind: kind as AgentMemory['kind'],
        content: String(params.content ?? '').slice(0, 2000),
        tags: Array.isArray(params.tags) ? params.tags.map(String).slice(0, 10) : [],
        confidence: typeof params.confidence === 'number'
          ? Math.min(100, Math.max(0, Math.round(params.confidence)))
          : 80,
        createdAt: now,
        lastAccessed: now,
      };
      await setBorgaState(key('memories'), [mem, ...memories].slice(0, 500));
      // Best-effort mirror to Supermemory (no-op unless the feature is on). Never blocks or fails the tool.
      if (userId && ws) void mirrorMemory(userId, ws, mem);
      return { ok: true, data: { id: mem.id, kind: mem.kind } };
    }

    case 'search_knowledge': {
      const kb = (await getBorgaState<KnowledgeEntry[]>(key('knowledge'))) ?? KNOWLEDGE_SEED;
      if (userId && ws) {
        // Semantic search when Supermemory is on and the KB is indexed; otherwise (or on any failure) the substring search below.
        const hits = await smPassages(userId, ws, 'knowledge', 'kb', String(params.query ?? ''), 6).catch(() => null);
        if (hits && hits.length) return { ok: true, data: hits.map((h) => ({ title: h.title, answer: h.text })) };
      }
      const q = String(params.query ?? '').toLowerCase();
      const words = q.split(/\s+/).filter((w) => w.length > 2);
      const results = kb
        .filter((k) => words.some((w) => k.title.toLowerCase().includes(w) || k.answer.toLowerCase().includes(w)))
        .slice(0, 6);
      if (!results.length) return { ok: true, data: 'No matching knowledge base entries found.' };
      return { ok: true, data: results.map((k) => ({ title: k.title, answer: k.answer })) };
    }

    case 'browse_web': {
      const rawUrl = String(params.url ?? '');
      try {
        const u = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return { ok: false, error: 'Only http/https URLs are allowed' };
        }
        const h = u.hostname;
        // SSRF guard: block internal IPs and localhost
        if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|localhost$|0\.0\.0\.0$)/.test(h)) {
          return { ok: false, error: 'Internal network URLs are blocked' };
        }
        // Prefer wigolo's fetch when configured — it auto-escalates to a headless
        // browser on SPAs/anti-bot challenges and returns clean markdown, vs. this
        // route's plain HTTP GET + tag-strip fallback below.
        const wigolo = await wigoloRequest('fetch', { url: u.toString() });
        if (wigolo.ok) {
          const d = wigolo.data as { content?: string; markdown?: string; title?: string; status?: number } | null;
          const content = (d?.markdown ?? d?.content ?? '').slice(0, 6000);
          if (content) {
            await appendActivity(agentId, agentName, ws, userId, 'learn', `Fetched ${h} via wigolo for research`);
            return { ok: true, data: { url: u.toString(), title: d?.title, content, source: 'wigolo' } };
          }
        }
        const res = await fetch(u.toString(), {
          headers: { 'User-Agent': 'Borga/1.0 (autonomous business agent)' },
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        // Strip HTML tags, collapse whitespace, truncate
        const plain = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);
        await appendActivity(agentId, agentName, ws, userId, 'learn', `Browsed ${h} for research`);
        return { ok: true, data: { url: u.toString(), status: res.status, content: plain, source: 'plain-fetch' } };
      } catch (e) {
        return { ok: false, error: `Browse failed: ${(e as Error).message}` };
      }
    }

    case 'web_search': {
      const query = params.query ?? params.q;
      if (!query) return { ok: false, error: 'query is required for web_search' };
      const result = await wigoloRequest('search', {
        query,
        max_results: typeof params.max_results === 'number' ? params.max_results : 5,
      });
      if (result.ok) {
        await appendActivity(agentId, agentName, ws, userId, 'learn', `Searched the web via wigolo: "${String(query).slice(0, 120)}"`);
      }
      return result;
    }

    case 'web_crawl': {
      const startUrl = String(params.url ?? '');
      if (!startUrl) return { ok: false, error: 'url is required for web_crawl' };
      const result = await wigoloRequest('crawl', {
        url: startUrl,
        max_pages: Math.min(typeof params.max_pages === 'number' ? params.max_pages : 10, 200),
        max_depth: Math.min(typeof params.max_depth === 'number' ? params.max_depth : 2, 5),
      });
      if (result.ok) {
        await appendActivity(agentId, agentName, ws, userId, 'learn', `Crawled ${startUrl} via wigolo`);
      }
      return result;
    }

    case 'web_research': {
      const question = params.question ?? params.query;
      if (!question) return { ok: false, error: 'question is required for web_research' };
      const result = await wigoloRequest('research', { question });
      if (result.ok) {
        await appendActivity(agentId, agentName, ws, userId, 'learn', `Researched via wigolo: "${String(question).slice(0, 120)}"`);
      }
      return result;
    }

    case 'find_similar_tickets':
    case 'list_tickets':
    case 'create_ticket':
    case 'update_ticket':
    case 'draft_ticket_reply': {
      if (!userId || !ws) return { ok: false, error: 'Tickets need an authenticated workspace session.' };
      const { loadFeatures } = await import('./features-server');
      if (!(await loadFeatures(userId, ws)).flags.tickets) return { ok: false, error: 'The Support Desk feature is turned off for this workspace.' };
      const T = await import('./tickets-server');
      if (toolName === 'find_similar_tickets') {
        const T3 = await import('./tickets-server');
        const S = await import('./supermemory-sync');
        const id = params.id ? String(params.id) : '';
        const t = id ? await T3.getTicket(userId, ws, id) : null;
        const q = String(params.query ?? '') || (t ? t.subject + '\n' + t.description : '');
        if (!q.trim()) return { ok: false, error: 'Give an existing ticket id or a query describing the problem.' };
        const found = await S.findSimilarTickets(userId, ws, q, id || undefined);
        return found === null
          ? { ok: true, data: 'Similar-ticket search is not enabled (turn on Supermemory in Settings → Features and allow "Resolved tickets").' }
          : { ok: true, data: found.length ? found : 'No similar resolved tickets found yet.' };
      }
      if (toolName === 'list_tickets') {
        const q = String(params.query ?? '').toLowerCase();
        const status = params.status ? String(params.status) : '';
        const rows = (await T.listTickets(userId, ws))
          .filter((t) => (status === 'active' ? t.status !== 'resolved' && t.status !== 'closed' : !status || t.status === status))
          .filter((t) => !params.priority || t.priority === params.priority)
          .filter((t) => !q || `${t.id} ${t.subject} ${t.requesterEmail}`.toLowerCase().includes(q))
          .slice(0, 20)
          .map((t) => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, assignee: t.assignee || null, requester: t.requesterEmail, createdAt: t.createdAt, firstResponseAt: t.firstResponseAt }));
        return { ok: true, data: rows };
      }
      try {
        if (toolName === 'create_ticket') {
          const t = await T.createTicket(userId, ws, {
            subject: String(params.subject), description: String(params.description ?? ''),
            priority: (params.priority as 'medium') ?? 'medium', type: (params.type as 'request') ?? 'request',
            requesterEmail: String(params.requesterEmail ?? '').trim().toLowerCase(), requesterName: String(params.requesterName ?? ''),
          }, { source: 'api', actor: agentName });
          await appendActivity(agentId, agentName, ws, userId, 'task', `Opened ticket ${t.id}: "${t.subject}"`);
          return { ok: true, data: { id: t.id } };
        }
        const id = String(params.id);
        if (toolName === 'draft_ticket_reply') {
          const r = await T.addComment(userId, ws, id, { kind: 'internal', body: `DRAFT REPLY (not sent — review and send from the Support Desk):

${String(params.body)}`, author: agentName });
          if (r.error) return { ok: false, error: r.error };
          await appendActivity(agentId, agentName, ws, userId, 'task', `Drafted a reply on ${id} for human review`);
          return { ok: true, data: { id, note: 'Saved as an internal draft. A human must send it.' } };
        }
        const patch: Record<string, unknown> = {};
        for (const k of ['status', 'priority', 'assignee']) if (params[k] !== undefined) patch[k] = params[k];
        if (Object.keys(patch).length) {
          const r = await T.updateTicket(userId, ws, id, T.updateInputSchema.parse(patch), agentName);
          if (r.error) return { ok: false, error: r.error };
        }
        if (params.note) {
          const r = await T.addComment(userId, ws, id, { kind: 'internal', body: String(params.note), author: agentName });
          if (r.error) return { ok: false, error: r.error };
        }
        await appendActivity(agentId, agentName, ws, userId, 'task', `Updated ticket ${id}`);
        return { ok: true, data: { id } };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }

    case 'run_workflow': {
      // Tier 6: workflows can change external state — hold for per-action approval.
      const workflowName = String(params.workflowName ?? 'unnamed').slice(0, 100);
      return holdForApproval(
        `Run workflow — ${workflowName}`,
        `Agent ${agentName} wants to run the "${workflowName}" workflow on the company engine. Approve to trigger it; rejecting runs nothing.`,
        'other',
        0,
        { pendingWorkflow: { workflowName } },
        agentId, agentName, ws, userId,
      );
    }

    case 'query_state': {
      const entity = String(params.entity ?? '');
      const filter = String(params.filter ?? '').toLowerCase();
      const ALLOWED = new Set(['tasks', 'leads', 'agents', 'finance', 'memories', 'ops', 'goals', 'kpis', 'fundraising', 'mcpServers', 'notices', 'scheduledTasks']);
      if (!ALLOWED.has(entity)) {
        return { ok: false, error: `Unknown entity "${entity}". Valid: ${[...ALLOWED].join(', ')}` };
      }
      const all = ws
        ? await getBorgaState<Record<string, unknown>>(key(entity))
        : (await getAllBorgaStates())[entity];
      let data: unknown = all;
      if (filter && Array.isArray(data)) {
        data = (data as Record<string, unknown>[])
          .filter((item) => JSON.stringify(item).toLowerCase().includes(filter))
          .slice(0, 20);
      } else if (Array.isArray(data)) {
        data = (data as unknown[]).slice(0, 20);
      }
      return { ok: true, data };
    }

    case 'log_activity': {
      const VALID_KINDS = ['task', 'handoff', 'learn', 'sync', 'voice', 'system'];
      const kind = VALID_KINDS.includes(String(params.kind)) ? String(params.kind) : 'task';
      await appendActivity(
        agentId, agentName, ws, userId,
        kind as ActivityEvent['kind'],
        String(params.message ?? '').slice(0, 500),
      );
      return { ok: true };
    }

    case 'create_approval': {
      const approvals = (await getBorgaState<Approval[]>(key('approvals'))) ?? [];
      const VALID_CATS = ['budget', 'spend', 'hire', 'policy', 'other'];
      const category = VALID_CATS.includes(String(params.category)) ? String(params.category) : 'other';
      const approval: Approval = {
        id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        title: String(params.title ?? 'Approval needed').slice(0, 200),
        description: String(params.description ?? '').slice(0, 1000),
        category: category as Approval['category'],
        amount: typeof params.amount === 'number' && params.amount >= 0 ? params.amount : 0,
        status: 'pending',
        submittedBy: agentName,
        createdAt: 'Just now',
      };
      await setBorgaState(key('approvals'), [approval, ...approvals].slice(0, 100));
      await appendActivity(agentId, agentName, ws, userId, 'task', `Created approval request: "${approval.title}" ($${approval.amount.toLocaleString()})`);
      return { ok: true, data: { id: approval.id } };
    }

    case 'handoff': {
      const toAgentId = String(params.toAgentId ?? '').slice(0, 50);
      const goal = String(params.goal ?? '').slice(0, 500);
      const context = String(params.context ?? '').slice(0, 1000);
      if (!toAgentId || !goal) return { ok: false, error: 'toAgentId and goal are required for handoff' };

      await appendActivity(agentId, agentName, ws, userId, 'handoff', `Handed off to ${toAgentId}: "${goal}"`);

      // Plant handoff as a context memory for the target agent
      const memories = (await getBorgaState<AgentMemory[]>(key('memories'))) ?? [];
      const now = new Date().toISOString();
      const handoffMem: AgentMemory = {
        id: `mem-hoff-${Date.now()}`,
        agentId: toAgentId,
        agentName: toAgentId,
        kind: 'context',
        content: `HANDOFF from ${agentName}: ${goal}${context ? ` — Context: ${context}` : ''}`,
        tags: ['handoff', agentName.toLowerCase().replace(/\s+/g, '-')],
        confidence: 95,
        createdAt: now,
        lastAccessed: now,
      };
      await setBorgaState(key('memories'), [handoffMem, ...memories].slice(0, 500));
      return { ok: true, data: { to: toAgentId, goal } };
    }

    case 'delegate': {
      // Specialist sub-agent: own prompt + own tools, reports back. Depth is
      // capped at 1 — a sub-agent that tries to delegate gets a plain error.
      const toAgentId = String(params.toAgentId ?? '').slice(0, 50);
      const goal = String(params.goal ?? '').slice(0, 500);
      const context = String(params.context ?? '').slice(0, 1000);
      const depth = Number(params._depth ?? 0);
      if (!toAgentId || !goal) return { ok: false, error: 'toAgentId and goal are required for delegate' };
      if (depth >= 1) return { ok: false, error: 'Sub-agents cannot delegate further — finish the goal yourself with your own tools.' };
      const { buildAgentContext, buildSystemPrompt, resolveLlm, callLlm } = await import('./agent-context');
      const subCtx = await buildAgentContext(toAgentId, ws, userId, goal);
      if (!subCtx) return { ok: false, error: `Agent "${toAgentId}" not found. Use query_state with entity "agents" to list valid ids.` };
      await appendActivity(agentId, agentName, ws, userId, 'handoff', `Delegated to ${subCtx.agent.name}: "${goal}"`);
      const subProvider = await resolveLlm(subCtx.agent.model || null, ws, userId);
      if (!subProvider) {
        return { ok: true, data: { status: 'queued-no-llm', to: toAgentId, note: 'No LLM configured — planted as a handoff memory instead. Configure a provider for live sub-runs.' } };
      }
      let messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
        { role: 'system', content: buildSystemPrompt(subCtx, goal) },
        { role: 'user', content: `You are acting as a specialist. Complete this goal and report back concisely.\n\nGoal: ${goal}${context ? `\nContext from ${agentName}: ${context}` : ''}` },
      ];
      let report = '';
      for (let i = 0; i < 4; i++) {
        let subReply: string;
        try {
          subReply = await callLlm(messages, subProvider);
        } catch (e) {
          return { ok: false, error: `Sub-agent LLM call failed: ${(e as Error).message}` };
        }
        const summaryMatch = subReply.match(/SUMMARY:\s*([\s\S]+?)(?:<tool_call>|$)/);
        if (summaryMatch) report = summaryMatch[1].trim();
        const calls = parseToolCalls(subReply);
        if (!calls.length) break;
        const results: string[] = [];
        for (const tc of calls) {
          // Consequential sub-actions still pass the Tier 6 gate inside
          // executeTool and return pending_approval like any other call.
          const r = await executeTool(tc.tool, { ...(tc.params as Record<string, unknown>), _depth: depth + 1 }, toAgentId, subCtx.agent.name, ws, userId);
          const s = r.ok ? (r.data === undefined ? '{}' : JSON.stringify(r.data)).slice(0, 600) : `ERROR: ${r.error}`;
          results.push(`Tool: ${tc.tool}\nResult: ${s}`);
        }
        messages = [...messages, { role: 'assistant', content: subReply }, { role: 'user', content: `Tool results:\n${results.join('\n\n')}\n\nContinue, or write SUMMARY: with your report if done.` }];
      }
      if (!report) report = `${subCtx.agent.name} finished ${goal.slice(0, 80)} with no summary — check its tool results in the activity feed.`;
      await appendActivity(toAgentId, subCtx.agent.name, ws, userId, 'handoff', `Reported back: "${report.slice(0, 200)}"`);
      return { ok: true, data: { to: toAgentId, report } };
    }

    case 'schedule_check': {
      // Lets the agent promise "I'll remind you" and mean it: creates a
      // heartbeat check (same shape as scheduler create). Needs no
      // confirmation — it only schedules a future check, which itself still
      // passes the quiet-hours and per-action gates when it fires.
      // Dynamic import: heartbeat pulls the agent runner which pulls this
      // module — static import would cycle. Deferred to call time, resolved.
      const { computeNextRun } = await import('./heartbeat');
      const validIntervals = ['hourly', 'daily', 'weekly', 'monthly'] as const;
      const interval = validIntervals.includes(params.interval as (typeof validIntervals)[number])
        ? (params.interval as (typeof validIntervals)[number])
        : 'daily';
      const name = String(params.name ?? 'Reminder').slice(0, 100);
      const goal = String(params.goal ?? '').slice(0, 1000);
      if (!goal) return { ok: false, error: 'goal is required for schedule_check (what should Borga do when this fires?)' };
      const tkey = key('scheduledTasks');
      const existing = (await getBorgaState<ScheduledTask[]>(tkey)) ?? [];
      const task: ScheduledTask = {
        id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name,
        agentId,
        goal,
        interval,
        enabled: true,
        lastRun: null,
        nextRun: computeNextRun(interval),
        runCount: 0,
        urgent: params.urgent === true,
      };
      await setBorgaState(tkey, [task, ...existing].slice(0, 50));
      await appendActivity(agentId, agentName, ws, userId, 'task', `Scheduled "${name}" (${interval}) — fires next ${task.nextRun}`);
      return { ok: true, data: { id: task.id, name, interval, nextRun: task.nextRun } };
    }

    case 'list_composio_actions': {
      const app = String(params.app ?? '').toLowerCase();
      if (!app) return { ok: false, error: 'app is required for list_composio_actions (e.g. {app:"gmail"})' };
      const apiKey = await getApiKey('COMPOSIO_API_KEY');
      if (!apiKey) return { ok: false, error: 'Composio is not configured. Add COMPOSIO_API_KEY in Integrations → Composio.' };
      try {
        const res = await fetch(
          `https://backend.composio.dev/api/v3/tools?toolkits[]=${encodeURIComponent(app.toUpperCase())}&limit=30`,
          { headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) },
        );
        if (!res.ok) return { ok: false, error: `Could not list actions for "${app}" (${res.status}).` };
        const data = (await res.json()) as { items?: any[] } | any[];
        const tools: any[] = Array.isArray(data) ? data : data.items ?? [];
        return {
          ok: true,
          data: tools.slice(0, 30).map((t) => ({ action: t.name ?? t.slug ?? t.id, description: t.description ?? '' })),
        };
      } catch (e) {
        return { ok: false, error: `Could not reach Composio: ${(e as Error).message}` };
      }
    }

    case 'composio_action': {
      const app = String(params.app ?? '').toLowerCase();
      const action = String(params.action ?? '');
      const parameters = (params.parameters ?? {}) as Record<string, unknown>;
      if (!app || !action) {
        return { ok: false, error: 'app and action are required for composio_action (e.g. {app:"gmail", action:"GMAIL_SEND_EMAIL"})' };
      }
      const apiKey = await getApiKey('COMPOSIO_API_KEY');
      if (!apiKey) {
        return { ok: false, error: 'Composio is not configured. Add COMPOSIO_API_KEY in Integrations → Composio to use connected apps.' };
      }
      const base = 'https://backend.composio.dev/api/v3';
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-api-key': apiKey };
      // Resolve the entity for an ACTIVE connection to this app — and, critically,
      // reject the call up front if the app isn't actually connected, instead of
      // letting the agent blindly guess and burn a step on an opaque 4xx from
      // Composio. This is real tool *selection*, not just execution.
      let entityId = 'default';
      let matchedConnection = false;
      let connectedAppsList: string[] | null = null;
      try {
        const accRes = await fetch(`${base}/connectedAccounts?limit=50`, { headers, signal: AbortSignal.timeout(15000) });
        if (accRes.ok) {
          const accData = (await accRes.json()) as { items?: any[] } | any[];
          const accounts: any[] = Array.isArray(accData) ? accData : accData.items ?? [];
          const active = accounts.filter((a) => a.status === 'ACTIVE' || a.status === 'connected');
          connectedAppsList = [...new Set(active.map((a) => String(a.appName ?? '').toLowerCase()).filter(Boolean))];
          const match = active.find((a) => String(a.appName ?? '').toLowerCase() === app);
          if (match?.entityId) {
            entityId = match.entityId;
            matchedConnection = true;
          }
        }
      } catch {
        // Composio itself unreachable — fall through and let the real
        // execute call below surface the actual network error, rather than
        // blocking on an inconclusive connectivity check.
      }

      if (connectedAppsList !== null && !matchedConnection) {
        return {
          ok: false,
          error: connectedAppsList.length > 0
            ? `"${app}" is not connected. Currently connected apps: ${connectedAppsList.join(', ')}. Connect "${app}" first in Integrations → Composio Toolkits, or use one of the connected apps above.`
            : `"${app}" is not connected and no apps are currently connected. Connect it first in Integrations → Composio Toolkits.`,
        };
      }

      // Tier 6 hard gate: sensitive sends/spends hold in EVERY mode (not just
      // autonomous), with the threshold read from workspace settings when set.
      const settings = await getBorgaState<SettingsState>(key('settings'));
      const threshold = settings?.approvalThresholdUsd ?? AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD;
      if (isSensitiveComposioAction(app, action, parameters, threshold)) {
        return holdForApproval(
          `Send / spend approval — ${action} on ${app}`,
          `Agent ${agentName} wants to run "${action}" on ${app} with ${JSON.stringify(parameters).slice(0, 300)}, which sends information or moves money to a third party. Approve to run it exactly once; rejecting runs nothing.`,
          'spend',
          Number((parameters as { amount?: unknown }).amount) || 0,
          { pendingComposio: { app, action, parameters, entityId } },
          agentId, agentName, ws, userId,
        );
      }

      const res = await fetch(`${base}/actions/${encodeURIComponent(action)}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entityId, parameters }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        return { ok: false, error: `Composio action "${action}" on ${app} failed (${res.status}): ${t.slice(0, 300)}` };
      }
      const data = await res.json();
      await appendActivity(agentId, agentName, ws, userId, 'task', `Executed Composio action ${action} on ${app}`);
      return { ok: true, data };
    }

    case 'mcp_call': {
      const serverName = String(params.server ?? '').toLowerCase();
      const toolName = String(params.tool ?? '');
      const toolParams = (params.params ?? {}) as Record<string, unknown>;
      if (!serverName || !toolName) {
        return { ok: false, error: 'server and tool are required for mcp_call (e.g. {server:"wigolo", tool:"search", params:{...}})' };
      }
      const servers = (await getBorgaState<McpServer[]>(key('mcpServers'))) ?? [];
      const server = servers.find((s) => s.name.toLowerCase() === serverName);
      if (!server) {
        return {
          ok: false,
          error: servers.length > 0
            ? `No MCP server named "${serverName}" is configured. Configured servers: ${servers.map((s) => s.name).join(', ')}.`
            : `No MCP server named "${serverName}" is configured. Add one in Integrations → MCP Servers.`,
        };
      }
      // Tier 6: external side effects are unknown — hold for per-action approval.
      // Connectivity/auth is still validated now so a held approval is runnable.
      let hasToken = server.authType === 'none';
      if (server.authType !== 'none') {
        const enc = await getBorgaState<string>(key(`mcp_token:${server.id}`));
        const token = enc ? decryptSecret(enc) || undefined : undefined;
        if (!token) return { ok: false, error: `"${server.name}" requires authentication but has no token saved — connect it in Integrations → MCP Servers.` };
        hasToken = true;
      }
      if (hasToken) {
        return holdForApproval(
          `External tool approval — ${toolName} on ${server.name}`,
          `Agent ${agentName} wants to call MCP tool "${toolName}" on "${server.name}" with ${JSON.stringify(toolParams).slice(0, 300)}. Approve to run it exactly once; rejecting runs nothing.`,
          'other',
          0,
          { pendingMcp: { server: server.name, tool: toolName, params: toolParams } },
          agentId, agentName, ws, userId,
        );
      }
      const result = await mcpCallTool(server.url, undefined, toolName, toolParams);
      if (!result.ok) return { ok: false, error: `MCP call to "${server.name}"."${toolName}" failed: ${result.error}` };
      await appendActivity(agentId, agentName, ws, userId, 'task', `Called MCP tool ${toolName} on ${server.name}`);
      return { ok: true, data: result.result };
    }

    default:
      return { ok: false, error: `Unknown tool: "${toolName}". Use one of: ${TOOL_NAMES.join(', ')}` };
  }
}

export function parseToolCalls(text: string): Array<{ tool: string; params: Record<string, unknown> }> {
  const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as { tool?: string; params?: Record<string, unknown> };
      if (parsed.tool && typeof parsed.tool === 'string') {
        calls.push({ tool: parsed.tool, params: parsed.params ?? {} });
      }
    } catch {
      // Malformed tool call — skip
    }
  }
  return calls;
}

async function appendActivity(
  agentId: string,
  agentName: string,
  ws: string | null | undefined,
  userId: string | null | undefined,
  kind: ActivityEvent['kind'],
  message: string,
): Promise<void> {
  const key = (entity: string) => (userId ? userWsKey(userId, ws ?? '', entity) : scopedKey(ws, entity));
  try {
    const existing = (await getBorgaState<ActivityEvent[]>(key('activity'))) ?? [];
    const entry: ActivityEvent = {
      id: `e-agent-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      agentId,
      agentName,
      actor: 'agent',
      kind,
      message,
    };
    await setBorgaState(key('activity'), [entry, ...existing].slice(0, 200));
  } catch {
    // Activity is best-effort
  }
}
