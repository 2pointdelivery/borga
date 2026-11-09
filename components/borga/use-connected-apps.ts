'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBorga } from '@/lib/borga/store';
import { normalizeAccount, toolkitStatus, type ComposioAccountRef } from '@/lib/borga/connected-apps';
import { useComposioReady } from './use-composio-ready';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

/**
 * Live Composio connection state shared by every surface (Inbox, Social,
 * Tools, Banking). Composio's connected_accounts is the authority; on every
 * successful load each toolkit seen is mirror-synced through the single
 * `syncToolkitConnection` store action, so connecting an app once is
 * reflected everywhere instead of each tab keeping its own copy.
 */
export function useConnectedApps(entityId?: string) {
  const { composio, activeWorkspaceId, syncToolkitConnection } = useBorga();
  const { ready } = useComposioReady();
  const [apps, setApps] = useState<Record<string, { connected: boolean; accountId?: string }>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!ready) return null;
    setLoading(true);
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          action: 'accounts',
          entityId: entityId ?? activeWorkspaceId ?? 'default',
          ...(composio.apiKey ? { apiKey: composio.apiKey } : {}),
        }),
      });
      const d = (await res.json()) as { ok: boolean; accounts?: Record<string, unknown>[] };
      if (!d.ok || !Array.isArray(d.accounts)) return null;
      const refs: ComposioAccountRef[] = d.accounts.map(normalizeAccount);
      const map: Record<string, { connected: boolean; accountId?: string }> = {};
      for (const ref of refs) {
        if (!ref.appName) continue;
        const st = toolkitStatus(refs, ref.appName);
        map[ref.appName] = { connected: st.connected, accountId: st.accountId };
        // Single mirror-sync: connection card + composio record + inbox channel.
        syncToolkitConnection(ref.appName, st.connected, st.accountId);
      }
      setApps(map);
      return map;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [ready, entityId, activeWorkspaceId, composio.apiKey, syncToolkitConnection]);

  useEffect(() => {
    void load();
  }, [load]);

  return { apps, loading, refresh: load };
}
