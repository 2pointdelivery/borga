'use client';

import { useEffect, useState } from 'react';
import { useBorga } from '@/lib/borga/store';

/**
 * Is Composio usable right now? A per-workspace key saved under Integrations
 * counts — and so does a server-side COMPOSIO_API_KEY (the proxy falls back
 * to it), which the dashboard otherwise cannot see. UIs gate Composio buttons
 * on this instead of only the store key, so an env-configured key works
 * across Banking, Inbox, Tools and Marketing with nothing saved in the UI.
 */
export function useComposioReady(): { ready: boolean; viaServer: boolean; checking: boolean; keyInvalid: boolean } {
  const storeKey = useBorga((s) => s.composio.apiKey);
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const [keyInvalid, setKeyInvalid] = useState(false);

  useEffect(() => {
    if (storeKey) return;
    let alive = true;
    void fetch('/api/borga/composio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'validate' }),
    })
      .then((r) => r.json())
      .then((j: { connected?: boolean; keyInvalid?: boolean }) => {
        if (!alive) return;
        setServerKey(!!j.connected);
        setKeyInvalid(!!j.keyInvalid);
      })
      .catch(() => { if (alive) setServerKey(false); });
    return () => { alive = false; };
  }, [storeKey]);

  if (storeKey) return { ready: true, viaServer: false, checking: false, keyInvalid: false };
  if (serverKey === null) return { ready: false, viaServer: false, checking: true, keyInvalid: false };
  return { ready: serverKey, viaServer: serverKey, checking: false, keyInvalid };
}
