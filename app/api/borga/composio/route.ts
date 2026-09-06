import { NextResponse } from 'next/server';
import { getApiKey, setApiKey, isAllowedKey } from '@/lib/borga/secrets';

export const runtime = 'nodejs';

const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function composioHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };
}

function isValidApiKey(key: unknown): key is string {
  return typeof key === 'string' && key.trim().length > 8;
}

function isValidBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Composio ${operationName} attempt ${attempt}/${MAX_RETRIES} failed:`, error);
      
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error(`Composio ${operationName} failed after ${MAX_RETRIES} attempts:`, lastError);
  throw lastError;
}

async function validateComposioConnection(apiKey: string, baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/apps?limit=1`, {
      headers: composioHeaders(apiKey),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function handleUpstreamError(status: number, text: string, defaultMessage: string) {
  if (status === 401 || status === 403 || status === 404) {
    return NextResponse.json({ ok: false, error: 'Invalid Composio API key. Check your API key configuration in the Tools & Integrations tab.' }, { status: 401 });
  }
  return NextResponse.json({ ok: false, error: defaultMessage, details: text.slice(0, 200) }, { status: 502 });
}

export async function POST(req: Request) {
  let body: { action?: string; apiKey?: string; appName?: string; entityId?: string; baseUrl?: string; persistKey?: boolean; callbackUrl?: string; params?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const apiKey = (body.apiKey ?? '').trim();
  const persistKey = body.persistKey === true;

  // Check if we should use stored key
  let effectiveApiKey = apiKey;
  if (!effectiveApiKey) {
    effectiveApiKey = await getApiKey('COMPOSIO_API_KEY');
  }

  // Persist the key if requested and allowed
  if (persistKey && isValidApiKey(effectiveApiKey) && isAllowedKey('COMPOSIO_API_KEY')) {
    await setApiKey('COMPOSIO_API_KEY', effectiveApiKey);
  }

  // Use custom base URL from user config if provided, fall back to default.
  const rawBase = (body.baseUrl ?? COMPOSIO_BASE).trim().replace(/\/$/, '');
  
  // Restrict to HTTPS to block SSRF to internal services.
  if (!isValidBaseUrl(rawBase)) {
    return NextResponse.json({ ok: false, error: 'Composio base URL must be a valid HTTPS URL.' }, { status: 400 });
  }
  
  const baseStr = rawBase;

  const action = body.action ?? 'list';

  // Actions that require a valid API key
  const actionsRequiringKey = ['list', 'authConfigs', 'tools', 'accounts', 'connect', 'disconnect', 'execute', 'connectionStatus', 'refreshToken', 'validate'];
  
  if (actionsRequiringKey.includes(action) && !isValidApiKey(effectiveApiKey)) {
    return NextResponse.json({ 
      ok: false, 
      error: 'A valid Composio API key is required for this action. Provide it in the request or configure COMPOSIO_API_KEY in your environment.' 
    }, { status: 400 });
  }

  try {
    if (action === 'validate') {
      const isConnected = await validateComposioConnection(effectiveApiKey, baseStr);
      return NextResponse.json({ ok: true, action: 'validate', connected: isConnected, baseUrl: baseStr });
    }

    if (action === 'list') {
      // Fetch full app catalog from Composio — no limit so all integrations are returned.
      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/apps`, {
          headers: composioHeaders(effectiveApiKey),
          signal: AbortSignal.timeout(20000),
        }),
        'list apps'
      );

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio list error', upstream.status, text.slice(0, 200));
        return handleUpstreamError(upstream.status, text, 'Composio API returned an error.');
      }

      const data = await upstream.json();
      const apps = data.items ?? data.apps ?? (Array.isArray(data) ? data : []);
      return NextResponse.json({ ok: true, action: 'list', apps });
    }

    if (action === 'authConfigs') {
      // Fetch auth configs (blueprints for toolkit auth) — optionally filter by toolSlug.
      const toolSlug = (body.appName ?? '').trim();
      const url = toolSlug
        ? `${baseStr}/authConfigs?toolSlug=${encodeURIComponent(toolSlug)}`
        : `${baseStr}/authConfigs`;
      const upstream = await retryWithBackoff(
        () => fetch(url, { headers: composioHeaders(effectiveApiKey), signal: AbortSignal.timeout(15000) }),
        'list authConfigs'
      );
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio authConfigs error', upstream.status, text.slice(0, 200));
        return handleUpstreamError(upstream.status, text, 'Failed to fetch auth configs.');
      }
      const data = await upstream.json();
      const configs = data.items ?? data.authConfigs ?? (Array.isArray(data) ? data : []);
      return NextResponse.json({ ok: true, action: 'authConfigs', configs });
    }

    if (action === 'tools') {
      // Fetch tool schemas for a connected toolkit.
      const toolkit = (body.appName ?? '').trim().toUpperCase();
      const userId = (body.entityId ?? 'default').trim();
      if (!toolkit) {
        return NextResponse.json({ ok: false, error: 'appName (toolkit slug) is required.' }, { status: 400 });
      }
      const url = `${baseStr}/tools?toolkits[]=${encodeURIComponent(toolkit)}&userId=${encodeURIComponent(userId)}&limit=20`;
      const upstream = await retryWithBackoff(
        () => fetch(url, { headers: composioHeaders(effectiveApiKey), signal: AbortSignal.timeout(20000) }),
        'fetch tools'
      );
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio tools error', upstream.status, text.slice(0, 200));
        return handleUpstreamError(upstream.status, text, 'Failed to fetch tools.');
      }
      const data = await upstream.json();
      const tools = data.items ?? data.tools ?? (Array.isArray(data) ? data : []);
      return NextResponse.json({ ok: true, action: 'tools', tools });
    }

    if (action === 'accounts') {
      // List connected accounts.
      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/connectedAccounts?limit=50`, {
          headers: composioHeaders(effectiveApiKey),
          signal: AbortSignal.timeout(15000),
        }),
        'list accounts'
      );
      
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio accounts error', upstream.status, text.slice(0, 200));
        return handleUpstreamError(upstream.status, text, 'Failed to fetch connected accounts.');
      }
      
      const data = await upstream.json();
      return NextResponse.json({ ok: true, action: 'accounts', accounts: data.items ?? data ?? [] });
    }

    if (action === 'connectionStatus') {
      // Check status of a specific connection.
      const connectionId = (body.appName ?? '').trim();
      if (!connectionId) {
        return NextResponse.json({ ok: false, error: 'connectionId is required for connectionStatus action.' }, { status: 400 });
      }
      
      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/connectedAccounts/${connectionId}`, {
          headers: composioHeaders(effectiveApiKey),
          signal: AbortSignal.timeout(10000),
        }),
        'get connection status'
      );
      
      if (!upstream.ok) {
        if (upstream.status === 404) {
          return NextResponse.json({ ok: true, action: 'connectionStatus', connection: null, status: 'not_found' });
        }
        const text = await upstream.text().catch(() => '');
        console.error('Composio connection status error', upstream.status, text.slice(0, 200));
        return handleUpstreamError(upstream.status, text, 'Failed to fetch connection status.');
      }
      
      const data = await upstream.json();
      return NextResponse.json({ ok: true, action: 'connectionStatus', connection: data, status: 'active' });
    }

    if (action === 'refreshToken') {
      // Refresh an OAuth token for a connection.
      const connectionId = (body.appName ?? '').trim();
      if (!connectionId) {
        return NextResponse.json({ ok: false, error: 'connectionId is required for refreshToken action.' }, { status: 400 });
      }
      
      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/connectedAccounts/${connectionId}/refresh`, {
          method: 'POST',
          headers: composioHeaders(effectiveApiKey),
          signal: AbortSignal.timeout(15000),
        }),
        'refresh token'
      );
      
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio token refresh error', upstream.status, text.slice(0, 200));
        return handleUpstreamError(upstream.status, text, 'Failed to refresh token.');
      }
      
      const data = await upstream.json();
      return NextResponse.json({ ok: true, action: 'refreshToken', connection: data });
    }

    if (action === 'connect') {
      const appName = (body.appName ?? '').trim();
      const entityId = (body.entityId ?? 'default').trim();
      const callbackUrl = (body.callbackUrl ?? '').trim();
      if (!appName) {
        return NextResponse.json({ ok: false, error: 'appName is required for connect action.' }, { status: 400 });
      }

      // Step 1: Find auth config for this toolkit (Connect Link requires an authConfigId).
      let authConfigId: string | null = null;
      try {
        const acRes = await fetch(
          `${baseStr}/authConfigs?toolSlug=${encodeURIComponent(appName)}`,
          { headers: composioHeaders(effectiveApiKey), signal: AbortSignal.timeout(10000) }
        );
        if (acRes.ok) {
          const acData = await acRes.json();
          const configs: { id?: string; authConfigId?: string }[] =
            acData.items ?? acData.authConfigs ?? (Array.isArray(acData) ? acData : []);
          const match = configs.find((c) => c.id || c.authConfigId);
          authConfigId = match?.id ?? match?.authConfigId ?? null;
        }
      } catch {
        // fall through to legacy path
      }

      // Step 2: Use Connect Link (new hosted auth flow) if an auth config is available.
      if (authConfigId) {
        const linkBody: Record<string, string> = { authConfigId, userId: entityId };
        if (callbackUrl) linkBody.callbackUrl = callbackUrl;
        const upstream = await retryWithBackoff(
          () => fetch(`${baseStr}/connectedAccounts/link`, {
            method: 'POST',
            headers: composioHeaders(effectiveApiKey),
            body: JSON.stringify(linkBody),
            signal: AbortSignal.timeout(20000),
          }),
          'connect link'
        );
        if (upstream.ok) {
          const data = await upstream.json();
          const redirectUrl = data.redirectUrl ?? data.redirect_url ?? data.connectionRequest?.redirectUrl ?? data.connectionUrl ?? data.connection_url;
          if (redirectUrl) {
            return NextResponse.json({ ok: true, action: 'connect', method: 'link', connection: { redirectUrl, ...data } });
          }
        }
        const text = await upstream.text().catch(() => '');
        console.warn('Composio connect link failed, falling through to legacy initiate', upstream.status, text.slice(0, 200));
      }

      // Step 3: Legacy fallback — POST /connectedAccounts (still works for custom OAuth apps).
      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/connectedAccounts`, {
          method: 'POST',
          headers: composioHeaders(effectiveApiKey),
          body: JSON.stringify({ appName, entityId }),
          signal: AbortSignal.timeout(20000),
        }),
        'initiate connection (legacy)'
      );

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio connect error', upstream.status, text.slice(0, 200));
        if (upstream.status === 400) {
          return NextResponse.json({
            ok: false,
            error: 'No auth config found for this toolkit. Create one at composio.dev/dashboard → Auth Configs, then retry.',
          }, { status: 400 });
        }
        return handleUpstreamError(upstream.status, text, 'Failed to initiate Composio connection.');
      }

      const data = await upstream.json();
      const redirectUrl = data.redirectUrl ?? data.redirect_url ?? data.connectionUrl ?? data.connection_url ?? data.connectionRequest?.redirectUrl;
      return NextResponse.json({ ok: true, action: 'connect', method: 'legacy', connection: { redirectUrl, ...data } });
    }

    if (action === 'disconnect') {
      const connectionId = (body.appName ?? '').trim(); // reuse appName field for connection ID
      if (!connectionId) {
        return NextResponse.json({ ok: false, error: 'connectionId is required for disconnect action.' }, { status: 400 });
      }
      
      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/connectedAccounts/${connectionId}`, {
          method: 'DELETE',
          headers: composioHeaders(effectiveApiKey),
          signal: AbortSignal.timeout(10000),
        }),
        'disconnect account'
      );
      
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio disconnect error', upstream.status);
        return handleUpstreamError(upstream.status, text, 'Failed to disconnect account.');
      }
      
      return NextResponse.json({ ok: true, action: 'disconnect', connectionId });
    }

    if (action === 'execute') {
      const actionId = (body.appName ?? '').trim(); // reuse appName field for action ID
      const entityId = (body.entityId ?? 'default').trim();
      const toolParams = (body.params ?? {}) as Record<string, unknown>; // tool input params
      if (!actionId) {
        return NextResponse.json({ ok: false, error: 'actionId is required for execute action.' }, { status: 400 });
      }

      const upstream = await retryWithBackoff(
        () => fetch(`${baseStr}/actions/${encodeURIComponent(actionId)}/execute`, {
          method: 'POST',
          headers: composioHeaders(effectiveApiKey),
          body: JSON.stringify({ entityId, parameters: toolParams }),
          signal: AbortSignal.timeout(45000),
        }),
        'execute action'
      );

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        console.error('Composio execute error', upstream.status, text.slice(0, 200));

        if (upstream.status === 404) {
          return NextResponse.json({ ok: false, error: 'Action not found or not authorized.' }, { status: 404 });
        }

        return handleUpstreamError(upstream.status, text, 'Composio action execution failed.');
      }

      const data = await upstream.json();
      return NextResponse.json({ ok: true, action: 'execute', result: data });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('Composio proxy error:', err);
    return NextResponse.json({ ok: false, error: 'Composio service is unreachable.' }, { status: 503 });
  }
}
