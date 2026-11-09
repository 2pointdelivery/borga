import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueOutbox, flushOutbox, isNetworkError, readOutbox } from './outbox';

export { flushOutbox, readOutbox };

/** Thrown when a save was queued offline instead of sent (screens show it as a gentle notice, not a failure). */
export class OfflineQueuedError extends Error {}

const DEFAULT_BASE = (Constants.expoConfig?.extra as any)?.apiBaseUrlDefault ?? 'http://10.0.0.170:13000';
const KEY = 'borga.apiBaseUrl';
const SESSION_KEY = 'borga.sessionCookie';

export async function getBaseUrl(): Promise<string> {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  return (saved || DEFAULT_BASE).replace(/\/$/, '');
}

export async function setBaseUrl(url: string) {
  await AsyncStorage.setItem(KEY, url.replace(/\/$/, ''));
}

async function headers(extra: Record<string, string> = {}) {
  const cookie = await AsyncStorage.getItem(SESSION_KEY).catch(() => null);
  return {
    'Content-Type': 'application/json',
    // Required by proxy.ts CSRF gate for API writes — keep on every request.
    'X-Borga-Client': 'borga-mobile/0.1.0',
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

function captureSessionCookie(res: Response) {
  // React Native fetch does not expose Set-Cookie reliably; the web app also
  // returns the session via JSON where possible. We persist what we can and
  // fall back to cookie-based web sessions inside API calls.
  const setCookie: string | null =
    (res.headers as any)?.get?.('set-cookie') ?? (res.headers as any)?.get?.('Set-Cookie') ?? null;
  if (setCookie) {
    AsyncStorage.setItem(SESSION_KEY, setCookie.split(';')[0]).catch(() => {});
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify(body),
  });
  captureSessionCookie(res);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as any)?.error || `Request failed (${res.status})`);
  return json as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, { headers: await headers() });
  captureSessionCookie(res);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json as any)?.error || `Request failed (${res.status})`);
  return json as T;
}

export async function login(email: string, password: string) {
  return apiPost<{ ok: boolean; user: any; workspaceId: string }>('/api/auth/login', { email, password });
}

export async function signup(name: string, email: string, password: string) {
  return apiPost<{ ok: boolean }>('/api/auth/signup', { name, email, password });
}

export async function fetchMe() {
  return apiGet<{ ok: boolean; user: any }>('/api/auth/me');
}

export interface Workspace {
  id: string;
  name: string;
}

export async function getWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  return apiGet('/api/borga/data');
}

export async function getWorkspaceData(ws: string): Promise<any> {
  return apiGet(`/api/borga/data?ws=${encodeURIComponent(ws)}`);
}

export async function saveEntity(ws: string, entity: string, value: unknown, baseVersion?: number) {
  try {
    return await apiPost<{ ok: boolean; saved: boolean; version?: number }>(`/api/borga/data`, {
      ws,
      entity,
      value,
      ...(baseVersion !== undefined ? { baseVersion } : {}),
    });
  } catch (e) {
    // A network failure (offline, server unreachable) queues the save on this
    // device and it re-sends in order once the app can reach the server again.
    // Real refusals (409/403/413) throw with the server's message and are NOT queued.
    if (isNetworkError(e)) {
      await enqueueOutbox({ ws, entity, value, baseVersion, label: entity });
      throw new OfflineQueuedError(`Saved offline — it will sync when you are back online (${entity})`);
    }
    throw e;
  }
}

export async function sendChat(ws: string, messages: { role: string; content: string }[]) {
  return apiPost<{ reply: string; error?: string }>(`/api/borga/chat`, { ws, messages });
}

export async function getHealth(): Promise<any> {
  return apiGet('/api/health');
}

export async function logout() {
  await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
  try {
    await apiPost('/api/auth/logout', {});
  } catch {
    // clearing local session is enough for mobile
  }
}

export async function getTickets(ws: string) {
  return apiGet<{ ok: boolean; tickets: any[] }>(`/api/borga/tickets?ws=${encodeURIComponent(ws)}`);
}

export async function createTicket(ws: string, ticket: { subject: string; description?: string; priority?: string }) {
  return apiPost<{ ok: boolean; ticket: any }>(`/api/borga/tickets?ws=${encodeURIComponent(ws)}`, {
    action: 'create',
    ticket,
    actor: 'Mobile',
  });
}
