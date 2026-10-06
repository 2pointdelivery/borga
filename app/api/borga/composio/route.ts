import { NextResponse } from 'next/server';
import { getApiKey, setApiKey, isAllowedKey } from '@/lib/borga/secrets';
import { featureGate } from '@/lib/borga/features-server';
import { composioWorkspaceSession } from '@/lib/borga/session';
import {
  buildFacebookCommentArgs,
  buildInstagramReplyArgs,
  buildLinkedInPostArgs,
  buildTwitterPostArgs,
  extractLinkedInInfo,
  linkedInAuthorUrn,
  normalizeAuthorUrn,
} from '@/lib/borga/social-publish';

export const runtime = 'nodejs';

/**
 * Composio REST proxy, speaking the real Composio v3 dialect (snake_case paths
 * verified against the live OpenAPI spec — the previous camelCase paths
 * 404'd, which broke every Composio caller app-wide).
 *
 * Response shapes are kept stable for existing callers:
 * - list → { apps: [{ key, name, displayName, categories, description }] }
 * - accounts → { accounts: [{ id, appName (toolkit slug), status, entityId }] }
 * - connect → { method: 'link', connection: { redirectUrl } }
 * - execute → { ok, result } with appName carrying the TOOL SLUG
 */

const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/** Toolkits backing social posting, with the Composio-managed auth state probed live. */
const SOCIAL_TOOLKITS = ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest', 'buffer'] as const;

function composioHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
  };
}

function isValidApiKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const v = key.trim();
  // Persisted masks ('[stored server-side]') are not keys — let them fall
  // through to the server-side key instead of 401ing upstream.
  if (!v || v.length <= 8 || /^\[.*\]$/.test(v)) return false;
  return true;
}

function isValidBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The stored default base URL has no version path — normalize anything without /api/vN. */
function normalizeBase(raw: string): string {
  const noSlash = raw.trim().replace(/\/$/, '');
  return /\/api\/v\d+(\.\d+)?$/.test(noSlash) ? noSlash : `${noSlash}/api/v3`;
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

async function validateComposioConnection(apiKey: string, baseUrl: string): Promise<{ connected: boolean; keyInvalid: boolean }> {
  try {
    const response = await fetch(`${baseUrl}/toolkits?limit=1`, {
      headers: composioHeaders(apiKey),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401 || response.status === 403) return { connected: false, keyInvalid: true };
    return { connected: response.ok, keyInvalid: false };
  } catch {
    return { connected: false, keyInvalid: false };
  }
}

function handleUpstreamError(status: number, text: string, defaultMessage: string) {
  if (status === 401 || status === 403) {
    return NextResponse.json({ ok: false, error: 'Invalid Composio API key. Check your API key configuration in the Tools & Integrations tab.' }, { status: 401 });
  }
  if (status === 404) {
    return NextResponse.json({ ok: false, error: `Composio has no such resource (404): ${text.slice(0, 200) || defaultMessage}` }, { status: 502 });
  }
  return NextResponse.json({ ok: false, error: defaultMessage, details: text.slice(0, 200) }, { status: 502 });
}

/** Client-side rejection with a server-log trail (action + reason only — never request bodies or keys). */
function reject(action: string, reason: string, status = 400) {
  console.warn(`Composio ${action} rejected (${status}): ${reason}`);
  return NextResponse.json({ ok: false, error: reason }, { status });
}

interface Body {
  action?: string;
  apiKey?: string;
  appName?: string;
  entityId?: string;
  baseUrl?: string;
  persistKey?: boolean;
  callbackUrl?: string;
  params?: Record<string, unknown>;
  authConfigId?: string;
  connectedAccountId?: string;
  connectionId?: string;
  channel?: string;
  text?: string;
  pageId?: string;
  replyTo?: string;
  userId?: string;
}

async function upstreamJson(url: string, apiKey: string, init?: RequestInit) {
  const res = await retryWithBackoff(
    () => fetch(url, { headers: composioHeaders(apiKey), signal: AbortSignal.timeout(20000), ...init }),
    url,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false as const, status: res.status, text };
  }
  return { ok: true as const, data: await res.json() };
}

const itemsOf = (data: unknown): Record<string, unknown>[] => {
  const d = data as { items?: unknown };
  return Array.isArray(d?.items) ? (d.items as Record<string, unknown>[]) : [];
};

/** Connection id arrives as appName (older callers) or connectionId. */
const connectionRef = (body: Body) => (body.appName ?? body.connectionId ?? '').trim();

export async function POST(req: Request) {
  const off = await featureGate('composio', null, null);
  if (off) return off;
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return reject('(unparsed)', 'Invalid request body.');
  }

  const apiKey = (body.apiKey ?? '').trim();
  const persistKey = body.persistKey === true;

  // Check if we should use stored key
  let effectiveApiKey = apiKey;
  if (!effectiveApiKey) {
    effectiveApiKey = await getApiKey('COMPOSIO_API_KEY');
  }
  const keyFromServer = !apiKey && !!effectiveApiKey;

  // Persist the key if requested and allowed
  if (persistKey && isValidApiKey(effectiveApiKey) && isAllowedKey('COMPOSIO_API_KEY')) {
    await setApiKey('COMPOSIO_API_KEY', effectiveApiKey);
  }

  // Use custom base URL from user config if provided, fall back to default.
  const rawBase = (body.baseUrl ?? COMPOSIO_BASE).trim();

  // Restrict to HTTPS to block SSRF to internal services.
  if (!isValidBaseUrl(rawBase)) {
    return reject(body.action ?? '(unparsed)', 'Composio base URL must be a valid HTTPS URL.');
  }

  // The server-held key must never be sent to a host the operator did not
  // configure: a custom base URL only works with a caller-provided key.
  let customHost = false;
  try {
    customHost = new URL(rawBase).hostname.toLowerCase() !== 'backend.composio.dev';
  } catch {
    return reject(body.action ?? '(unparsed)', 'Composio base URL must be a valid HTTPS URL.');
  }
  if (customHost) effectiveApiKey = apiKey;

  const baseStr = normalizeBase(rawBase);
  const action = body.action ?? 'list';

  // 'validate' deliberately needs no key: it reports whether the SERVER key works,
  // so UIs can enable Composio features without a per-workspace key saved.
  const actionsRequiringKey = ['list', 'authConfigs', 'authConfigCreate', 'tools', 'accounts', 'connect', 'disconnect', 'execute', 'connectionStatus', 'refreshToken', 'socialStatus', 'socialPost', 'mcpSocialSetup'];

  if (actionsRequiringKey.includes(action) && !isValidApiKey(effectiveApiKey)) {
    return reject(action, 'A valid Composio API key is required for this action. Provide it in the request or configure COMPOSIO_API_KEY in your environment.');
  }

  try {
    if (action === 'validate') {
      if (!isValidApiKey(effectiveApiKey)) {
        return NextResponse.json({ ok: true, action: 'validate', connected: false, keyInvalid: false, via: 'none', baseUrl: baseStr });
      }
      const probe = await validateComposioConnection(effectiveApiKey, baseStr);
      return NextResponse.json({ ok: true, action: 'validate', connected: probe.connected, keyInvalid: probe.keyInvalid, via: keyFromServer ? 'server' : 'provided', baseUrl: baseStr });
    }

    if (action === 'list') {
      // Full toolkit catalog — no limit so all integrations are returned.
      const upstream = await upstreamJson(`${baseStr}/toolkits?limit=1000`, effectiveApiKey);
      if (!upstream.ok) {
        console.error('Composio list error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Composio API returned an error.');
      }
      const apps = itemsOf(upstream.data).map((t) => {
        const meta = (t.meta ?? {}) as Record<string, unknown>;
        const cats = (meta.categories ?? []) as { slug?: string }[];
        return {
          key: t.slug,
          name: t.name,
          displayName: t.name,
          categories: cats.map((c) => c.slug ?? '').filter(Boolean),
          tags: cats.map((c) => c.slug ?? '').filter(Boolean),
          description: meta.description ?? '',
        };
      });
      return NextResponse.json({ ok: true, action: 'list', apps });
    }

    if (action === 'authConfigs') {
      // Auth configs for one toolkit.
      const toolSlug = (body.appName ?? '').trim();
      const url = toolSlug
        ? `${baseStr}/auth_configs?toolkit_slug=${encodeURIComponent(toolSlug)}`
        : `${baseStr}/auth_configs?limit=50`;
      const upstream = await upstreamJson(url, effectiveApiKey);
      if (!upstream.ok) {
        console.error('Composio authConfigs error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to fetch auth configs.');
      }
      return NextResponse.json({ ok: true, action: 'authConfigs', configs: itemsOf(upstream.data) });
    }

    if (action === 'authConfigCreate') {
      // One-click Composio-managed auth config for a toolkit (no dashboard round-trip).
      // Fails with a clear message for toolkits without managed credentials (twitter, buffer, tiktok).
      const toolSlug = (body.appName ?? '').trim().toLowerCase();
      if (!toolSlug) {
        return reject('authConfigCreate', 'appName (toolkit slug) is required.');
      }
      const upstream = await upstreamJson(`${baseStr}/auth_configs`, effectiveApiKey, {
        method: 'POST',
        body: JSON.stringify({ toolkit: { slug: toolSlug } }),
      });
      if (!upstream.ok) {
        if (upstream.status === 404) {
          return NextResponse.json({
            ok: false,
            error: `Composio has no managed credentials for "${toolSlug}". Create a custom auth config at composio.dev/dashboard → Auth Configs (your own developer app), then connect.`,
          }, { status: 400 });
        }
        console.error('Composio authConfigCreate error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to create auth config.');
      }
      const cfg = (upstream.data as { auth_config?: Record<string, unknown> }).auth_config ?? {};
      return NextResponse.json({ ok: true, action: 'authConfigCreate', config: { id: cfg.id, ...cfg } });
    }

    if (action === 'tools') {
      // Tool schemas for a toolkit — the live catalog calls this when a card
      // is expanded, so the panel shows the real action list, not a guess.
      const toolkit = (body.appName ?? '').trim().toLowerCase();
      if (!toolkit) {
        return reject('tools', 'appName (toolkit slug) is required.');
      }
      const upstream = await upstreamJson(`${baseStr}/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=200`, effectiveApiKey);
      if (!upstream.ok) {
        console.error('Composio tools error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to fetch tools.');
      }
      const tools = itemsOf(upstream.data).map((t) => ({
        slug: (t.slug ?? t.name ?? '') as string,
        description: ((t.description ?? '') as string).slice(0, 200),
        toolkit: ((t.toolkit as { slug?: string })?.slug ?? '').toLowerCase(),
      })).filter((t) => t.slug);
      return NextResponse.json({ ok: true, action: 'tools', tools });
    }

    const listAccounts = async () => {
      const upstream = await upstreamJson(`${baseStr}/connected_accounts?limit=50`, effectiveApiKey);
      if (!upstream.ok) return upstream;
      const accounts = itemsOf(upstream.data).map((a) => {
        const toolkit = (a.toolkit ?? {}) as { slug?: string; name?: string };
        return {
          id: a.id,
          appName: toolkit.slug ?? (a.toolkit_slug as string) ?? (a.appName as string) ?? '',
          appLabel: toolkit.name ?? '',
          status: a.status ?? '',
          entityId: (a.user_id as string) ?? (a.userId as string) ?? (a.entity_id as string) ?? '',
          ...a,
        };
      });
      return { ok: true as const, accounts };
    };

    if (action === 'accounts') {
      const upstream = await listAccounts();
      if (!upstream.ok) {
        console.error('Composio accounts error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to fetch connected accounts.');
      }
      return NextResponse.json({ ok: true, action: 'accounts', accounts: upstream.accounts });
    }

    if (action === 'connectionStatus') {
      // Check status of a specific connection.
      const connectionId = connectionRef(body);
      if (!connectionId) {
        return reject('connectionStatus', 'connectionId is required for connectionStatus action.');
      }

      const upstream = await upstreamJson(`${baseStr}/connected_accounts/${encodeURIComponent(connectionId)}`, effectiveApiKey);
      if (!upstream.ok) {
        if (upstream.status === 404) {
          return NextResponse.json({ ok: true, action: 'connectionStatus', connection: null, status: 'not_found' });
        }
        console.error('Composio connection status error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to fetch connection status.');
      }
      return NextResponse.json({ ok: true, action: 'connectionStatus', connection: upstream.data, status: 'active' });
    }

    if (action === 'refreshToken') {
      // Re-initiate authentication for a connection (Composio marks this deprecated; prefer reconnect).
      const connectionId = connectionRef(body);
      if (!connectionId) {
        return reject('refreshToken', 'connectionId is required for refreshToken action.');
      }

      const upstream = await upstreamJson(`${baseStr}/connected_accounts/${encodeURIComponent(connectionId)}/refresh`, effectiveApiKey, { method: 'POST' });
      if (!upstream.ok) {
        console.error('Composio token refresh error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to refresh token. Reconnect the account instead.');
      }
      return NextResponse.json({ ok: true, action: 'refreshToken', connection: upstream.data });
    }

    if (action === 'connect') {
      const appName = (body.appName ?? '').trim().toLowerCase();
      const entityId = (body.entityId ?? 'default').trim() || 'default';
      const callbackUrl = (body.callbackUrl ?? '').trim();
      if (!appName) {
        return reject('connect', 'appName is required for connect action.');
      }

      // An explicit auth config wins; otherwise use the toolkit's managed (or first) config.
      // A rejected key must surface as invalid-key, not as "no auth config".
      let authConfigId: string | null = (body.authConfigId ?? '').trim() || null;
      if (!authConfigId) {
        const acRes = await upstreamJson(`${baseStr}/auth_configs?toolkit_slug=${encodeURIComponent(appName)}`, effectiveApiKey);
        if (!acRes.ok) {
          if (acRes.status === 401 || acRes.status === 403) {
            return handleUpstreamError(acRes.status, acRes.text, 'Composio rejected the API key.');
          }
        } else {
          const configs = itemsOf(acRes.data);
          const managed = configs.find((c) => c.is_composio_managed) ?? configs[0];
          authConfigId = (managed?.id ?? managed?.auth_config_id ?? null) as string | null;
        }
      }
      if (!authConfigId) {
        return NextResponse.json({
          ok: false,
          error: `No auth config found for "${appName}". Create one at composio.dev/dashboard → Auth Configs (or use the one-click managed setup where offered), then retry.`,
        }, { status: 400 });
      }

      // Composio Connect Link: hosted sign-in page, tokens stay at Composio.
      const linkBody: Record<string, string> = { auth_config_id: authConfigId, user_id: entityId };
      if (callbackUrl) linkBody.callback_url = callbackUrl;
      const upstream = await upstreamJson(`${baseStr}/connected_accounts/link`, effectiveApiKey, {
        method: 'POST',
        body: JSON.stringify(linkBody),
      });
      if (!upstream.ok) {
        console.error('Composio connect link error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to initiate Composio connection.');
      }
      const data = upstream.data as Record<string, unknown>;
      const redirectUrl = (data.redirect_url ?? data.redirectUrl ?? '') as string;
      if (!redirectUrl) {
        return NextResponse.json({ ok: false, error: 'Composio returned no sign-in URL for this toolkit.' }, { status: 502 });
      }
      return NextResponse.json({ ok: true, action: 'connect', method: 'link', connection: { redirectUrl, ...data } });
    }

    if (action === 'disconnect') {
      const connectionId = connectionRef(body);
      if (!connectionId) {
        return reject('disconnect', 'connectionId is required for disconnect action.');
      }

      const upstream = await upstreamJson(`${baseStr}/connected_accounts/${encodeURIComponent(connectionId)}`, effectiveApiKey, { method: 'DELETE' });
      if (!upstream.ok) {
        console.error('Composio disconnect error', upstream.status);
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to disconnect account.');
      }
      return NextResponse.json({ ok: true, action: 'disconnect', connectionId });
    }

    const executeTool = async (toolSlug: string, args: Record<string, unknown>, userId: string, connectedAccountId?: string) => {
      const payload: Record<string, unknown> = { user_id: userId, arguments: args };
      if (connectedAccountId) payload.connected_account_id = connectedAccountId;
      // Pinned toolkit defaults go stale (officially: LinkedIn created a v20241101
      // post in Sep 2026 which 426ed). Choose the current toolkit version.
      payload.version = 'latest';
      return upstreamJson(`${baseStr}/tools/execute/${encodeURIComponent(toolSlug)}`, effectiveApiKey, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    };

    if (action === 'execute') {
      const actionId = (body.appName ?? '').trim(); // reuse appName field for the TOOL SLUG
      const entityId = (body.entityId ?? 'default').trim() || 'default';
      const toolParams = (body.params ?? {}) as Record<string, unknown>;
      if (!actionId) {
        return reject('execute', 'actionId is required for execute action.');
      }

      const upstream = await executeTool(actionId, toolParams, entityId, body.connectedAccountId?.trim() || undefined);
      if (!upstream.ok) {
        console.error('Composio execute error', upstream.status, upstream.text.slice(0, 200));
        if (upstream.status === 404) {
          return NextResponse.json({ ok: false, error: 'Action not found or not authorized.' }, { status: 404 });
        }
        return handleUpstreamError(upstream.status, upstream.text, 'Composio action execution failed.');
      }
      const data = upstream.data as { data?: unknown; error?: string | null; successful?: boolean; log_id?: string };
      if (data && data.successful === false) {
        return NextResponse.json({ ok: false, error: data.error ?? 'The tool reported failure.', result: data.data }, { status: 502 });
      }
      return NextResponse.json({ ok: true, action: 'execute', result: data?.data ?? data });
    }

    const activeAccountFor = async (toolkit: string, userId: string) => {
      const upstream = await listAccounts();
      if (!upstream.ok) return null;
      return upstream.accounts.find(
        (a) => String(a.appName ?? '').toLowerCase() === toolkit.toLowerCase()
          && String(a.entityId ?? '') === userId
          && String(a.status ?? '').toUpperCase() === 'ACTIVE',
      ) ?? upstream.accounts.find(
        (a) => String(a.appName ?? '').toLowerCase() === toolkit.toLowerCase()
          && String(a.status ?? '').toUpperCase() === 'ACTIVE',
      ) ?? null;
    };

    if (action === 'socialStatus') {
      // One call for the Social tab: ACTIVE account per social toolkit for this user.
      const userId = (body.entityId ?? 'default').trim() || 'default';
      const upstream = await listAccounts();
      if (!upstream.ok) {
        console.error('Composio socialStatus error', upstream.status, upstream.text.slice(0, 200));
        return handleUpstreamError(upstream.status, upstream.text, 'Failed to fetch connected accounts.');
      }
      const channels: Record<string, { connected: boolean; accountId?: string; status?: string }> = {};
      for (const slug of SOCIAL_TOOLKITS) {
        const match = upstream.accounts.find(
          (a) => String(a.appName ?? '').toLowerCase() === slug
            && (String(a.entityId ?? '') === userId || !a.entityId),
        );
        channels[slug] = match
          ? { connected: String(match.status ?? '').toUpperCase() === 'ACTIVE', accountId: String(match.id ?? ''), status: String(match.status ?? '') }
          : { connected: false };
      }
      return NextResponse.json({ ok: true, action: 'socialStatus', channels });
    }

    if (action === 'socialPost') {
      // Live posting for channels with a directly-postable action; everything
      // else comes back as queued:true with the reason, so the UI can keep it
      // as a scheduled draft instead of failing.
      const channel = (body.channel ?? '').trim().toLowerCase();
      const text = (body.text ?? '').trim();
      const userId = (body.entityId ?? 'default').trim() || 'default';
      if (!channel || !text) {
        return reject('socialPost', 'channel and text are required.');
      }

      const queued = (reason: string) => NextResponse.json({ ok: true, action: 'socialPost', posted: false, queued: true, reason });

      if (channel === 'linkedin') {
        const account = await activeAccountFor('linkedin', userId);
        if (!account) return queued('No linked LinkedIn account — connect LinkedIn first, or keep this as a scheduled draft.');
        // Session seam (@composio/core), best-effort: interactive agents get a
        // session-scoped authorize link when the REST-linked account isn't in
        // the session yet. Never blocks the REST path (which posts with the
        // pinned account).
        void composioWorkspaceSession(userId).then((s) => s?.ensureConnected?.('linkedin').catch(() => undefined)).catch(() => undefined);
        // Resolve the author URN for the linked account, then post.
        // The account id is pinned so multi-account users always post as the linked identity.
        const accountId = String(account.id ?? '');
        const me = await executeTool('LINKEDIN_GET_MY_INFO', {}, userId, accountId || undefined);
        if (!me.ok) return queued(`LinkedIn is linked but the author lookup failed (${me.status}). Kept as a scheduled draft.`);
        const info = extractLinkedInInfo((me.data as { data?: unknown })?.data ?? me.data);
        const author = linkedInAuthorUrn(info);
        if (!author) {
          return queued('LinkedIn is linked but no author URN came back — kept as a scheduled draft. Reconnect LinkedIn and retry.');
        }
        const post = await executeTool('LINKEDIN_CREATE_LINKED_IN_POST', buildLinkedInPostArgs(normalizeAuthorUrn(author), text), userId, accountId || undefined);
        if (!post.ok) return queued(`LinkedIn refused the post (${post.status}). Kept as a scheduled draft.`);
        const pdata = (post.data as { data?: unknown })?.data ?? post.data;
        return NextResponse.json({ ok: true, action: 'socialPost', posted: true, result: pdata });
      }

      if (channel === 'twitter') {
        const account = await activeAccountFor('twitter', userId);
        if (!account) return queued('No linked X account — connect X first, or keep this as a scheduled draft.');
        const accountId = String(account.id ?? '');
        const post = await executeTool('TWITTER_CREATION_OF_A_POST', buildTwitterPostArgs(text), userId, accountId || undefined);
        if (!post.ok) return queued(`X refused the post (${post.status}). Kept as a scheduled draft.`);
        const pdata = (post.data as { data?: unknown })?.data ?? post.data;
        return NextResponse.json({ ok: true, action: 'socialPost', posted: true, result: pdata });
      }

      if (channel === 'facebook') {
        const account = await activeAccountFor('facebook', userId);
        if (!account) return queued('No linked Facebook account — connect Facebook first, or keep this as a scheduled draft.');
        return queued('Facebook posting needs a Page ID — pick the Page in the connect step or publish via Buffer. Kept as a scheduled draft.');
      }
      if (channel === 'instagram') {
        const account = await activeAccountFor('instagram', userId);
        if (!account) return queued('No linked Instagram account — connect Instagram first, or keep this as a scheduled draft.');
        return queued('Instagram needs an image or video container — attach media to post it live. Kept as a scheduled draft.');
      }
      if (channel === 'youtube' || channel === 'tiktok' || channel === 'pinterest') {
        return queued(`${channel === 'youtube' ? 'YouTube' : channel === 'tiktok' ? 'TikTok' : 'Pinterest'} needs media (video/photo) — attach it to publish live. Kept as a scheduled draft.`);
      }
      if (channel === 'threads') {
        return queued('Threads has no Composio toolkit yet — posts stay planned here until posting is available.');
      }
      return queued(`Unknown channel "${channel}". Kept as a scheduled draft.`);
    }

    if (action === 'socialReply') {
      // Audience replies from inside the system: X threads, Facebook comments,
      // Instagram comment replies. Needs the target id (post/tweet/comment).
      const channel = (body.channel ?? '').trim().toLowerCase();
      const text = (body.text ?? '').trim();
      const replyTo = (body.replyTo ?? '').trim() || (body.pageId ?? '').trim();
      const userId = (body.entityId ?? 'default').trim() || 'default';
      if (!channel || !text || !replyTo) {
        return reject('socialReply', 'channel, text and replyTo are required.');
      }
      if (channel === 'twitter') {
        const account = await activeAccountFor('twitter', userId);
        if (!account) return NextResponse.json({ ok: false, error: 'No linked X account.' }, { status: 400 });
        const post = await executeTool('TWITTER_CREATION_OF_A_POST', buildTwitterPostArgs(text, replyTo), userId, String(account.id ?? '') || undefined);
        if (!post.ok) return NextResponse.json({ ok: false, error: `X refused the reply (${post.status}).` }, { status: 502 });
        return NextResponse.json({ ok: true, action: 'socialReply', posted: true, result: (post.data as { data?: unknown })?.data ?? post.data });
      }
      if (channel === 'facebook') {
        const account = await activeAccountFor('facebook', userId);
        if (!account) return NextResponse.json({ ok: false, error: 'No linked Facebook account.' }, { status: 400 });
        const post = await executeTool('FACEBOOK_CREATE_COMMENT', buildFacebookCommentArgs(replyTo, text), userId, String(account.id ?? '') || undefined);
        if (!post.ok) return NextResponse.json({ ok: false, error: `Facebook refused the comment (${post.status}).` }, { status: 502 });
        return NextResponse.json({ ok: true, action: 'socialReply', posted: true, result: (post.data as { data?: unknown })?.data ?? post.data });
      }
      if (channel === 'instagram') {
        const account = await activeAccountFor('instagram', userId);
        if (!account) return NextResponse.json({ ok: false, error: 'No linked Instagram account.' }, { status: 400 });
        const post = await executeTool('INSTAGRAM_REPLY_TO_COMMENT', buildInstagramReplyArgs(replyTo, text), userId, String(account.id ?? '') || undefined);
        if (!post.ok) return NextResponse.json({ ok: false, error: `Instagram refused the reply (${post.status}).` }, { status: 502 });
        return NextResponse.json({ ok: true, action: 'socialReply', posted: true, result: (post.data as { data?: unknown })?.data ?? post.data });
      }
      return NextResponse.json({ ok: false, error: `Replies are not available for ${channel} yet.` }, { status: 400 });
    }

    if (action === 'mcpSocialSetup') {
      // One-click Composio-hosted MCP for social: managed auth configs →
      // "Borga Social" MCP server → scoped URL for this user. Idempotent.
      const userId = (body.entityId ?? 'default').trim() || 'default';
      const managedSlugs = ['linkedin', 'facebook', 'instagram', 'youtube', 'pinterest'];
      const authConfigIds: string[] = [];
      const manual: string[] = [];
      for (const slug of managedSlugs) {
        const existing = await upstreamJson(`${baseStr}/auth_configs?toolkit_slug=${encodeURIComponent(slug)}`, effectiveApiKey);
        const found = existing.ok ? itemsOf(existing.data)[0] : null;
        const id = (found?.id ?? found?.auth_config_id ?? '') as string;
        if (id) { authConfigIds.push(id); continue; }
        const created = await upstreamJson(`${baseStr}/auth_configs`, effectiveApiKey, {
          method: 'POST',
          body: JSON.stringify({ toolkit: { slug } }),
        });
        const cfg = created.ok ? ((created.data as { auth_config?: Record<string, unknown> }).auth_config ?? {}) : {};
        const newId = (cfg.id ?? '') as string;
        if (created.ok && newId) authConfigIds.push(newId);
        else manual.push(slug);
      }
      // Custom-auth-only toolkits can never be one-click.
      manual.push('twitter', 'buffer', 'tiktok');

      // Reuse the existing server when present.
      let serverId: string | null = null;
      const servers = await upstreamJson(`${baseStr}/mcp/servers?limit=50`, effectiveApiKey);
      if (servers.ok) {
        const match = itemsOf(servers.data).find((s) => s.name === 'Borga Social');
        serverId = (match?.id ?? null) as string | null;
      }
      if (!serverId) {
        const created = await upstreamJson(`${baseStr}/mcp/servers`, effectiveApiKey, {
          method: 'POST',
          body: JSON.stringify({ name: 'Borga Social', auth_config_ids: authConfigIds }),
        });
        if (!created.ok) {
          console.error('Composio mcpSocialSetup server error', created.status, created.text.slice(0, 200));
          return handleUpstreamError(created.status, created.text, 'Failed to create the hosted MCP server.');
        }
        serverId = ((created.data as { id?: string }).id ?? null) as string | null;
      }
      if (!serverId) {
        return NextResponse.json({ ok: false, error: 'Composio created no MCP server.' }, { status: 502 });
      }
      const gen = await upstreamJson(`${baseStr}/mcp/servers/generate`, effectiveApiKey, {
        method: 'POST',
        body: JSON.stringify({ mcp_server_id: serverId, user_ids: [userId] }),
      });
      if (!gen.ok) {
        console.error('Composio mcpSocialSetup generate error', gen.status, gen.text.slice(0, 200));
        return handleUpstreamError(gen.status, gen.text, 'Failed to generate the MCP URL.');
      }
      const gdata = gen.data as { mcp_url?: string; user_ids_url?: string[] };
      const url = gdata.user_ids_url?.[0] ?? gdata.mcp_url ?? '';
      return NextResponse.json({ ok: true, action: 'mcpSocialSetup', serverId, url, userId, manual });
    }

    return reject(action, `Unknown action: ${action}`);
  } catch (err) {
    console.error('Composio proxy error:', err);
    return NextResponse.json({ ok: false, error: 'Composio service is unreachable.' }, { status: 503 });
  }
}
