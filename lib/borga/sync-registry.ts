import 'server-only';
import { registerSyncJob } from './sync-jobs';
import { runSupermemorySync } from './supermemory-sync';
import { runEmailJobs } from './email-notify';

/**
 * Registers every background sync job. Each phase of docs/REAL_FEATURES_PLAN.md adds one
 * registration here (ads daily sync, market comps, scheduled social posts, ...).
 */

// Supermemory: retry queued writes, then sync the knowledge base and resolved tickets.
registerSyncJob({
  id: 'supermemory',
  feature: 'supermemory',
  everyMs: 10 * 60_000,
  run: async ({ userId, ws }) => {
    await runSupermemorySync(userId, ws);
  },
});

// Email updates: send each workspace's daily/weekly digest when it is due in the company's own timezone.
registerSyncJob({
  id: 'email-updates',
  feature: 'emailUpdates',
  everyMs: 15 * 60_000,
  run: async ({ userId, ws }) => {
    await runEmailJobs(userId, ws);
  },
});
