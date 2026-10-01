import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { encryptSecret, decryptSecret } from '@/lib/borga/secrets';
import { mcpListTools, discoverMcpOAuth, registerMcpOAuthClient } from '@/lib/borga/mcp-client';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { userWsKey, isValidUserId, isValidWsId } from '@/lib/borga/keys';
import type { McpServer } from '@/lib/borga/data';
import { featureGate } from '@/lib/borga/features-server';

export const runtime = 'nodejs';

// NOTE: mcpServers is a bulk-synced entity (see WORKSPACE_ENTITIES in
// /api/borga/data/route.ts), which the client Zustand store reads/writes via
// the per-USER-per-workspace key `userWsKey(userId, ws, entity)`. This route
// must read/write that exact same key — using the plain `scopedKey(ws, ...)`
// helper (workspace-only, no user) would silently write to a different row
// that the rest of the app never reads, which is what happened during dev:
// server records saved by this route were invisible to it seconds later.
function serversKey(userId: string, ws: string) {
  return userWsKey(userId, ws, 'mcpServers');
}
function tokenKey(userId: string, ws: string, serverId: string) {
  return userWsKey(userId, ws, `mcp_token:${serverId}`);
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

async function loadServers(userId: string, ws: string): Promise<McpServer[]> {
  return (await getBorgaState<McpServer[]>(serversKey(userId, ws))) ?? [];
}

async function saveServers(userId: string, ws: string, servers: McpServer[]): Promise<void> {
  await setBorgaState(serversKey(userId, ws), servers);
}

function callbackUrl(req: Request): string {
  return `${new URL(req.url).origin}/api/borga/mcp/oauth/callback`;
}

export async function POST(req: NextRequest) {
  const csrfHeader = req.headers.get('X-Borga-Client');
  if (csrfHeader !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    action?: string;
    ws?: string;
    serverId?: string;
    url?: string;
    token?: string;
    tool?: string;
    params?: Record<string, unknown>;
    oauth?: { authorizationEndpoint: string; tokenEndpoint: string; clientId: string; scope?: string };
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const { action, ws } = body;
  if (!isValidWsId(ws)) {
    return NextResponse.json({ ok: false, error: 'A valid workspace id is required.' }, { status: 400 });
  }
  const off = await featureGate('mcp', userId, ws);
  if (off) return off;

  try {
    // Test an MCP server before saving it — no persistence, just a live check.
    if (action === 'test') {
      const url = (body.url ?? '').trim();
      if (!url) return NextResponse.json({ ok: false, error: 'url is required.' }, { status: 400 });
      const result = await mcpListTools(url, body.token?.trim() || undefined);
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
      return NextResponse.json({ ok: true, tools: result.tools });
    }

    // Re-check a saved server's tools and refresh its cached tool list/status.
    if (action === 'refresh') {
      const servers = await loadServers(userId, ws);
      const server = servers.find((s) => s.id === body.serverId);
      if (!server) return NextResponse.json({ ok: false, error: 'Server not found.' }, { status: 404 });
      const token = server.authType === 'none' ? undefined : decryptSecret((await getBorgaState<string>(tokenKey(userId, ws, server.id))) ?? '') || undefined;
      const result = await mcpListTools(server.url, token);
      const updated = servers.map((s) => (s.id === server.id
        ? result.ok
          ? { ...s, status: 'connected' as const, tools: result.tools, toolCount: result.tools.length, lastSync: new Date().toISOString(), lastError: undefined }
          : { ...s, status: 'error' as const, lastError: result.error }
        : s));
      await saveServers(userId, ws, updated);
      return result.ok
        ? NextResponse.json({ ok: true, tools: result.tools })
        : NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }

    // Save a bearer token for a server (or clear it for authType 'none').
    if (action === 'save_token') {
      const serverId = body.serverId ?? '';
      const servers = await loadServers(userId, ws);
      if (!servers.some((s) => s.id === serverId)) return NextResponse.json({ ok: false, error: 'Server not found.' }, { status: 404 });
      const token = (body.token ?? '').trim();
      if (token) await setBorgaState(tokenKey(userId, ws, serverId), encryptSecret(token));
      return NextResponse.json({ ok: true });
    }

    // Discover OAuth metadata for a server URL (step 1 of Connect via OAuth).
    if (action === 'oauth_discover') {
      const url = (body.url ?? '').trim();
      if (!url) return NextResponse.json({ ok: false, error: 'url is required.' }, { status: 400 });
      const discovery = await discoverMcpOAuth(url);
      if (!discovery.ok) return NextResponse.json({ ok: false, error: discovery.error }, { status: 502 });
      let clientId: string | undefined;
      if (discovery.metadata.registrationEndpoint) {
        const reg = await registerMcpOAuthClient(discovery.metadata.registrationEndpoint, callbackUrl(req));
        if (reg.ok) clientId = reg.clientId;
      }
      if (!clientId) {
        return NextResponse.json({ ok: false, error: 'This server supports OAuth discovery but not dynamic client registration, and no client is pre-registered. Use a bearer token instead.' }, { status: 502 });
      }
      return NextResponse.json({ ok: true, metadata: { ...discovery.metadata, clientId } });
    }

    // Build the authorize URL with PKCE and stash the verifier server-side (step 2).
    // Accepts the just-discovered OAuth metadata directly in the body (the caller
    // just ran oauth_discover) rather than re-reading the server record, which
    // would race the client's own fire-and-forget persistence of that metadata.
    if (action === 'oauth_authorize_url') {
      const serverId = body.serverId ?? '';
      const servers = await loadServers(userId, ws);
      const server = servers.find((s) => s.id === serverId);
      if (!server) return NextResponse.json({ ok: false, error: 'Server not found.' }, { status: 404 });
      const oauth = body.oauth ?? server.oauth;
      if (!oauth?.authorizationEndpoint || !oauth.clientId || !oauth.tokenEndpoint) {
        return NextResponse.json({ ok: false, error: 'Run OAuth discovery for this server first.' }, { status: 400 });
      }
      // Persist the metadata onto the server record now, so it's never lost even
      // if the client's own save races or fails.
      if (body.oauth) {
        await saveServers(userId, ws, servers.map((s) => (s.id === serverId ? { ...s, oauth: body.oauth } : s)));
      }
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
      const state = randomBytes(16).toString('hex');
      await setBorgaState(`mcp_oauth_state:${state}`, {
        userId, ws, serverId, codeVerifier,
        tokenEndpoint: oauth.tokenEndpoint,
        clientId: oauth.clientId,
        redirectUri: callbackUrl(req),
        createdAt: Date.now(),
      });
      const authUrl = new URL(oauth.authorizationEndpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', oauth.clientId);
      authUrl.searchParams.set('redirect_uri', callbackUrl(req));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      if (oauth.scope) authUrl.searchParams.set('scope', oauth.scope);
      return NextResponse.json({ ok: true, authorizeUrl: authUrl.toString() });
    }

    // Poll whether the OAuth popup completed (a token now exists for this server).
    if (action === 'oauth_status') {
      const serverId = body.serverId ?? '';
      const hasToken = !!(await getBorgaState<string>(tokenKey(userId, ws, serverId)));
      return NextResponse.json({ ok: true, connected: hasToken });
    }

    // Tier 6: execute a held MCP tool call after its approval was granted.
    // Only reachable with a session + CSRF header (the approve button); the
    // agent itself can only create the held approval, never execute it.
    if (action === 'call') {
      const { mcpCallTool } = await import('@/lib/borga/mcp-client');
      const name = String((body as { server?: unknown }).server ?? '').toLowerCase();
      const tool = String(body.tool ?? '');
      const params = ((body as { params?: unknown }).params ?? {}) as Record<string, unknown>;
      if (!name || !tool) return NextResponse.json({ ok: false, error: 'server and tool are required.' }, { status: 400 });
      const servers = await loadServers(userId, ws);
      const server = servers.find((s) => s.name.toLowerCase() === name);
      if (!server) return NextResponse.json({ ok: false, error: `No MCP server named "${name}".` }, { status: 404 });
      const token = server.authType === 'none' ? undefined : decryptSecret((await getBorgaState<string>(tokenKey(userId, ws, server.id))) ?? '') || undefined;
      if (server.authType !== 'none' && !token) {
        return NextResponse.json({ ok: false, error: `"${server.name}" has no token saved.` }, { status: 400 });
      }
      const result = await mcpCallTool(server.url, token, tool, params);
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
      return NextResponse.json({ ok: true, result: result.result });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('MCP API error:', err);
    return NextResponse.json({ ok: false, error: 'An unexpected error occurred.' }, { status: 500 });
  }
}
