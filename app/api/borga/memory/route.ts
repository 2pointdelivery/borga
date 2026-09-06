import { NextResponse } from 'next/server';
import { getAllBorgaStates, setBorgaState } from '@/lib/borga/persistence';
import type { AgentMemory, MemoryKind } from '@/lib/borga/data';

export const runtime = 'nodejs';

const MAX_MEMORIES = 500;

async function loadMemories(): Promise<AgentMemory[]> {
  const all = await getAllBorgaStates();
  return (all['memories'] as AgentMemory[] | undefined) ?? [];
}

async function saveMemories(memories: AgentMemory[]): Promise<boolean> {
  return setBorgaState('memories', memories);
}

// GET /api/borga/memory — list memories, optional ?agentId=&kind=&tag=&q=
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') ?? '';
  const kind = searchParams.get('kind') as MemoryKind | '';
  const tag = searchParams.get('tag') ?? '';
  const q = (searchParams.get('q') ?? '').toLowerCase();
  const limitParam = parseInt(searchParams.get('limit') ?? '100', 10);
  const limit = isNaN(limitParam) || limitParam < 1 ? 100 : Math.min(limitParam, 500);

  const memories = await loadMemories();
  const filtered = memories.filter((m) => {
    if (agentId && m.agentId !== agentId) return false;
    if (kind && m.kind !== kind) return false;
    if (tag && !m.tags.includes(tag)) return false;
    if (q && !m.content.toLowerCase().includes(q) && !m.tags.join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  return NextResponse.json({ ok: true, memories: filtered.slice(0, limit), total: filtered.length });
}

// POST /api/borga/memory — store | delete | clear
export async function POST(req: Request) {
  const csrfHeader = req.headers.get('X-Borga-Client');
  if (csrfHeader !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  let body: {
    action?: string;
    memory?: Partial<AgentMemory>;
    id?: string;
    agentId?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body.' }, { status: 400 });
  }

  const action = body.action ?? 'store';
  const memories = await loadMemories();

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
    await saveMemories(updated);
    return NextResponse.json({ ok: true, action: 'store', memory: newMemory });
  }

  if (action === 'delete') {
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const updated = memories.filter((m) => m.id !== body.id);
    await saveMemories(updated);
    return NextResponse.json({ ok: true, action: 'delete', deleted: memories.length - updated.length });
  }

  if (action === 'clear') {
    const agentId = body.agentId ?? '';
    const updated = agentId ? memories.filter((m) => m.agentId !== agentId) : [];
    await saveMemories(updated);
    return NextResponse.json({ ok: true, action: 'clear', deleted: memories.length - updated.length });
  }

  if (action === 'access') {
    // Update lastAccessed timestamp for a memory (called when an agent reads it).
    if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
    const now = new Date().toISOString();
    const updated = memories.map((m) => m.id === body.id ? { ...m, lastAccessed: now } : m);
    await saveMemories(updated);
    return NextResponse.json({ ok: true, action: 'access' });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
