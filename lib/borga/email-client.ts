'use client';

import type { EmailEventId } from './email-core';

/**
 * Tells the server that something only the browser can see just happened (an approval created in the
 * UI, a recurring run). The server decides whether to email: workspace settings, event switches,
 * duplicates and rate limits are all enforced there. Fire-and-forget; never blocks the UI.
 */
export function notifyEmail(ws: string, event: EmailEventId, data: Record<string, unknown>): void {
  if (!ws) return;
  void fetch('/api/borga/email?ws=' + encodeURIComponent(ws), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
    body: JSON.stringify({ action: 'notify', event, data }),
    keepalive: true,
  }).catch(() => undefined);
}
