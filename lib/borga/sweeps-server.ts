import 'server-only';
import { getBorgaState, setBorgaState, listBorgaKeys } from './persistence';
import { userWsKey } from './keys';
import { loadFeatures } from './features-server';
import { addNotice } from './notices';
import type { FundingOpportunity, ProactiveNotice, SocialPost } from './data';

/** Workspaces holding an entity, from key names only (never loads every row's JSON). */
async function listEntityWorkspaces(entity: string): Promise<Array<{ userId: string; ws: string }>> {
  const out: Array<{ userId: string; ws: string }> = [];
  for (const k of await listBorgaKeys(`u::%::ws::%::${entity}`).catch(() => [] as string[])) {
    const m = new RegExp(`^u::([^:]+)::ws::([^:]+)::${entity}$`).exec(k);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}

/** Dedupe map for sweep notices (same pattern as the filing reminders). */
const sweepsKey = (u: string, ws: string) => userWsKey(u, ws, 'sweepNotices');
async function raiseOnce(u: string, ws: string, key: string, notice: Omit<ProactiveNotice, 'id' | 'createdAt' | 'readAt'>, today: string): Promise<boolean> {
  const sent = (await getBorgaState<Record<string, string>>(sweepsKey(u, ws))) ?? {};
  if (sent[key]) return false;
  await addNotice({ id: `n-${Math.random().toString(36).slice(2, 10)}`, createdAt: new Date().toISOString(), readAt: null, ...notice }, ws, u);
  sent[key] = today;
  // Bounded like the filings map: drop entries older than 400 days.
  const cutoff = Date.now() - 400 * 86_400_000;
  for (const [k, v] of Object.entries(sent)) if (Date.parse(v) < cutoff) delete sent[k];
  await setBorgaState(sweepsKey(u, ws), sent);
  return true;
}

const OPEN_STAGES = new Set(['identified', 'evaluating', 'applying']);

/**
 * Deadline reminders for open funding opportunities: 7 days out, then every 7
 * days once overdue. Deduped per threshold, so a 5-minute cron is safe.
 */
export async function sweepFundingDeadlines(todayIso = new Date().toISOString().slice(0, 10)): Promise<Record<string, unknown>> {
  const done: Record<string, unknown> = {};
  for (const t of await listEntityWorkspaces('fundraising')) {
    try {
      if (!(await loadFeatures(t.userId, t.ws)).flags.fundraising) continue;
      const opps = (await getBorgaState<FundingOpportunity[]>(userWsKey(t.userId, t.ws, 'fundraising'))) ?? [];
      let raised = 0;
      for (const o of opps) {
        if (!OPEN_STAGES.has(o.stage) || !o.deadline) continue;
        const days = Math.round((Date.parse(o.deadline) - Date.parse(todayIso)) / 86_400_000);
        const dueSoon = days >= 0 && days <= 7;
        const overdue = days < 0 && Math.abs(days) % 7 === 0; // weekly once overdue
        if (!dueSoon && !overdue) continue;
        const key = `funding:${o.id}:${overdue ? `overdue-${Math.abs(days)}` : 'due7'}`;
        const ok = await raiseOnce(t.userId, t.ws, key, {
          title: overdue
            ? `${o.program}: application overdue ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
            : `${o.program}: due in ${days} day${days === 1 ? '' : 's'}`,
          body: `Deadline ${o.deadline}. Advance or drop it under Company → Fundraising so the pipeline stays honest.`,
          severity: overdue ? 'urgent' : 'info',
          source: 'scheduler',
        }, todayIso);
        if (ok) raised++;
      }
      done[`${t.userId}/${t.ws}`] = { raised };
    } catch (e) {
      done[`${t.userId}/${t.ws}`] = { ok: false, error: (e as Error).message };
    }
  }
  return done;
}

/**
 * Scheduled social posts that came due while nobody was looking. Publishing
 * runs live from the Marketing tab (it needs the session-linked Composio
 * accounts); the sweep never pretends to publish — one notice per due post
 * sends the team to the queue to hit publish.
 */
export async function sweepScheduledPosts(nowIso = new Date().toISOString(), todayIso = new Date().toISOString().slice(0, 10)): Promise<Record<string, unknown>> {
  const done: Record<string, unknown> = {};
  for (const t of await listEntityWorkspaces('posts')) {
    try {
      if (!(await loadFeatures(t.userId, t.ws)).flags.social) continue;
      const posts = (await getBorgaState<SocialPost[]>(userWsKey(t.userId, t.ws, 'posts'))) ?? [];
      let due = 0;
      for (const p of posts) {
        if (p.status !== 'scheduled' || !p.scheduledAt) continue;
        if (Date.parse(p.scheduledAt) > Date.parse(nowIso)) continue;
        const ok = await raiseOnce(t.userId, t.ws, `post-due:${p.id}`, {
          title: `Scheduled ${p.channel} post is due`,
          body: `“${p.content.slice(0, 80)}${p.content.length > 80 ? '…' : ''}” passed its publish time — open Marketing → Social Media to publish it now.`,
          severity: 'info',
          source: 'scheduler',
        }, todayIso);
        if (ok) due++;
      }
      if (due > 0) done[`${t.userId}/${t.ws}`] = { due };
    } catch (e) {
      done[`${t.userId}/${t.ws}`] = { ok: false, error: (e as Error).message };
    }
  }
  return done;
}
