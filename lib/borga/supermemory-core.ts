import { createHash } from 'crypto';

/**
 * Pure helpers for the Supermemory integration: container tags, request bodies and
 * data minimisation. No I/O, so every rule here is unit-tested.
 * API reference: https://api.supermemory.ai/v4/openapi
 */

export const SM_DEFAULT_BASE = 'https://api.supermemory.ai';
/** Overridable (SUPERMEMORY_BASE_URL) for self-hosting, proxies and local tests. */
export const smBase = (): string => (process.env.SUPERMEMORY_BASE_URL || SM_DEFAULT_BASE).replace(/\/+$/, '');
export type SmSource = 'agent-memory' | 'kb' | 'ticket';

const TAG_RE = /^[a-zA-Z0-9_:-]+$/;
const MAX_TAG = 100;

/**
 * One container per user+workspace: strict isolation, never queried across tags.
 * Agents/sources are separated with metadata, not extra tags.
 */
export function containerTag(userId: string, ws: string): string {
  const tag = `borga_${userId}_${ws}`;
  if (!TAG_RE.test(tag) || tag.length > MAX_TAG) throw new Error('Invalid container tag inputs');
  return tag;
}

export interface SmAddBody {
  content: string;
  containerTag: string;
  customId: string;
  taskType: 'memory' | 'superrag';
  metadata: Record<string, string | number | boolean | string[]>;
  entityContext?: string;
  documentDate?: string;
}

const MAX_CONTENT = 9_500; // API limit is 10,000 per memory

const clip = (s: string, n = MAX_CONTENT) => (s.length > n ? s.slice(0, n) : s);

/** Replaces e-mail addresses so personal contact details never leave the system. */
export function redactEmails(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
}

export interface MemoryLike {
  id: string;
  content: string;
  kind: string;
  tags: string[];
  agentId: string;
  agentName: string;
}

export const memoryCustomId = (id: string) => `mem:${id}`;
export const kbCustomId = (id: string) => `kb:${id}`;
export const ticketCustomId = (id: string) => `ticket:${id}`;

export function memoryDoc(tag: string, m: MemoryLike, now = new Date()): SmAddBody {
  return {
    content: clip(m.content),
    containerTag: tag,
    customId: memoryCustomId(m.id),
    taskType: 'memory',
    metadata: { source: 'agent-memory', agentId: m.agentId, kind: m.kind, tags: m.tags.slice(0, 10) },
    entityContext: clip(`A durable ${m.kind} recorded by the company's AI agent ${m.agentName} while working for the business.`, 1500),
    documentDate: now.toISOString(),
  };
}

export interface KbLike {
  id: string;
  title: string;
  answer: string;
}

export function kbDoc(tag: string, e: KbLike): SmAddBody {
  return {
    content: clip(`${e.title}\n\n${e.answer}`),
    containerTag: tag,
    customId: kbCustomId(e.id),
    taskType: 'superrag',
    metadata: { source: 'kb', title: e.title.slice(0, 200) },
  };
}

export interface TicketLike {
  id: string;
  subject: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  labels: string[];
  resolvedAt: string | null;
  comments: Array<{ kind: 'public' | 'internal' | 'email-in' | 'system'; body: string }>;
}

/**
 * A resolved ticket as a searchable document. Requester name/email are NOT included and any
 * address inside the text is redacted, so past tickets can ground future replies without
 * exporting customers' contact details.
 */
export function ticketDoc(tag: string, t: TicketLike): SmAddBody {
  const thread = t.comments
    .filter((c) => c.kind !== 'system')
    .slice(-8)
    .map((c) => `${c.kind === 'email-in' ? 'Customer' : c.kind === 'internal' ? 'Internal note' : 'Agent reply'}: ${c.body.slice(0, 900)}`)
    .join('\n\n');
  const body = [`Ticket ${t.id}: ${t.subject}`, `Type: ${t.type}. Priority: ${t.priority}.`, `Problem:\n${t.description.slice(0, 2000)}`, thread && `Resolution thread:\n${thread}`].filter(Boolean).join('\n\n');
  return {
    content: clip(redactEmails(body)),
    containerTag: tag,
    customId: ticketCustomId(t.id),
    taskType: 'superrag',
    metadata: { source: 'ticket', ticketId: t.id, ticketType: t.type, priority: t.priority, labels: t.labels.slice(0, 8) },
    documentDate: t.resolvedAt ?? undefined,
  };
}

export const contentHash = (s: string): string => createHash('sha1').update(s).digest('hex');

/** Circuit breaker: open after 3 consecutive failures, closed again after 60 s. */
export interface Breaker {
  failures: number;
  openUntil: number;
}
export const BREAKER_THRESHOLD = 3;
export const BREAKER_OPEN_MS = 60_000;

export function breakerAllows(b: Breaker, now: number): boolean {
  return b.openUntil <= now;
}
export function breakerRecord(b: Breaker, ok: boolean, now: number): Breaker {
  if (ok) return { failures: 0, openUntil: 0 };
  const failures = b.failures + 1;
  return { failures, openUntil: failures >= BREAKER_THRESHOLD ? now + BREAKER_OPEN_MS : b.openUntil };
}

/** Outbox retry delay: 1 min, 2, 4 ... capped at 1 h; give up after 12 attempts. */
export const OUTBOX_MAX_ATTEMPTS = 12;
export function outboxDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

export interface SmMemoryHit {
  memory: string;
  score: number;
  isLatest?: boolean;
  isForgotten?: boolean;
}

/** Keeps current, non-forgotten facts, best first, without near-duplicates. */
export function pickFacts(results: SmMemoryHit[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...results].sort((a, b) => b.score - a.score)) {
    if (r.isForgotten || r.isLatest === false) continue;
    const m = r.memory.trim();
    const key = m.toLowerCase().replace(/\s+/g, ' ');
    if (!m || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

export interface SmDocHit {
  documentId: string;
  title: string | null;
  score: number;
  chunks?: Array<{ content: string; score?: number }>;
  content?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Turns /v3/search results into short, prompt-ready passages. */
export function docPassages(results: SmDocHit[], limit: number, maxChars = 700): Array<{ id: string; title: string; text: string; score: number; metadata: Record<string, unknown> }> {
  return results.slice(0, limit).map((r) => {
    const text = (r.chunks?.length ? r.chunks.map((c) => c.content).join('\n') : r.content ?? r.summary ?? '').trim();
    return { id: r.documentId, title: (r.title ?? '').trim() || String(r.metadata?.title ?? ''), text: text.slice(0, maxChars), score: r.score, metadata: r.metadata ?? {} };
  }).filter((p) => p.text);
}

export interface SmProfileBucketEntry {
  memory: string;
  isStatic?: boolean;
}

/** Flattens profile buckets to at most `limit` distinct facts (static facts first). */
export function flattenProfile(buckets: Record<string, SmProfileBucketEntry[]> | undefined, limit: number): string[] {
  const all = Object.values(buckets ?? {}).flat();
  all.sort((a, b) => Number(!!b.isStatic) - Number(!!a.isStatic));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of all) {
    const m = e.memory?.trim();
    if (!m || seen.has(m.toLowerCase())) continue;
    seen.add(m.toLowerCase());
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}
