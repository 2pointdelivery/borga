import 'server-only';

import type { Composio } from '@composio/core';

/**
 * Composio sessions (`@composio/core`) — the interactive-agent surface.
 *
 * A session is the runtime context for one tenant: we scope it to the
 * workspace id (the app's existing identity — no parallel user system), and
 * a fresh session is created per call because sessions are not persisted.
 * The REST proxy remains the source of truth for connection status; sessions
 * supplement interactive flows (agents, marketing) with tool discovery and
 * runtime Connect Links via the meta tools.
 *
 * Lazy-imported: the server never pays the SDK until something uses it.
 */
let client: Composio | null = null;

async function clientOrNull(): Promise<Composio | null> {
  if (!process.env.COMPOSIO_API_KEY?.trim()) return null;
  if (client) return client;
  try {
    const mod = await import('@composio/core');
    client = new mod.Composio();
    return client;
  } catch {
    return null;
  }
}

/** A fresh session for one tenant. Returns null when no key or SDK is available. Callers fall back to REST. */
export async function composioWorkspaceSession(workspaceId: string) {
  const c = await clientOrNull();
  if (!c) return null;
  try {
    return await c.create(workspaceId, { manageConnections: { waitForConnections: true } });
  } catch {
    return null;
  }
}
