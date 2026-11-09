import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
import path from 'path';
import { RETIRED_LLM_PROVIDERS, repairConnections, type AppConnection } from '../lib/borga/data';

/**
 * Removes what retired features left behind in every company's saved data: the "Demo (no key)" connection card that was always shown
 * as connected, and the retired demo and local model providers in the model catalog. A company's own data is never touched. Safe to
 * run again. Companies also clean themselves when they next open the dashboard; this covers the ones nobody has opened since.
 *
 *   pnpm db:repair            apply
 *   pnpm db:repair -- --dry   show what would change
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
  const write = (key: string, value: unknown) =>
    db.query('UPDATE borga_state SET value = ?, updated_at = NOW(), version = version + 1 WHERE `key` = ?', [JSON.stringify(value), key]);
  try {
    const [rows] = await db.query("SELECT `key`, value FROM borga_state WHERE `key` LIKE '%::connections' OR `key` LIKE '%::llmCatalog'") as [Array<{ key: string; value: unknown }>, unknown];
    let connections = 0, catalogs = 0;
    for (const row of rows) {
      const saved = parse<unknown[]>(row.value);
      if (!Array.isArray(saved)) continue;
      if (row.key.endsWith('::connections')) {
        const r = repairConnections(saved as AppConnection[]);
        if (r.changed) { connections++; if (!dry) await write(row.key, r.connections); }
      } else {
        const kept = saved.filter((p) => !RETIRED_LLM_PROVIDERS.includes((p as { id?: string }).id ?? ''));
        if (kept.length !== saved.length) { catalogs++; if (!dry) await write(row.key, kept); }
      }
    }
    console.log(`${dry ? '[dry run] ' : ''}${connections} connection list(s) and ${catalogs} model catalog(s) ${dry ? 'would be ' : ''}cleaned.`);
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
