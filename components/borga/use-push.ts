'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBorga } from '@/lib/borga/store';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(base64.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushState =
  | { supported: false }
  | { supported: true; permission: NotificationPermission; configured: boolean; subscribed: boolean; count: number; busy: boolean; error: string | null };

/**
 * Browser push subscription state for the active workspace. Registration of
 * /sw.js happens once per session; subscribing (opt-in) stores the endpoint
 * server-side so heartbeats and SLA sweeps can reach a closed dashboard.
 */
export function usePush() {
  const activeWorkspaceId = useBorga((s) => s.activeWorkspaceId);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [configured, setConfigured] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

  const refresh = useCallback(async () => {
    if (!supported || !activeWorkspaceId) return;
    try {
      setPermission(Notification.permission);
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const existing = await reg?.pushManager.getSubscription().catch(() => null);
      const res = await fetch(`/api/borga/push?ws=${encodeURIComponent(activeWorkspaceId)}`, { headers: { 'X-Borga-Client': 'borga-dashboard' } });
      const json = (await res.json().catch(() => null)) as { configured?: boolean; subscriptions?: number } | null;
      setConfigured(!!json?.configured);
      setCount(json?.subscriptions ?? 0);
      setSubscribed(!!existing);
    } catch {
      /* status stays as-is; the bell shows enable controls */
    }
  }, [supported, activeWorkspaceId]);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    void refresh();
  }, [supported, refresh]);

  const subscribe = useCallback(async () => {
    if (!supported || !activeWorkspaceId) return false;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const res = await fetch(`/api/borga/push?ws=${encodeURIComponent(activeWorkspaceId)}`, { headers: { 'X-Borga-Client': 'borga-dashboard' } });
      const json = (await res.json()) as { publicKey?: string | null };
      if (!json.publicKey) throw new Error('Push is not configured on this server yet (VAPID keys missing).');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(json.publicKey) });
      const payload = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const save = await fetch('/api/borga/push', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action: 'subscribe', ws: activeWorkspaceId, subscription: payload, userAgent: navigator.userAgent }),
      });
      if (!save.ok) throw new Error('The subscription was refused by the server.');
      setPermission(Notification.permission);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable push.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, activeWorkspaceId, refresh]);

  const unsubscribe = useCallback(async () => {
    if (!supported || !activeWorkspaceId) return false;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const existing = await reg?.pushManager.getSubscription().catch(() => null);
      if (existing) {
        await fetch('/api/borga/push', {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({ action: 'unsubscribe', ws: activeWorkspaceId, endpoint: existing.endpoint }),
        }).catch(() => undefined);
        await existing.unsubscribe().catch(() => undefined);
      }
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn push off.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [supported, activeWorkspaceId, refresh]);

  const sendTest = useCallback(async (): Promise<string> => {
    if (!activeWorkspaceId) return 'No workspace selected.';
    setBusy(true);
    try {
      const res = await fetch('/api/borga/push', { method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'test', ws: activeWorkspaceId }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; sent?: number; skipped?: string | null; error?: string } | null;
      if (json?.ok) return `Sent to ${json.sent} device${json.sent === 1 ? '' : 's'}.`;
      return json?.error === 'no_subscriptions' ? 'This workspace has no subscribed devices yet.' : `Not delivered (${json?.skipped ?? json?.error ?? res.status}).`;
    } catch {
      return 'The test request failed.';
    } finally {
      setBusy(false);
      await refresh();
    }
  }, [activeWorkspaceId, refresh]);

  const state: PushState = supported
    ? { supported: true, permission, configured, subscribed, count, busy, error }
    : { supported: false };
  return { state, subscribe, unsubscribe, sendTest, refresh };
}
