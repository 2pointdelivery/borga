import 'server-only';
import { smAdd, smRemove } from './supermemory';
import { memoryCustomId, memoryDoc } from './supermemory-core';
import type { AgentMemory } from './data';

/** Mirrors Borga's own agent-memory store into Supermemory. Fire-and-forget; never throws. */

export async function mirrorMemory(userId: string, ws: string, mem: AgentMemory): Promise<void> {
  try {
    await smAdd(userId, ws, 'memory', (tag) => memoryDoc(tag, mem));
  } catch (e) {
    console.warn('[supermemory] mirror failed', (e as Error).message);
  }
}

/** Deleting a memory in Borga also deletes its mirrored copy, so nothing lingers in the third-party store. */
export async function unmirrorMemories(userId: string, ws: string, ids: string[]): Promise<void> {
  try {
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map((id) => smRemove(userId, ws, 'memory', memoryCustomId(id))));
    }
  } catch (e) {
    console.warn('[supermemory] unmirror failed', (e as Error).message);
  }
}
