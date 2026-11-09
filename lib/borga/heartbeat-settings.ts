import 'server-only';
import { getBorgaState } from './persistence';
import { userWsKey } from './keys';
import { scopedKey } from './persistence';
import type { SettingsState } from './data';

/**
 * Settings key + loader, split out of heartbeat.ts so the run queue can read
 * `queueWorkers` without an import cycle (heartbeat enqueues through the queue).
 */

export const DEFAULT_QUIET = { start: '22:00', end: '07:00' };

export function settingsKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'settings') : scopedKey(ws, 'settings');
}

export async function loadSettings(ws: string | null | undefined, userId: string | null | undefined): Promise<SettingsState | null> {
  return (await getBorgaState<SettingsState>(settingsKey(ws, userId))) ?? null;
}
