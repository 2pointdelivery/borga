import 'server-only';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

// Module-singleton connection pool for Node.js runtime.
// We guard against Turbopack hot-reload re-evaluation by caching on globalThis.
// This approach is correct for Node.js; it would need adjustment for
// edge/Cloudflare Workers runtimes (which don't support persistent sockets).
const g = globalThis as typeof globalThis & { __borgaPool?: mysql.Pool };

function getPool(): mysql.Pool {
  if (!g.__borgaPool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    g.__borgaPool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return g.__borgaPool;
}

export const db = drizzle(getPool());
