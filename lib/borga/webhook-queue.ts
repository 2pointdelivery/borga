import 'server-only';
import { createHmac } from 'crypto';
import { getBorgaState, setBorgaState, listBorgaKeys } from './persistence';
import { userWsKey } from './keys';
import { assertPublicHttpsUrl } from './safe-url';
import type { Webhook } from './data';

/** Outbound webhook delivery queue: inline attempts plus cron-driven retries. */

export interface Delivery {
  webhookId: string;
  eventId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttempt: string;
  nextAttempt?: string;
  error?: string;
  responseStatus?: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [1000, 5000, 15000];
export const queueKey = (u: string, ws: string) => `t::${u}::${ws}::whqueue`;

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('hex');
const hasSecret = (w: Webhook) => !!w.secret && !w.secret.startsWith('—');

export async function loadQueue(u: string, ws: string): Promise<Delivery[]> {
  return ((await getBorgaState<{ deliveries: Delivery[] }>(queueKey(u, ws))) ?? { deliveries: [] }).deliveries;
}
export const saveQueue = (u: string, ws: string, deliveries: Delivery[]) => setBorgaState(queueKey(u, ws), { deliveries: deliveries.slice(-500) });

async function attempt(w: Webhook, d: Delivery): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const url = await assertPublicHttpsUrl(w.url);
    const body = JSON.stringify(d.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Borga-Webhook/1.0',
      'X-Borga-Event': d.eventId,
      'X-Borga-Delivery-ID': `${d.webhookId}-${d.eventId}`,
      'X-Borga-Timestamp': new Date().toISOString(),
    };
    if (hasSecret(w)) headers['X-Borga-Signature'] = `sha256=${sign(body, w.secret)}`;
    const res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/** Runs every due pending delivery once; returns the updated queue. */
export async function processQueue(u: string, ws: string, hooks: Webhook[]): Promise<Delivery[]> {
  const queue = await loadQueue(u, ws);
  const byId = new Map(hooks.map((h) => [h.id, h]));
  const now = Date.now();
  for (const d of queue) {
    if (d.status !== 'pending' || (d.nextAttempt && new Date(d.nextAttempt).getTime() > now)) continue;
    const w = byId.get(d.webhookId);
    d.lastAttempt = new Date().toISOString();
    if (!w || !w.active) {
      d.status = 'failed';
      d.error = 'Webhook not found or inactive';
      continue;
    }
    const r = await attempt(w, d);
    d.attempts++;
    d.responseStatus = r.status;
    if (r.ok) {
      d.status = 'delivered';
      d.error = undefined;
      d.nextAttempt = undefined;
    } else {
      d.error = r.error;
      if (d.attempts >= MAX_ATTEMPTS) {
        d.status = 'failed';
        d.nextAttempt = undefined;
      } else {
        d.nextAttempt = new Date(Date.now() + RETRY_DELAYS[Math.min(d.attempts, RETRY_DELAYS.length - 1)]).toISOString();
      }
    }
  }
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const kept = queue.filter((d) => d.status === 'pending' || d.lastAttempt > weekAgo);
  await saveQueue(u, ws, kept);
  return kept;
}


/** Cron: retry every pending delivery across workspaces. */
export async function processAllPendingDeliveries(): Promise<number> {
  let n = 0;
  for (const k of await listBorgaKeys('t::%::whqueue')) {
    const m = /^t::([^:]+)::([^:]+)::whqueue$/.exec(k);
    if (!m) continue;
    const hooks = (await getBorgaState<Webhook[]>(userWsKey(m[1], m[2], 'webhooks'))) ?? [];
    n += (await processQueue(m[1], m[2], hooks)).filter((d) => d.status === 'pending').length;
  }
  return n;
}
