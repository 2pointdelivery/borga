import { NextResponse } from 'next/server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { encryptSecret } from '@/lib/borga/secrets';
import { exchangeMcpOAuthCode } from '@/lib/borga/mcp-client';
import { userWsKey } from '@/lib/borga/keys';
import type { McpServer } from '@/lib/borga/data';

export const runtime = 'nodejs';

function popupPage(message: string, ok: boolean): string {
  // The message can carry provider text (e.g. ?error=...), so escape it: this
  // page runs on our own origin, where injected markup could read the session.
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html><body style="font-family:system-ui;background:#0a0a0a;color:#f5f5f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;max-width:360px;padding:24px;">
  <p style="font-size:15px;color:${ok ? '#34d399' : '#f87171'};">${safe}</p>
  <p style="font-size:12px;color:#a3a3a3;">This window will close automatically.</p>
</div>
<script>setTimeout(() => window.close(), 1500);</script>
</body></html>`;
}

/** OAuth redirect target for MCP server connections — see /api/borga/mcp (oauth_authorize_url). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return new NextResponse(popupPage(`Authorization was not completed: ${errorParam}`, false), { headers: { 'Content-Type': 'text/html' } });
  }
  if (!code || !state || !/^[A-Za-z0-9_-]{1,128}$/.test(state)) {
    return new NextResponse(popupPage('Missing authorization code.', false), { headers: { 'Content-Type': 'text/html' } });
  }

  type StateRecord = { userId: string; ws: string; serverId: string; codeVerifier: string; tokenEndpoint: string; clientId: string; redirectUri: string; createdAt: number };
  const record = await getBorgaState<StateRecord>(`mcp_oauth_state:${state}`);
  await setBorgaState(`mcp_oauth_state:${state}`, null);

  if (!record) {
    return new NextResponse(popupPage('This authorization request expired or was already used. Try connecting again.', false), { headers: { 'Content-Type': 'text/html' } });
  }
  if (Date.now() - record.createdAt > 10 * 60_000) {
    return new NextResponse(popupPage('This authorization request expired. Try connecting again.', false), { headers: { 'Content-Type': 'text/html' } });
  }

  const exchange = await exchangeMcpOAuthCode(record.tokenEndpoint, {
    code,
    codeVerifier: record.codeVerifier,
    redirectUri: record.redirectUri,
    clientId: record.clientId,
  });
  if (!exchange.ok) {
    return new NextResponse(popupPage(`Could not complete sign-in: ${exchange.error}`, false), { headers: { 'Content-Type': 'text/html' } });
  }

  await setBorgaState(userWsKey(record.userId, record.ws, `mcp_token:${record.serverId}`), encryptSecret(exchange.accessToken));

  const serversKey = userWsKey(record.userId, record.ws, 'mcpServers');
  const servers = (await getBorgaState<McpServer[]>(serversKey)) ?? [];
  const updated = servers.map((s) => (s.id === record.serverId ? { ...s, status: 'connected' as const, lastSync: new Date().toISOString(), lastError: undefined } : s));
  await setBorgaState(serversKey, updated);

  return new NextResponse(popupPage('Connected. You can close this window.', true), { headers: { 'Content-Type': 'text/html' } });
}
