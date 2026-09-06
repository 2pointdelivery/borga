import 'server-only';
import { getBorgaState, setBorgaState, getAllBorgaStates, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { getApiKey, decryptSecret } from './secrets';
import { mcpCallTool } from './mcp-client';
import type { Task, Lead, AgentMemory, Approval, KnowledgeEntry, ActivityEvent, SettingsState, McpServer } from './data';
import { INITIAL_TASKS, INITIAL_LEADS, KNOWLEDGE_SEED, AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD } from './data';

/** Composio action names/apps that move money or reach a third party — held for human approval in autonomous mode. */
const SENSITIVE_ACTION_RE = /SEND_EMAIL|SEND_MESSAGE|SEND_DM|POST_MESSAGE|CREATE_MESSAGE|SEND_SMS|SEND_INVITE|PAYMENT|PAYOUT|TRANSFER|CHARGE|REFUND|WITHDRAW|PAY_/i;
const SENSITIVE_APP_RE = /stripe|paypal|wise|plaid|mercury|square|venmo/i;

function isSensitiveComposioAction(app: string, action: string, parameters: Record<string, unknown>): boolean {
  if (SENSITIVE_ACTION_RE.test(action)) return true;
  if (SENSITIVE_APP_RE.test(app)) return true;
  const amount = Number((parameters as { amount?: unknown }).amount);
  return Number.isFinite(amount) && amount >= AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD;
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
      return { ok: true, data: { id: mem.id, kind: mem.kind } };
    }

    case 'search_knowledge': {
      const kb = (await getBorgaState<KnowledgeEntry[]>(key('knowledge'))) ?? KNOWLEDGE_SEED;
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

    case 'run_workflow': {
      const workflowName = String(params.workflowName ?? 'unnamed').slice(0, 100);
      await appendActivity(agentId, agentName, ws, userId, 'sync', `Triggered workflow: "${workflowName}"`);
      return { ok: true, data: { workflow: workflowName, status: 'triggered' } };
    }

    case 'query_state': {
      const entity = String(params.entity ?? '');
      const filter = String(params.filter ?? '').toLowerCase();
      const ALLOWED = new Set(['tasks', 'leads', 'agents', 'finance', 'memories', 'ops', 'goals', 'kpis', 'fundraising', 'mcpServers']);
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

      if (isSensitiveComposioAction(app, action, parameters)) {
        const settings = await getBorgaState<SettingsState>(key('settings'));
        if (settings?.autonomousMode) {
          const approvals = (await getBorgaState<Approval[]>(key('approvals'))) ?? [];
          const approval: Approval = {
            id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            title: `Autonomous action approval — ${action} on ${app}`,
            description: `Agent ${agentName} attempted to run "${action}" on ${app}, which sends information or moves money to a third party. Held for sign-off before it leaves the company.`,
            category: 'spend',
            amount: Number((parameters as { amount?: unknown }).amount) || 0,
            status: 'pending',
            submittedBy: agentName,
            createdAt: 'Just now',
            pendingComposio: { app, action, parameters, entityId },
          };
          await setBorgaState(key('approvals'), [approval, ...approvals].slice(0, 100));
          await appendActivity(
            agentId, agentName, ws, userId, 'system',
            `Held "${action}" on ${app} for approval — autonomous mode is on.`,
          );
          return { ok: true, data: { status: 'pending_approval', approvalId: approval.id } };
        }
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
      let token: string | undefined;
      if (server.authType !== 'none') {
        const enc = await getBorgaState<string>(key(`mcp_token:${server.id}`));
        token = enc ? decryptSecret(enc) || undefined : undefined;
        if (!token) return { ok: false, error: `"${server.name}" requires authentication but has no token saved — connect it in Integrations → MCP Servers.` };
      }
      const result = await mcpCallTool(server.url, token, toolName, toolParams);
      if (!result.ok) return { ok: false, error: `MCP call to "${server.name}"."${toolName}" failed: ${result.error}` };
      await appendActivity(agentId, agentName, ws, userId, 'task', `Called MCP tool ${toolName} on ${server.name}`);
      return { ok: true, data: result.result };
    }

    default:
      return { ok: false, error: `Unknown tool: "${toolName}". Use one of: create_task, update_task, update_lead, store_memory, search_knowledge, browse_web, web_search, web_crawl, web_research, run_workflow, query_state, log_activity, create_approval, handoff, list_composio_actions, composio_action, mcp_call` };
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
