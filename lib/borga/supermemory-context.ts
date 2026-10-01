import 'server-only';
import { smPassages, smProfileFacts, smRecall, smContext, type Passage } from './supermemory';

/**
 * Everything the prompt builders want from Supermemory in one call. The three lookups run in
 * parallel with short timeouts, and any failure yields "nothing", so prompts are built exactly
 * as before when the integration is off, slow or down.
 */

export interface SmPromptContext {
  /** Semantically relevant long-term facts (agent memory). */
  recalled: string[];
  /** Standing facts about the company/user. */
  profile: string[];
  /** Relevant knowledge-base passages, or null to keep using the full local list. */
  kbPassages: Passage[] | null;
}

export const EMPTY_SM_CONTEXT: SmPromptContext = { recalled: [], profile: [], kbPassages: null };

/** Retrieval only pays off once the KB no longer fits comfortably in a prompt. */
export const KB_RETRIEVAL_MIN_ENTRIES = 12;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Drops recalled facts that merely repeat a local memory. */
export function dedupeAgainst(recalled: string[], local: string[]): string[] {
  const hay = local.map(norm);
  return recalled.filter((r) => {
    const n = norm(r);
    return !hay.some((h) => h.includes(n) || n.includes(h));
  });
}

export async function smPromptContext(u: string, ws: string, query: string, opts: { localMemories: string[]; kbEntryCount: number }): Promise<SmPromptContext> {
  const ctx = await smContext(u, ws);
  if (!ctx) return EMPTY_SM_CONTEXT;
  const useKb = opts.kbEntryCount > KB_RETRIEVAL_MIN_ENTRIES;
  const [recalled, profile, kbPassages] = await Promise.all([
    smRecall(u, ws, query, 12),
    smProfileFacts(u, ws, 10),
    useKb ? smPassages(u, ws, 'knowledge', 'kb', query, 8) : Promise.resolve(null),
  ]);
  return { recalled: dedupeAgainst(recalled, opts.localMemories), profile, kbPassages: kbPassages && kbPassages.length ? kbPassages : null };
}

/**
 * Knowledge-base text for a chat turn: the most relevant passages when the KB is large and indexed,
 * otherwise the same "first 40 entries" list chat always used.
 */
export async function kbFactsFor(userId: string | null, ws: string | null, kb: Array<{ title: string; answer: string }>, query: string): Promise<string> {
  const full = () => kb.slice(0, 40).map((e) => `- ${e.title}: ${e.answer}`).join('\n');
  if (!userId || !ws || kb.length <= KB_RETRIEVAL_MIN_ENTRIES) return full();
  try {
    const passages = await smPassages(userId, ws, 'knowledge', 'kb', query, 8);
    return passages && passages.length ? passages.map((p) => '- ' + (p.title ? p.title + ': ' : '') + p.text).join('\n') : full();
  } catch {
    return full();
  }
}
