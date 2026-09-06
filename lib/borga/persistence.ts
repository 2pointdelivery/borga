import 'server-only';
import { eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { borgaState } from '@/db/schemas/borga';

/**
 * Borga persistence layer. Reads/writes JSON documents to Postgres keyed by
 * entity name with production-ready retry logic, error handling, and migration support.
 */

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const WS_PREFIX = 'ws::';

/**
 * Workspace-scoped state key. Server routes use this to keep every entity
 * isolated per company; `null`/undefined ws falls back to the legacy global key.
 */
export function scopedKey(ws: string | null | undefined, entity: string): string {
  const valid = typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
  return valid ? `${WS_PREFIX}${ws}::${entity}` : entity;
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Borga persistence ${operationName} attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`Borga persistence ${operationName} failed after ${MAX_RETRIES} attempts:`, lastError);
  throw lastError;
}

export async function getBorgaState<T>(key: string): Promise<T | null> {
  try {
    const rows = await retryWithBackoff(
      () => db.select().from(borgaState).where(eq(borgaState.key, key)).limit(1),
      `getBorgaState(${key})`
    );
    return (rows[0]?.value as T | undefined) ?? null;
  } catch (error) {
    console.error(`Failed to retrieve borga state for key "${key}":`, error);
    return null;
  }
}

export async function setBorgaState<T>(key: string, value: T): Promise<boolean> {
  try {
    await retryWithBackoff(
      () => db
        .insert(borgaState)
        .values({ key, value, updatedAt: new Date() })
        .onDuplicateKeyUpdate({ 
          set: { value, updatedAt: new Date() } 
        }),
      `setBorgaState(${key})`
    );
    return true;
  } catch (error) {
    console.error(`Failed to set borga state for key "${key}":`, error);
    return false;
  }
}

export async function deleteBorgaState(key: string): Promise<boolean> {
  try {
    await retryWithBackoff(
      () => db.delete(borgaState).where(eq(borgaState.key, key)),
      `deleteBorgaState(${key})`
    );
    return true;
  } catch (error) {
    console.error(`Failed to delete borga state for key "${key}":`, error);
    return false;
  }
}

export async function getAllBorgaStates(): Promise<Record<string, unknown>> {
  try {
    const rows = await retryWithBackoff(
      () => db.select().from(borgaState),
      'getAllBorgaStates'
    );
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, unknown>);
  } catch (error) {
    console.error('Failed to retrieve all borga states:', error);
    return {};
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await db.select({ key: borgaState.key }).from(borgaState).limit(1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads all state rows whose key starts with `prefix`. Used to scope a user's
 * bulk fetch to only their own entities (workspaces registry, or one company).
 */
export async function getBorgaStatesByPrefix(prefix: string): Promise<Record<string, unknown>> {
  try {
    const rows = await retryWithBackoff(
      () => db.select().from(borgaState).where(like(borgaState.key, `${prefix}%`)),
      'getBorgaStatesByPrefix',
    );
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, unknown>);
  } catch (error) {
    console.error('Failed to retrieve borga states by prefix:', error);
    return {};
  }
}
