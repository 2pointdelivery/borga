'use client';

import { useCallback, useRef } from 'react';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { normalizeAccount, type ComposioAccountRef } from '@/lib/borga/connected-apps';
import type { AppConnection } from '@/lib/borga/data';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

/** "google-calendar", "google_calendar" and "googlecalendar" are the same app. */
export const appKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type Result = { ok: boolean; error?: string; [k: string]: unknown };

/**
 * What a person can do with a connected app: check it, refresh it, reconnect it (a fresh sign-in), or disconnect it. They work on the
 * real account at Composio. (The card's own id used to be sent as the account id, which Composio does not know, so a disconnect only
 * ever changed the card and the next sync switched the app back on.)
 */
export function useConnectionActions() {
  const { composio, connectApp, removeComposioConnection, syncToolkitConnection, log } = useBorga();
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const call = useCallback(async (body: Record<string, unknown>): Promise<Result> => {
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ ...body, ...(composio.apiKey ? { apiKey: composio.apiKey } : {}), ...(composio.baseUrl ? { baseUrl: composio.baseUrl } : {}) }),
      });
      return (await res.json().catch(() => ({ ok: false, error: 'Bad response' }))) as Result;
    } catch {
      return { ok: false, error: 'Could not reach the server.' };
    }
  }, [composio.apiKey, composio.baseUrl]);

  /** Every account the company has at Composio for one app, in any state. */
  const accountsOf = useCallback(async (provider: string): Promise<{ ok: boolean; accounts: ComposioAccountRef[]; error?: string }> => {
    const r = await call({ action: 'accounts' });
    if (!r.ok || !Array.isArray(r.accounts)) return { ok: false, accounts: [], error: r.error };
    const all = (r.accounts as Record<string, unknown>[]).map(normalizeAccount);
    return { ok: true, accounts: all.filter((a) => appKey(a.appName) === appKey(provider)) };
  }, [call]);

  /** Asks Composio whether the app is really connected, and shows what it says. */
  const check = useCallback(async (conn: AppConnection) => {
    const r = await accountsOf(conn.provider);
    if (!r.ok) return toast({ title: `Could not check ${conn.label}`, description: r.error ?? 'Try again.', variant: 'error' });
    const active = r.accounts.find((a) => a.status.toUpperCase() === 'ACTIVE');
    if (active) {
      connectApp(conn.id, { status: 'connected', lastSync: 'Checked just now' });
      syncToolkitConnection(conn.provider, true, active.id);
      toast({ title: `${conn.label} is connected`, variant: 'success' });
    } else {
      const state = r.accounts[0]?.status;
      connectApp(conn.id, { status: 'error', lastSync: state ? `Provider says: ${state.toLowerCase()}` : 'Not connected at the provider' });
      toast({ title: `${conn.label} needs to be reconnected`, description: state ? `Its status is ${state.toLowerCase()}.` : 'There is no active connection. Use Reconnect.', variant: 'warning' });
    }
  }, [accountsOf, connectApp, syncToolkitConnection]);

  /** Starts a fresh sign-in for the app and waits for it to finish. This is also how an expired or broken connection is repaired. */
  const reconnect = useCallback(async (conn: AppConnection) => {
    if (polling.current) clearInterval(polling.current);
    connectApp(conn.id, { status: 'connecting', lastSync: 'Waiting for sign-in…' });
    const r = await call({ action: 'connect', appName: appKey(conn.provider), entityId: 'default' });
    const conn2 = r.connection as { redirectUrl?: string; redirect_url?: string } | undefined;
    const url = conn2?.redirectUrl ?? conn2?.redirect_url;
    if (!r.ok || !url) {
      connectApp(conn.id, { status: 'error', lastSync: 'Could not start the sign-in' });
      return toast({ title: `Could not reconnect ${conn.label}`, description: r.error ?? 'No sign-in address came back.', variant: 'error' });
    }
    window.open(url, '_blank', 'noopener,noreferrer,width=640,height=720');
    toast({ title: `Sign in to ${conn.label}`, description: 'Finish in the window that opened. This updates by itself.', variant: 'success' });
    let polls = 0;
    polling.current = setInterval(async () => {
      polls += 1;
      const got = await accountsOf(conn.provider);
      const active = got.accounts.find((a) => a.status.toUpperCase() === 'ACTIVE');
      if (active) {
        if (polling.current) clearInterval(polling.current);
        connectApp(conn.id, { status: 'connected', account: 'OAuth authorized', lastSync: 'Reconnected just now' });
        syncToolkitConnection(conn.provider, true, active.id);
        log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'sync', message: `${conn.label} reconnected.` });
      } else if (polls >= 45) {
        if (polling.current) clearInterval(polling.current);
        connectApp(conn.id, { status: 'error', lastSync: 'Sign-in was not completed' });
      }
    }, 2000);
  }, [accountsOf, call, connectApp, log, syncToolkitConnection]);

  /** Renews the connection's token. When there is nothing to renew (it has expired or been revoked) it starts a fresh sign-in instead. */
  const refresh = useCallback(async (conn: AppConnection) => {
    const got = await accountsOf(conn.provider);
    const active = got.accounts.find((a) => a.status.toUpperCase() === 'ACTIVE' && a.id);
    if (!got.ok || !active?.id) return reconnect(conn);
    const r = await call({ action: 'refreshToken', connectionId: active.id });
    if (r.ok) {
      connectApp(conn.id, { status: 'connected', lastSync: 'Refreshed just now' });
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'sync', message: `Refreshed the connection to ${conn.label}.` });
      toast({ title: `${conn.label} refreshed`, variant: 'success' });
    } else {
      toast({ title: `Could not refresh ${conn.label}`, description: 'Signing in again instead.', variant: 'warning' });
      await reconnect(conn);
    }
  }, [accountsOf, call, connectApp, log, reconnect]);

  /** Ends the connection at Composio (every account the company has for the app) and on the card. Nothing is switched off if Composio refuses. */
  const disconnect = useCallback(async (conn: AppConnection) => {
    if (polling.current) clearInterval(polling.current);
    const got = await accountsOf(conn.provider);
    if (!got.ok) return toast({ title: `Could not disconnect ${conn.label}`, description: got.error ?? 'Try again.', variant: 'error' });
    let failed = 0;
    for (const a of got.accounts) {
      if (!a.id) continue;
      const r = await call({ action: 'disconnect', connectionId: a.id });
      if (!r.ok) failed += 1;
    }
    if (failed) return toast({ title: `Could not fully disconnect ${conn.label}`, description: `${failed} connection${failed === 1 ? '' : 's'} could not be removed at the provider. Try again, or revoke access in ${conn.label}'s own settings.`, variant: 'error' });
    connectApp(conn.id, { status: 'off', lastSync: '…', account: '' });
    removeComposioConnection(conn.provider);
    syncToolkitConnection(conn.provider, false);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Disconnected ${conn.label}.` });
    toast({ title: `${conn.label} disconnected`, description: 'You can connect it again at any time.', variant: 'success' });
  }, [accountsOf, call, connectApp, log, removeComposioConnection, syncToolkitConnection]);

  return { check, refresh, reconnect, disconnect };
}
