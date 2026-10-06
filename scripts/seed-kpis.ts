import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import path from 'path';
import { completeKpiGroups, type KpiGroup } from '../lib/borga/data';

/**
 * Gives every existing company the full best-practice KPI set: missing departments and KPIs are added and unset (zero) targets
 * get the baseline target. A company's own targets, added KPIs and measured values are never changed. Safe to run again: a company
 * that is already complete is left untouched. Companies also complete themselves when they next open the dashboard; this makes
 * sure the ones nobody has opened yet (and the agents that read them) have the set too.
 *
 *   pnpm db:seed-kpis            apply
 *   pnpm db:seed-kpis -- --dry   show what would change
 */

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const parse = <T>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
};

async function main() {
  const dry = process.argv.includes('--dry');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set.'); process.exit(1); }
  const db = await mysql.createConnection(url);
  try {
    const [rows] = await db.query('SELECT `key`, value FROM borga_state WHERE `key` LIKE ?', ['u::%::workspaces']) as [Array<{ key: string; value: unknown }>, unknown];
    let companies = 0, updated = 0, added = 0;
    for (const row of rows) {
      const userId = row.key.split('::')[1];
      const list = parse<Array<{ id: string }>>(row.value) ?? [];
      for (const w of list) {
        if (!w?.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(w.id)) continue;
        companies++;
        const key = `u::${userId}::ws::${w.id}::kpis`;
        const [cur] = await db.query('SELECT value FROM borga_state WHERE `key` = ?', [key]) as [Array<{ value: unknown }>, unknown];
        const saved = parse<KpiGroup[]>(cur[0]?.value);
        const { groups, changed } = completeKpiGroups(saved);
        if (!changed) continue;
        updated++;
        added += groups.reduce((n, g) => n + g.kpis.length, 0) - (saved ?? []).reduce((n, g) => n + (g.kpis?.length ?? 0), 0);
        if (!dry) {
          await db.query(
            'INSERT INTO borga_state (`key`, value, updated_at, version) VALUES (?, ?, NOW(), 1) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW(), version = version + 1',
            [key, JSON.stringify(groups)],
          );
        }
      }
    }
    console.log(`${dry ? '[dry run] ' : ''}${companies} companies checked, ${updated} ${dry ? 'would be ' : ''}completed, ${added} KPIs added.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
