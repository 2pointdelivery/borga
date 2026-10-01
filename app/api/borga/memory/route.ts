import { NextResponse, type NextRequest } from 'next/server';
import { getBorgaState, setBorgaState, scopedKey } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import type { AgentMemory, MemoryKind } from '@/lib/borga/data';
import { mirrorMemory, unmirrorMemories } from '@/lib/borga/supermemory-mirror';

export const runtime = 'nodejs';

const MAX_MEMORIES = 500;

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

function isValidWsId(ws: unknown): ws is string {
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
}

// Tier 4: memories live in the SAME scoped key the dashboard, tools, and
// agent-context use (per-user per-workspace), so a fact stored in one session
// is visible after restart — never a global shadow copy.
function memKey(ws: string | null, userId: string | null): string {
  return ws && userId ? userWsKey(userId, ws, 'memories') : scopedKey(ws, 'memories');
}

async function loadMemories(ws: string | null, userId: string | null): Promise<AgentMemory[]> {
  return (await getBorgaState<AgentMemory[]>(memKey(ws, userId))) ?? [];
}

async function saveMemories(memories: AgentMemory[], ws: string | null, userId: string | null): Promise<boolean> {
  return setBorgaState(memKey(ws, userId), memories);
}

// GET /api/borga/memory — list memories, optional ?agentId=&kind=&tag=&q=&ws=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') ?? '';
  const kind = searchParams.get('kind') as MemoryKind | '';
  const tag = searchParams.get('tag') ?? '';
  const q = (searchParams.get('q') ?? '').toLowerCase();
  const limitParam = parseInt(searchParams.get('limit') ?? '100', 10);
  const limit = isNaN(limitParam) || limitParam < 1 ? 100 : Math.min(limitParam, 500);
  const wsParam = searchParams.get('ws');
  const ws = isValidWsId(wsParam) ? wsParam : null;
  const userId = await getUserId(req);

  const memories = await loadMemories(ws, userId);
  const filtered = memories.filter((m) => {
    if (agentId && m.agentId !== agentId) return false;
    if (kind && m.kind !== kind) return false;
    if (tag && !m.tags.includes(tag)) return false;
    if (q && !m.content.toLowerCase().includes(q) && !m.tags.join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  return NextResponse.json({ ok: true, memories: filtered.slice(0, limit), total: filtered.length });
}

// POST /api/borga/memory — store | delete | clear (body.ws scopes the store)
export async function POST(req: NextRequest) {
  const csrfHeader = req.headers.get('X-Borga-Client');
  if (csrfHeader !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }
  const userId = await getUserId(req);

  let body: {
    action?: string;
    memory?: Partial<AgentMemory>;
    id?: string;
    agentId?: string;
    ws?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body.' }, { status: 400 });
  }

  const action = body.action ?? 'store';
  const ws = isValidWsId(body.ws) ? body.ws : null;
  const memories = await loadMemories(ws, userId);

  if (action === 'store') {
    const m = body.memory;
    if (!m?.content?.trim() || !m?.agentId || !m?.kind) {
      return NextResponse.json({ ok: false, error: 'content, agentId and kind are required.' }, { status: 400 });
    }
    const VALID_KINDS: MemoryKind[] = ['fact', 'context', 'instruction', 'observation'];
    if (!VALID_KINDS.includes(m.kind as MemoryKind)) {
      return NextResponse.json({ ok: false, error: 'Invalid kind.' }, { status: 400 });
    }
    const now = new Date().toISOString();
    const newMemory: AgentMemory = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      agentId: m.agentId,
      agentName: m.agentName ?? m.agentId,
      kind: m.kind as MemoryKind,
      content: m.content.trim().slice(0, 2000),
      tags: Array.isArray(m.tags) ? m.tags.map(String).slice(0, 10) : [],
      confidence: typeof m.confidence === 'number' ? Math.min(100, Math.max(0, m.confidence)) : 80,
      createdAt: now,
      lastAccessed: now,
    };
    const updated = [newMemory, ...memories].slice(0, MAX_MEMORIES);
    await saveMemories(updated, ws, userId);
    if (userId && ws) void mirrorMemory(userId, ws, newMemory);
    return NextResponse.json({ ok: true, action: 'store', memory: newMemory });
  }

  if (action === 'delete') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const updated = memories.filter((m) => m.id !== body.id);
    await saveMemories(updated, ws, userId);
    if (userId && ws && body.id) void unmirrorMemories(userId, ws, [body.id]);
    return NextResponse.json({ ok: true, action: 'delete', deleted: memories.length - updated.length });
  }

  if (action === 'clear') {
    const agentId = body.agentId ?? '';
    const updated = agentId ? memories.filter((m) => m.agentId !== agentId) : [];
    await saveMemories(updated, ws, userId);
    if (userId && ws) void unmirrorMemories(userId, ws, memories.filter((m) => !updated.includes(m)).map((m) => m.id));
    return NextResponse.json({ ok: true, action: 'clear', deleted: memories.length - updated.length });
  }

  if (action === 'access') {
    // Update lastAccessed timestamp for a memory (called when an agent reads it).
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const now = new Date().toISOString();
    const updated = memories.map((m) => m.id === body.id ? { ...m, lastAccessed: now } : m);
    await saveMemories(updated, ws, userId);
    return NextResponse.json({ ok: true, action: 'access' });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
