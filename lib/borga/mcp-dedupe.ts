/**
 * One MCP server, once. Adding the same endpoint again (a retry, another person on the team, the hosted Composio server set up twice)
 * used to create a second entry, and agents then saw every one of its tools twice. Pure (no I/O).
 */
import type { McpServer } from './data';

/** The address with the parts that do not change which server it is removed: case of the host, a trailing slash, a #fragment. */
export function normalizeMcpUrl(raw: string): string {
  const t = (raw ?? '').trim();
  try {
    const u = new URL(t);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return t.toLowerCase();
  }
}

/** The server already registered at this address, if any. */
export function findServerByUrl<T extends Pick<McpServer, 'url'>>(servers: T[], url: string): T | undefined {
  const n = normalizeMcpUrl(url);
  return servers.find((s) => normalizeMcpUrl(s.url) === n);
}

/** Higher is better: the entry worth keeping when two describe the same server. */
function keepScore(s: McpServer): number {
  return (s.status === 'connected' ? 100 : s.status === 'error' ? 0 : 10) + Math.min(s.toolCount ?? s.tools?.length ?? 0, 50) / 100 + (s.authType !== 'none' ? 1 : 0);
}

/** The list with one entry per address (the connected one, then the one with the most tools, wins) and the entries dropped. */
export function dedupeServers(servers: McpServer[]): { keep: McpServer[]; removed: McpServer[] } {
  const best = new Map<string, McpServer>();
  for (const s of servers) {
    const n = normalizeMcpUrl(s.url);
    const cur = best.get(n);
    if (!cur || keepScore(s) > keepScore(cur)) best.set(n, s);
  }
  const keepIds = new Set([...best.values()].map((s) => s.id));
  return { keep: servers.filter((s) => keepIds.has(s.id)), removed: servers.filter((s) => !keepIds.has(s.id)) };
}
