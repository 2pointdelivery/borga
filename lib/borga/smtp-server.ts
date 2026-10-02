import 'server-only';
import { getConnection } from './connections-server';
import { parseSmtp, type SmtpSettings } from './smtp-core';

/** The company's own outgoing mail server, if it has set one (Connections, encrypted at rest). */
export async function workspaceSmtp(u: string, ws: string): Promise<SmtpSettings | null> {
  const v = await getConnection(u, ws, 'smtp');
  if (!v) return null;
  const r = parseSmtp(v);
  return r.ok ? r.settings : null;
}
