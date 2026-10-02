'use client';

import { useEffect, useRef } from 'react';
import { toast } from '@/lib/toast-bus';
import { useBorga } from '@/lib/borga/store';

/**
 * The user comes back from their bank (Salt Edge sends them to /app?saltedge=return). Once the dashboard has loaded, ask the server
 * for the connection they just made (it checks with Salt Edge, it never trusts the address bar), merge the accounts and
 * transactions into the books, and take them to Banking.
 */
export function useSaltEdgeReturn(onDone: () => void) {
  const { loadedWorkspaceId, activeWorkspaceId, activeWorkspace, importBankFeed } = useBorga();
  const done = useRef(false);

  useEffect(() => {
    // wait until this company's data is fully in: importing earlier would be overwritten by the load that is still running
    if (!loadedWorkspaceId || loadedWorkspaceId !== activeWorkspaceId || done.current || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('saltedge') !== 'return') return;
    done.current = true;
    const connectionId = url.searchParams.get('connection_id') ?? undefined;
    const failed = url.searchParams.get('error_class');
    // remove the parameters first, so a reload does not repeat this
    url.searchParams.delete('saltedge'); url.searchParams.delete('connection_id'); url.searchParams.delete('error_class'); url.searchParams.delete('error_message');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
    if (failed) {
      toast({ title: 'The bank connection did not finish', description: `Salt Edge reported: ${failed}. You can try again from Banking.`, variant: 'error' });
      onDone();
      return;
    }
    void (async () => {
      try {
        const r = await fetch('/api/borga/saltedge', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ ws: activeWorkspaceId, action: 'complete', connectionId, currency: activeWorkspace()?.currency ?? 'USD' }),
        });
        const j = (await r.json()) as { ok: boolean; error?: string; feed?: never };
        if (!j.ok || !j.feed) throw new Error(j.error ?? 'Salt Edge request failed.');
        const stats = importBankFeed(j.feed);
        toast({ title: 'Bank connected', description: `${stats.accountsAdded} account${stats.accountsAdded === 1 ? '' : 's'} and ${stats.txnsAdded} transaction${stats.txnsAdded === 1 ? '' : 's'} imported. Reconcile them under Banking.`, variant: 'success' });
      } catch (e) {
        toast({ title: 'Could not import from the bank', description: (e as Error).message, variant: 'error' });
      }
      onDone();
    })();
  }, [loadedWorkspaceId, activeWorkspaceId, activeWorkspace, importBankFeed, onDone]);
}
