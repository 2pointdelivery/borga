import 'server-only';
import { fetchPublic } from './safe-url';

/**
 * Minimal MCP (Model Context Protocol) client over the Streamable HTTP
 * transport — JSON-RPC 2.0 requests, with support for servers that respond
 * with either a plain JSON body or a single `text/event-stream` frame.
 * Real protocol traffic, not a simulation: this is what any MCP-compliant
 * server (wigolo, a self-hosted server, or a hosted SaaS MCP endpoint) speaks.
 */

const PROTOCOL_VERSION = '2025-06-18';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: any;
  error?: { code: number; message: string };
}

interface McpRequestResult {
  result?: any;
  error?: string;
  sessionId?: string;
}

async function mcpRequest(
  url: string,
  method: string,
  params: Record<string, unknown>,
  opts: { token?: string; sessionId?: string; notification?: boolean },
): Promise<McpRequestResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOL_VERSION,
  };
  // Bearer covers OAuth-style servers; x-api-key covers key-authenticated
  // hosts such as Composio's hosted MCP (verified live: Bearer alone 401s,
  // x-api-key succeeds). Unknown headers are ignored elsewhere, so sending
  // both is safe for every server.
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
    headers['x-api-key'] = opts.token;
  }
  if (opts.sessionId) headers['Mcp-Session-Id'] = opts.sessionId;

  const body = opts.notification
    ? JSON.stringify({ jsonrpc: '2.0', method, params })
    : JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 100000, method, params });

  let res: Response;
  try {
    res = await fetchPublic(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { error: `Could not reach ${url}: ${(e as Error).message}` };
  }

  const sessionId = res.headers.get('Mcp-Session-Id') ?? opts.sessionId;
  if (opts.notification) return { sessionId }; // notifications get no body

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `MCP server returned ${res.status}${res.statusText ? ` ${res.statusText}` : ''}: ${text.slice(0, 300)}`, sessionId };
  }

  const contentType = res.headers.get('content-type') ?? '';
  let payload: JsonRpcResponse | null = null;
  try {
    if (contentType.includes('text/event-stream')) {
      const text = await res.text();
      const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine) payload = JSON.parse(dataLine.slice(5).trim());
    } else {
      payload = await res.json();
    }
  } catch {
    return { error: 'Could not parse the MCP server response.', sessionId };
  }

  if (!payload) return { error: 'Empty response from MCP server.', sessionId };
  if (payload.error) return { error: payload.error.message, sessionId };
  return { result: payload.result, sessionId };
}

async function handshake(url: string, token?: string): Promise<{ ok: true; sessionId?: string } | { ok: false; error: string }> {
  const init = await mcpRequest(
    url,
    'initialize',
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'borga', version: '1.0.0' },
    },
    { token },
  );
  if (init.error) return { ok: false, error: init.error };
  // Per spec, notify the server the client is ready. Best-effort — some
  // servers don't require it for simple stateless calls.
  await mcpRequest(url, 'notifications/initialized', {}, { token, sessionId: init.sessionId, notification: true }).catch(() => {});
  return { ok: true, sessionId: init.sessionId };
}

export async function mcpListTools(
  url: string,
  token?: string,
): Promise<{ ok: true; tools: { name: string; description?: string }[] } | { ok: false; error: string }> {
  const hs = await handshake(url, token);
  if (!hs.ok) return hs;
  const list = await mcpRequest(url, 'tools/list', {}, { token, sessionId: hs.sessionId });
  if (list.error) return { ok: false, error: list.error };
  const tools = (list.result?.tools ?? []) as { name: string; description?: string }[];
  return { ok: true, tools };
}

export async function mcpCallTool(
  url: string,
  token: string | undefined,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  if (!toolName) return { ok: false, error: 'tool name is required' };
  const hs = await handshake(url, token);
  if (!hs.ok) return hs;
  const call = await mcpRequest(url, 'tools/call', { name: toolName, arguments: args }, { token, sessionId: hs.sessionId });
  if (call.error) return { ok: false, error: call.error };
  return { ok: true, result: call.result };
}

// ---------------------------------------------------------------------------
// OAuth discovery + Dynamic Client Registration (RFC 8414 / RFC 7591), the
// mechanism the MCP authorization spec builds on. Lets a user "Connect via
// OAuth" against any compliant remote MCP server without us pre-registering
// a client for every provider by hand.
// ---------------------------------------------------------------------------

export interface McpOAuthMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetchPublic(url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Discovers the OAuth authorization server for an MCP server URL, per RFC 9728 → RFC 8414. */
export async function discoverMcpOAuth(mcpUrl: string): Promise<{ ok: true; metadata: McpOAuthMetadata } | { ok: false; error: string }> {
  let origin: string;
  try {
    origin = new URL(mcpUrl).origin;
  } catch {
    return { ok: false, error: 'Invalid MCP server URL.' };
  }

  // Step 1: protected-resource metadata may point at a separate auth server.
  let authServerBase = origin;
  const prm = await fetchJson(`${origin}/.well-known/oauth-protected-resource`);
  if (prm?.authorization_servers?.[0]) {
    authServerBase = prm.authorization_servers[0].replace(/\/$/, '');
  }

  // Step 2: authorization-server metadata gives us the actual endpoints.
  const asMeta = await fetchJson(`${authServerBase}/.well-known/oauth-authorization-server`)
    ?? await fetchJson(`${authServerBase}/.well-known/openid-configuration`);

  if (!asMeta?.authorization_endpoint || !asMeta?.token_endpoint) {
    return { ok: false, error: 'This MCP server does not publish OAuth metadata (no oauth-protected-resource / oauth-authorization-server document found). Use a bearer token instead.' };
  }

  return {
    ok: true,
    metadata: {
      authorizationEndpoint: asMeta.authorization_endpoint,
      tokenEndpoint: asMeta.token_endpoint,
      registrationEndpoint: asMeta.registration_endpoint,
    },
  };
}

/** Dynamically registers a public (no-secret) OAuth client, per RFC 7591. */
export async function registerMcpOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  try {
    const res = await fetchPublic(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Borga',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `Dynamic client registration failed (${res.status}): ${t.slice(0, 200)}` };
    }
    const data = (await res.json()) as { client_id?: string };
    if (!data.client_id) return { ok: false, error: 'Registration succeeded but returned no client_id.' };
    return { ok: true, clientId: data.client_id };
  } catch (e) {
    return { ok: false, error: `Could not reach registration endpoint: ${(e as Error).message}` };
  }
}

export async function exchangeMcpOAuthCode(
  tokenEndpoint: string,
  params: { code: string; codeVerifier: string; redirectUri: string; clientId: string },
): Promise<{ ok: true; accessToken: string; refreshToken?: string } | { ok: false; error: string }> {
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.codeVerifier,
    });
    const res = await fetchPublic(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `Token exchange failed (${res.status}): ${t.slice(0, 200)}` };
    }
    const data = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token) return { ok: false, error: 'Token endpoint returned no access_token.' };
    return { ok: true, accessToken: data.access_token, refreshToken: data.refresh_token };
  } catch (e) {
    return { ok: false, error: `Could not reach token endpoint: ${(e as Error).message}` };
  }
}
