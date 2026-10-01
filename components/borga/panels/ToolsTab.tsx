'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  Plus,
  PlugZap,
  Search,
  Unplug,
  ShieldCheck,
  Cpu,
  AudioLines,
  CircleCheck,
  Radio,
  KeyRound,
  Save,
  Eye,
  EyeOff,
  Check,
  Trash2,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Lock,
  Phone,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { LLM_PROVIDERS, VOICE_PROVIDERS, EMAIL_APPS, COMPOSIO_TOOLKITS, type AppConnection, type EmailApp, type Toolkit } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { ModelCatalogEditor } from './ModelCatalogEditor';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast-bus';

// ─── Types ───────────────────────────────────────────────────────────────────

type ComposioApp = {
  key?: string;
  name?: string;
  displayName?: string;
  description?: string;
  categories?: string[];
  tags?: string[];
};

type KeyStatus = {
  envVar: string;
  label: string;
  hint: string;
  kind: 'key' | 'url';
  configured: boolean;
  source: 'env' | 'db' | 'none';
  masked: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TOOLKIT_CONN: Record<string, string> = {
  Gmail: 'cn-gmail',
  'Google Calendar': 'cn-calendar',
  'Google Drive': 'cn-drive',
  Slack: 'cn-slack',
  HubSpot: 'cn-hubspot',
  Stripe: 'cn-stripe',
  LinkedIn: 'cn-linkedin',
};

const TYPE_STYLE: Record<AppConnection['type'], string> = {
  tool: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  llm: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  voice: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
};

// Maps each LLM provider ID to the env var(s) it needs
const LLM_KEY_MAP: Record<string, { envVar: string; label: string; kind: 'key' | 'url'; hint: string; extra?: { envVar: string; label: string; kind: 'key' | 'url'; hint: string } }> = {
  'llm-groq': { envVar: 'GROQ_API_KEY', label: 'API key', kind: 'key', hint: 'console.groq.com — free tier' },
  'llm-nvidia': { envVar: 'NVIDIA_API_KEY', label: 'API key', kind: 'key', hint: 'build.nvidia.com' },
  'llm-gemini': { envVar: 'GEMINI_API_KEY', label: 'API key', kind: 'key', hint: 'aistudio.google.com/apikey' },
  'llm-claude': { envVar: 'ANTHROPIC_API_KEY', label: 'API key', kind: 'key', hint: 'console.anthropic.com' },
  'llm-openai': { envVar: 'OPENAI_API_KEY', label: 'API key', kind: 'key', hint: 'platform.openai.com/api-keys' },
  'llm-openrouter': { envVar: 'OPENROUTER_API_KEY', label: 'API key', kind: 'key', hint: 'openrouter.ai/keys' },
  'llm-ollama': { envVar: 'OLLAMA_BASE_URL', label: 'Base URL', kind: 'url', hint: 'default: http://127.0.0.1:11434/v1' },
  'llm-custom': {
    envVar: 'LLM_BASE_URL', label: 'Base URL', kind: 'url', hint: 'e.g. http://localhost:8000/v1',
    extra: { envVar: 'LLM_API_KEY', label: 'API key', kind: 'key', hint: 'Bearer token for your endpoint' },
  },
};

const VOICE_KEY_MAP: Record<string, { envVar: string; label: string; hint: string }> = {
  'voice-elevenlabs': { envVar: 'ELEVENLABS_API_KEY', label: 'API key', hint: 'elevenlabs.io/app/api-key' },
};

const TWILIO_KEYS: { envVar: string; label: string; kind: 'key' | 'url'; hint: string }[] = [
  { envVar: 'TWILIO_ACCOUNT_SID', label: 'Account SID', kind: 'key', hint: 'console.twilio.com' },
  { envVar: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', kind: 'key', hint: 'console.twilio.com' },
  { envVar: 'TWILIO_FROM_PHONE', label: 'From Number', kind: 'url', hint: 'E.164, e.g. +14155550100 — your Twilio caller ID' },
];

const SMTP_KEYS: { envVar: string; label: string; kind: 'key' | 'url'; hint: string }[] = [
  { envVar: 'SMTP_HOST', label: 'SMTP Host', kind: 'url', hint: 'e.g. smtp.gmail.com or smtp.sendgrid.net' },
  { envVar: 'SMTP_PORT', label: 'SMTP Port', kind: 'key', hint: '587 (STARTTLS) or 465 (SSL)' },
  { envVar: 'SMTP_USER', label: 'SMTP Username', kind: 'key', hint: 'Account / API user' },
  { envVar: 'SMTP_PASS', label: 'SMTP Password', kind: 'key', hint: 'App password or API key' },
  { envVar: 'SMTP_SECURE', label: 'SMTP Secure', kind: 'key', hint: 'Set "true" for port 465 (SSL)' },
  { envVar: 'EMAIL_FROM', label: 'From Address', kind: 'url', hint: 'e.g. Borga <noreply@yourdomain.com>' },
];

const WIGOLO_KEYS: { envVar: string; label: string; kind: 'key' | 'url'; hint: string }[] = [
  { envVar: 'WIGOLO_BASE_URL', label: 'Wigolo daemon URL', kind: 'url', hint: 'default: http://127.0.0.1:3333 — run "npx wigolo serve"' },
  { envVar: 'WIGOLO_API_TOKEN', label: 'Wigolo API token', kind: 'key', hint: 'only needed if wigolo is bound past loopback (non-default host)' },
];

// ─── InlineKeyInput ───────────────────────────────────────────────────────────

function InlineKeyInput({
  envVar, label, hint, kind, status, onRefresh,
}: {
  envVar: string; label: string; hint: string; kind: 'key' | 'url'; status: KeyStatus | undefined; onRefresh: () => void;
}) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  const isEnv = status?.source === 'env';
  const isDb = status?.source === 'db';

  const doSave = async () => {
    if (!value.trim()) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/borga/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'set', envVar, value: value.trim() }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        setSaved(true); setValue('');
        setTimeout(() => setSaved(false), 2500);
        onRefresh();
      } else {
        setError(d.error ?? 'Failed to save.');
      }
    } catch {
      setError('Network error — try again.');
    } finally {
      setSaving(false);
    }
  };

  const doClear = async () => {
    setClearing(true); setError('');
    try {
      await fetch('/api/borga/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'delete', envVar }),
      });
      onRefresh();
    } catch {
      setError('Network error.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {isEnv && <Badge variant="secondary" className="text-[10px]">via .env</Badge>}
        {isDb && <Badge className="bg-emerald-500/10 text-emerald-600 text-[10px]"><Check className="mr-0.5 h-2.5 w-2.5" /> saved</Badge>}
        {!isEnv && !isDb && <Badge variant="outline" className="text-[10px] text-muted-foreground">not set</Badge>}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {isEnv ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
          <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="flex-1 font-mono text-muted-foreground">{status?.masked}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">set in .env</span>
        </div>
      ) : (
        <>
          {isDb && status?.masked && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-1 text-xs">
              <span className="flex-1 font-mono text-muted-foreground">{status.masked}</span>
              <span className="text-[10px] text-muted-foreground">encrypted</span>
            </div>
          )}
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSave()}
                placeholder={kind === 'url' ? 'https://…' : isDb ? 'New value to replace…' : 'Paste here…'}
                autoComplete="new-password"
                className="pr-8 font-mono text-xs h-8"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button size="sm" className="h-8 shrink-0 gap-1 px-2.5" disabled={!value.trim() || saving} onClick={doSave}>
              {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : <Save className="h-3 w-3" />}
              <span>{saved ? 'Saved' : 'Save'}</span>
            </Button>
            {isDb && (
              <Button size="sm" variant="outline" className="h-8 shrink-0 px-2 text-destructive hover:text-destructive" disabled={clearing} onClick={doClear}>
                {clearing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </Button>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type OauthTarget = {
  connectionId: string;
  label: string;
  appName: string;
};

export type ToolsSection = 'ai-providers' | 'email' | 'composio' | 'apps';

/**
 * Renders one slice of the integration surface. All hooks stay mounted so
 * switching sections never loses OAuth/key state; only the JSX output changes.
 */
export function ToolsTab({ section = 'ai-providers' }: { section?: ToolsSection }) {
  const { toolkits, installToolkit, uninstallToolkit, connections, connectApp, log, composio, setComposio, addComposioConnection, removeComposioConnection, updateComposioConnection, llmCatalog, mcpServers, addMcpServer, updateMcpServer, deleteMcpServer, activeWorkspaceId, llm, setDefaultLlm, elevenlabs, setElevenlabs } = useBorga();
  // Dynamic, per-workspace catalog (DB-backed); falls back to the seed list.
  const catalog = llmCatalog && llmCatalog.length ? llmCatalog : LLM_PROVIDERS;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [oauth, setOauth] = useState<OauthTarget | null>(null);
  const [account, setAccount] = useState('');
  const [agree, setAgree] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // OAuth state shared by email + toolkit cards
  const [oauthConnecting, setOauthConnecting] = useState<string | null>(null);
  const [oauthStatuses, setOauthStatuses] = useState<Record<string, 'connected' | 'connecting' | 'off'>>({});

  // Live Composio catalog — user-triggered refresh (not auto-fetched to avoid startup 502s)
  const [liveToolkits, setLiveToolkits] = useState<Toolkit[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const refreshCatalog = useCallback(async () => {
    if (!composio.apiKey || catalogLoading) return;
    setCatalogLoading(true);
    try {
      const r = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'list', apiKey: composio.apiKey }),
      });
      const d = await r.json() as { ok: boolean; apps?: ComposioApp[] };
      if (!d.ok || !d.apps) return;
      const staticIds = new Set(COMPOSIO_TOOLKITS.map((t) => t.composioAppName));
      const live: Toolkit[] = d.apps
        .filter((a) => a.key || a.name)
        .map((a) => {
          const appKey = (a.key ?? a.name ?? '').toLowerCase();
          const cats: string[] = Array.isArray(a.categories) ? a.categories : a.tags ?? [];
          const cat = cats[0] ? cats[0].charAt(0).toUpperCase() + cats[0].slice(1) : 'Other';
          return {
            id: `tk-live-${appKey}`,
            name: a.displayName ?? a.name ?? appKey,
            category: cat,
            composioAppName: appKey,
            description: a.description ?? `Connect ${a.displayName ?? a.name ?? appKey} to your agent fleet.`,
          };
        })
        .filter((t) => !staticIds.has(t.composioAppName));
      setLiveToolkits(live);
    } catch {
      // silently keep static list
    } finally {
      setCatalogLoading(false);
    }
  }, [composio.apiKey, catalogLoading]);


  const connectViaOAuth = async (id: string, composioAppName: string, label: string, connId?: string) => {
    if (!composio.apiKey) return;
    setOauthConnecting(id);
    setOauthStatuses((s) => ({ ...s, [id]: 'connecting' }));
    if (connId) connectApp(connId, { status: 'connecting', account: '', lastSync: 'Connecting…' });
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'connect', appName: composioAppName, entityId: 'default', apiKey: composio.apiKey }),
      });
      const d = await res.json() as { ok: boolean; method?: string; connection?: { redirectUrl?: string; redirect_url?: string } };
      const redirectUrl = d.connection?.redirectUrl ?? d.connection?.redirect_url;
      if (d.ok && redirectUrl) {
        window.open(redirectUrl, '_blank', 'noopener,noreferrer,width=640,height=720');
        let polls = 0;
        const interval = setInterval(async () => {
          polls++;
          if (polls > 30) {
            clearInterval(interval);
            setOauthConnecting(null);
            setOauthStatuses((s) => ({ ...s, [id]: 'off' }));
            if (connId) connectApp(connId, { status: 'off', lastSync: '…' });
            return;
          }
          try {
            const pr = await fetch('/api/borga/composio', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
              body: JSON.stringify({ action: 'accounts', apiKey: composio.apiKey }),
            });
            const pd = await pr.json() as { ok: boolean; error?: string; accounts?: { appName?: string; status?: string }[] };
            if (!pd.ok) {
              clearInterval(interval);
              setOauthConnecting(null);
              setOauthStatuses((s) => ({ ...s, [id]: 'off' }));
              if (connId) connectApp(connId, { status: 'error', lastSync: pd.error ?? 'Authentication failed' });
              return;
            }
            const found = pd.accounts?.find((a) => a.appName?.toLowerCase() === composioAppName.toLowerCase() && a.status === 'ACTIVE');
            if (found) {
              clearInterval(interval);
              setOauthStatuses((s) => ({ ...s, [id]: 'connected' }));
              setOauthConnecting(null);
              if (connId) connectApp(connId, { status: 'connected', account: 'OAuth authorized', lastSync: 'Just now', scopes: 'OAuth authorized' });
              log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: `${label} connected via OAuth.` });
            }
          } catch { /* ignore poll errors */ }
        }, 2000);
      } else {
        setOauthStatuses((s) => ({ ...s, [id]: 'off' }));
        setOauthConnecting(null);
        if (connId) connectApp(connId, { status: 'error', lastSync: 'No redirect URL returned' });
      }
    } catch {
      setOauthStatuses((s) => ({ ...s, [id]: 'off' }));
      setOauthConnecting(null);
      if (connId) connectApp(connId, { status: 'error', lastSync: 'Error' });
    }
  };

  const connectEmail = async (app: EmailApp) => connectViaOAuth(app.id, app.composioAppName, app.label);

  // Composio config
  const [apiKey, setApiKey] = useState(composio.apiKey);
  const [baseUrl, setBaseUrl] = useState(composio.baseUrl);
  const [showKey, setShowKey] = useState(false);

  // LLM / Voice key statuses from server
  const [keys, setKeys] = useState<Record<string, KeyStatus>>({});
  const [keysLoading, setKeysLoading] = useState(true);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  // Per-provider live test result and the model picked before a provider becomes the default.
  const [llmTests, setLlmTests] = useState<Record<string, { busy: boolean; ok?: boolean; msg?: string }>>({});
  const [modelChoice, setModelChoice] = useState<Record<string, string>>({});

  const testLlm = async (providerId: string, model: string) => {
    setLlmTests((t) => ({ ...t, [providerId]: { busy: true } }));
    try {
      const res = await fetch('/api/borga/llm-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws: activeWorkspaceId, providerId, model }),
      });
      const d = (await res.json()) as { ok: boolean; latencyMs?: number; error?: string; note?: string };
      setLlmTests((t) => ({ ...t, [providerId]: { busy: false, ok: d.ok, msg: d.ok ? (d.note ?? ('Replied in ' + d.latencyMs + ' ms')) : d.error } }));
      // Measured, not assumed: record real latency/online state on the default provider.
      if (providerId === llm.providerId) setDefaultLlm({ online: d.ok, latency: d.ok ? (d.latencyMs ?? 0) : 0 });
    } catch (e) {
      setLlmTests((t) => ({ ...t, [providerId]: { busy: false, ok: false, msg: (e as Error).message } }));
    }
  };

  // Track which provider cards show key input
  const toggleExpand = (id: string) =>
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const res = await fetch('/api/borga/config');
      const d = (await res.json()) as { keys: KeyStatus[] };
      const map: Record<string, KeyStatus> = {};
      for (const k of d.keys) map[k.envVar] = k;
      setKeys(map);
    } catch {
      // silently ignore
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  // SMTP test email
  const [smtpTestTo, setSmtpTestTo] = useState('');
  const [smtpSending, setSmtpSending] = useState(false);

  // Wigolo (web research) connection test
  const [wigoloTesting, setWigoloTesting] = useState(false);
  const [wigoloResult, setWigoloResult] = useState<{ ok: boolean; message: string } | null>(null);

  const testWigolo = async () => {
    setWigoloTesting(true);
    setWigoloResult(null);
    try {
      const res = await fetch('/api/borga/wigolo');
      const d = (await res.json()) as { ok: boolean; base: string; health?: { status?: string; browsers?: string; cache?: string }; error?: string };
      if (d.ok) {
        setWigoloResult({ ok: true, message: `Connected to ${d.base} — ${d.health?.status ?? 'healthy'} (browsers: ${d.health?.browsers ?? '—'}, cache: ${d.health?.cache ?? '—'})` });
      } else {
        setWigoloResult({ ok: false, message: d.error ?? `Could not reach wigolo at ${d.base}.` });
      }
    } catch {
      setWigoloResult({ ok: false, message: 'Network error while checking wigolo.' });
    } finally {
      setWigoloTesting(false);
    }
  };

  // ── Generic MCP server connections ──────────────────────────────────────
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpAuthType, setMcpAuthType] = useState<'none' | 'bearer' | 'oauth'>('none');
  const [mcpToken, setMcpToken] = useState('');
  const [mcpAdding, setMcpAdding] = useState(false);
  const [mcpAddError, setMcpAddError] = useState('');
  const [mcpBusyId, setMcpBusyId] = useState<string | null>(null);
  const [mcpTokenDrafts, setMcpTokenDrafts] = useState<Record<string, string>>({});

  const mcpApi = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/borga/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ ...payload, ws: activeWorkspaceId }),
    });
    return (await res.json()) as { ok: boolean; error?: string; tools?: { name: string; description?: string }[]; metadata?: { authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint?: string; clientId: string }; authorizeUrl?: string; connected?: boolean };
  };

  const addServer = async () => {
    if (!mcpName.trim() || !mcpUrl.trim() || mcpAdding) return;
    setMcpAdding(true);
    setMcpAddError('');
    try {
      const test = await mcpApi({ action: 'test', url: mcpUrl.trim(), token: mcpAuthType === 'bearer' ? mcpToken.trim() : undefined });
      if (!test.ok && mcpAuthType !== 'oauth') {
        setMcpAddError(test.error ?? 'Could not reach that server.');
        return;
      }
      const id = `mcp-${Date.now().toString(36)}`;
      addMcpServer({
        id, name: mcpName.trim(), url: mcpUrl.trim(), authType: mcpAuthType,
        status: test.ok ? 'connected' : 'off', lastSync: new Date().toISOString(),
        tools: test.tools, toolCount: test.tools?.length,
      });
      if (mcpAuthType === 'bearer' && mcpToken.trim()) {
        await mcpApi({ action: 'save_token', serverId: id, token: mcpToken.trim() });
      }
      log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: `Added MCP server "${mcpName.trim()}"${test.ok ? ` — ${test.tools?.length ?? 0} tools available.` : '.'}` });
      setMcpName(''); setMcpUrl(''); setMcpToken(''); setMcpAuthType('none');
    } catch {
      setMcpAddError('Network error while adding the server.');
    } finally {
      setMcpAdding(false);
    }
  };

  const refreshServer = async (id: string) => {
    setMcpBusyId(id);
    try {
      const d = await mcpApi({ action: 'refresh', serverId: id });
      if (d.ok) {
        updateMcpServer(id, { status: 'connected', tools: d.tools, toolCount: d.tools?.length, lastSync: new Date().toISOString(), lastError: undefined });
      } else {
        updateMcpServer(id, { status: 'error', lastError: d.error });
      }
    } finally {
      setMcpBusyId(null);
    }
  };

  const saveServerToken = async (id: string) => {
    const token = (mcpTokenDrafts[id] ?? '').trim();
    if (!token) return;
    setMcpBusyId(id);
    try {
      await mcpApi({ action: 'save_token', serverId: id, token });
      setMcpTokenDrafts((d) => ({ ...d, [id]: '' }));
      await refreshServer(id);
    } finally {
      setMcpBusyId(null);
    }
  };

  const connectServerOAuth = async (id: string, url: string) => {
    setMcpBusyId(id);
    try {
      const discover = await mcpApi({ action: 'oauth_discover', url });
      if (!discover.ok || !discover.metadata) {
        updateMcpServer(id, { status: 'error', lastError: discover.error ?? 'OAuth discovery failed.' });
        return;
      }
      const oauth = {
        authorizationEndpoint: discover.metadata.authorizationEndpoint,
        tokenEndpoint: discover.metadata.tokenEndpoint,
        clientId: discover.metadata.clientId,
      };
      updateMcpServer(id, { oauth });
      const auth = await mcpApi({ action: 'oauth_authorize_url', serverId: id, oauth });
      if (!auth.ok || !auth.authorizeUrl) {
        updateMcpServer(id, { status: 'error', lastError: auth.error ?? 'Could not build the authorization URL.' });
        return;
      }
      const popup = window.open(auth.authorizeUrl, '_blank', 'noopener,noreferrer,width=600,height=700');
      let polls = 0;
      const timer = setInterval(async () => {
        polls++;
        if (polls > 90 || (popup && popup.closed)) {
          clearInterval(timer);
          const status = await mcpApi({ action: 'oauth_status', serverId: id });
          if (status.connected) {
            log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'sync', message: 'Connected MCP server via OAuth.' });
            await refreshServer(id);
          } else {
            updateMcpServer(id, { status: 'error', lastError: 'Authorization window closed before completing sign-in.' });
          }
          setMcpBusyId(null);
        }
      }, 2000);
    } catch {
      updateMcpServer(id, { status: 'error', lastError: 'Network error during OAuth discovery.' });
      setMcpBusyId(null);
    }
  };

  const sendTestEmail = async () => {
    if (!smtpTestTo.trim() || smtpSending) return;
    setSmtpSending(true);
    try {
      const res = await fetch('/api/borga/smtp-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ to: smtpTestTo.trim() }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (d.ok) {
        toast({ title: 'Test email sent', description: `Sent to ${smtpTestTo.trim()}`, variant: 'success' });
      } else {
        toast({ title: 'Test email failed', description: d.error ?? 'Unknown error', variant: 'error' });
      }
    } catch {
      toast({ title: 'Test email failed', description: 'Network error — try again.', variant: 'error' });
    } finally {
      setSmtpSending(false);
    }
  };

  const saveComposio = () => {
    setComposio({ apiKey: apiKey.trim(), baseUrl: baseUrl.trim() });
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: 'Composio.dev API configuration saved.' });
  };

  // Merge static (store) toolkits with live Composio catalog
  const allToolkits = useMemo<Toolkit[]>(() => {
    if (!liveToolkits) return toolkits;
    return [...toolkits, ...liveToolkits];
  }, [toolkits, liveToolkits]);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(allToolkits.map((t) => t.category))).sort()],
    [allToolkits],
  );
  const filtered = useMemo(
    () => allToolkits.filter(
      (t) =>
        (category === 'All' || t.category === category) &&
        t.name.toLowerCase().includes(query.toLowerCase()),
    ),
    [allToolkits, category, query],
  );

  const statusOf = (type: AppConnection['type'], provider: string, label: string) => {
    const id = type === 'tool' ? (TOOLKIT_CONN[label] ?? `cn-tk-${label.toLowerCase()}`) : `cn-${provider}`;
    return { id, conn: connections.find((c) => c.id === id) };
  };

  const beginConnect = (t: OauthTarget) => {
    setOauth(t);
    setAccount('');
    setAgree(false);
    setConnecting(false);
  };

  const authorizeToolApp = async () => {
    if (!oauth) return;
    setConnecting(true);
    connectApp(oauth.connectionId, { status: 'connecting', account: account.trim(), lastSync: 'Connecting…' });
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: `OAuth flow started for ${oauth.label}.` });

    if (composio.configured) {
      try {
        const res = await fetch('/api/borga/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({
            action: 'connect',
            apiKey: composio.apiKey,
            baseUrl: composio.baseUrl || undefined,
            appName: oauth.appName,
            entityId: account.trim(),
          }),
        });
        const data = (await res.json()) as { ok?: boolean; connection?: { redirectUrl?: string; connectionId?: string; status?: string } };
        
        if (data.ok && data.connection?.redirectUrl) {
          // Open the Composio OAuth redirect URL so the user can authorize
          const oauthWindow = window.open(data.connection.redirectUrl, '_blank', 'noopener,noreferrer,width=600,height=700');
          
          // Poll for OAuth completion
          if (oauthWindow) {
            const pollInterval = setInterval(async () => {
              try {
                if (oauthWindow.closed) {
                  clearInterval(pollInterval);
                  // Check connection status
                  const statusRes = await fetch('/api/borga/composio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
                    body: JSON.stringify({
                      action: 'accounts',
                      apiKey: composio.apiKey,
                      baseUrl: composio.baseUrl || undefined,
                    }),
                  });
                  const statusData = await statusRes.json();
                  
                  // Check if our connection exists
                  const isConnected = statusData.ok && Array.isArray(statusData.accounts) && 
                    statusData.accounts.some((acc: any) => 
                      acc.entityId === account.trim() && 
                      acc.appName === oauth.appName
                    );
                  
                  if (isConnected) {
                    // Find the connection from the response
                    const matchedAccount = statusData.accounts.find((acc: any) => 
                      acc.entityId === account.trim() && 
                      acc.appName === oauth.appName
                    );
                    
                    // Store the Composio connection in the store
                    if (matchedAccount) {
                      addComposioConnection({
                        appId: matchedAccount.appId || oauth.appName,
                        appName: oauth.appName,
                        entityId: account.trim(),
                        connectionId: matchedAccount.id,
                        status: 'connected',
                        connectedAt: new Date().toISOString(),
                        lastUsed: new Date().toISOString(),
                      });
                    }
                    
                    connectApp(oauth.connectionId, { 
                      status: 'connected', 
                      account: account.trim(),
                      lastSync: 'Just now',
                      scopes: 'OAuth authorized'
                    });
                    log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'sync', message: `Successfully connected ${oauth.label} via Composio OAuth.` });
                  } else {
                    connectApp(oauth.connectionId, { status: 'error', lastSync: 'Authorization failed' });
                    log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `OAuth authorization failed for ${oauth.label}.` });
                  }
                }
              } catch (error) {
                console.error('OAuth polling error:', error);
              }
            }, 2000);
            
            // Stop polling after 5 minutes
            setTimeout(() => clearInterval(pollInterval), 300000);
          }
        } else if (data.ok && data.connection?.connectionId) {
          // Direct connection (no OAuth redirect needed)
          connectApp(oauth.connectionId, { 
            status: 'connected', 
            account: account.trim(),
            lastSync: 'Just now',
            scopes: 'API key authenticated'
          });
          log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'sync', message: `Connected ${oauth.label} via Composio API key.` });
        } else {
          connectApp(oauth.connectionId, { status: 'error', lastSync: 'Failed' });
          log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Failed to connect ${oauth.label}: ${JSON.stringify(data)}` });
        }
      } catch (error) {
        console.error('Composio connection error:', error);
        connectApp(oauth.connectionId, { status: 'error', lastSync: 'Error' });
        log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Connection error for ${oauth.label}: ${error instanceof Error ? error.message : 'Unknown error'}` });
      }
    } else {
      connectApp(oauth.connectionId, { status: 'error', lastSync: 'No Composio key' });
      log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Could not connect ${oauth.label} — add a Composio API key below first.` });
    }
    setOauth(null);
    setConnecting(false);
  };

  const disconnect = async (conn: AppConnection) => {
    connectApp(conn.id, { status: 'off', lastSync: '…', account: '' });
    
    // If this is a Composio connection, also disconnect via API
    if (conn.type === 'tool' && composio.configured) {
      try {
        const connectionId = conn.id.replace('cn-', '');
        await fetch('/api/borga/composio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({
            action: 'disconnect',
            apiKey: composio.apiKey,
            baseUrl: composio.baseUrl || undefined,
            connectionId,
          }),
        });
        
        // Remove from Composio connections store
        const appId = conn.provider; // Use provider as the app identifier
        removeComposioConnection(appId);
      } catch (error) {
        console.error('Composio disconnect error:', error);
      }
    }
    
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'system', message: `Disconnected ${conn.label}.` });
  };

  const checkConnectionStatus = async (conn: AppConnection) => {
    if (conn.type !== 'tool' || !composio.configured) return;
    
    try {
      const connectionId = conn.id.replace('cn-', '');
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'connectionStatus',
          apiKey: composio.apiKey,
          baseUrl: composio.baseUrl || undefined,
          appName: connectionId,
        }),
      });
      const data = await res.json();
      
      if (data.ok && data.status === 'active') {
        // Update last used timestamp
        updateComposioConnection(conn.provider, { lastUsed: new Date().toISOString() });
        connectApp(conn.id, { lastSync: 'Just now' });
      } else if (data.ok && data.status === 'not_found') {
        // Connection no longer exists on Composio side
        connectApp(conn.id, { status: 'error', lastSync: 'Connection expired' });
        log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Connection ${conn.label} expired or was revoked.` });
      }
    } catch (error) {
      console.error('Connection status check error:', error);
    }
  };

  const refreshToken = async (conn: AppConnection) => {
    if (conn.type !== 'tool' || !composio.configured) return;
    
    try {
      const connectionId = conn.id.replace('cn-', '');
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'refreshToken',
          apiKey: composio.apiKey,
          baseUrl: composio.baseUrl || undefined,
          appName: connectionId,
        }),
      });
      const data = await res.json();
      
      if (data.ok) {
        updateComposioConnection(conn.provider, { lastUsed: new Date().toISOString() });
        connectApp(conn.id, { lastSync: 'Token refreshed' });
        log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'sync', message: `Refreshed OAuth token for ${conn.label}.` });
      } else {
        connectApp(conn.id, { status: 'error', lastSync: 'Token refresh failed' });
        log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Failed to refresh token for ${conn.label}.` });
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      connectApp(conn.id, { status: 'error', lastSync: 'Refresh error' });
    }
  };

  // After saving a key, refresh key status. (Choosing the default model is explicit: "Use as default".)
  const handleLlmKeySaved = (providerId: string) => {
    fetchKeys();
    const p = catalog.find((x) => x.id === providerId);
    if (p) log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: p.label + ' API key saved.' });
  };

  // Derive ElevenLabs "connected" from the real key instead of a manual switch.
  useEffect(() => {
    if (keysLoading) return;
    const has = !!keys['ELEVENLABS_API_KEY']?.configured;
    if (has !== elevenlabs.connected) setElevenlabs({ connected: has, lastSync: has ? 'Key saved' : '…' });
  }, [keys, keysLoading, elevenlabs.connected, setElevenlabs]);

  const handleVoiceKeySaved = (providerId: string) => {
    fetchKeys();
    const p = VOICE_PROVIDERS.find((p) => p.id === providerId);
    if (p) {
      const { id: connId } = statusOf('voice', p.id.replace('voice-', ''), p.label);
      connectApp(connId, { status: 'connected', account: '(API key saved)', lastSync: 'Just now', scopes: 'text-to-speech' });
      log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: `${p.label} API key saved and connection activated.` });
    }
  };

  const SECTION_HEADER: Record<ToolsSection, { title: string; sub: string }> = {
    'ai-providers': { title: 'AI & voice providers', sub: 'Paste API keys for LLMs and text-to-speech — encrypted and stored server-side' },
    email: { title: 'Email & connected apps', sub: 'OAuth email accounts and every active connection with its scopes' },
    composio: { title: 'Composio.dev', sub: 'Configure the API, browse the live catalog and install toolkits' },
    apps: { title: 'Tools & Integrations', sub: 'API keys, composio.dev toolkits, LLM providers and connected apps' },
  };

  return (
    <div className="borga-fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title={SECTION_HEADER[section].title}
          sub={SECTION_HEADER[section].sub}
        />
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Radio className="h-3.5 w-3.5" />
          {connections.filter((c) => c.status === 'connected').length} connected
        </span>
      </div>

      {/* ── LLM providers ─────────────────────────────────────────────────── */}
      {(section === 'ai-providers' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="h-4 w-4 text-primary" />
          <SectionTitle title="LLM providers" sub="Paste API keys here — encrypted and stored server-side" />
          {keysLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {catalog.map((p) => {
            const keyConfig = LLM_KEY_MAP[p.id];
            const isDefault = llm.providerId === p.id;
            const isDemo = p.id === 'llm-demo';
            const expanded = expandedProviders.has(p.id);
            const mainKeyStatus = keyConfig ? keys[keyConfig.envVar] : undefined;
            const isConfigured = isDemo || mainKeyStatus?.configured;

            return (
              <Card key={p.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.accent }} />
                    <p className="truncate text-sm font-semibold">{p.label}</p>
                  </div>
                  {isDefault ? (
                    <Badge className="shrink-0 bg-primary/10 text-primary text-[10px]"><Check className="mr-0.5 h-2.5 w-2.5" /> default</Badge>
                  ) : isConfigured ? (
                    <Badge className="shrink-0 bg-emerald-500/10 text-emerald-600 text-[10px]"><Check className="mr-0.5 h-2.5 w-2.5" /> ready</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {p.models.slice(0, 2).map((m) => (
                    <span key={m.id} className="mr-2">
                      <span className={m.tier === 'free' ? 'text-emerald-500' : m.tier === 'credits' ? 'text-amber-500' : 'text-muted-foreground'}>●</span>
                      {' '}{m.label}
                    </span>
                  ))}
                  {p.models.length > 2 && <span>+{p.models.length - 2} more</span>}
                </p>

                {isDemo ? (
                  <div className="mt-3 rounded-lg border bg-sky-500/5 px-3 py-2 text-[11px] text-sky-600">
                    Built-in — No API key needed — Always on
                  </div>
                ) : keyConfig ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.id)}
                      className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>{mainKeyStatus?.configured ? 'Key configured — update' : 'Add API key'}</span>
                      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>

                    {expanded && (
                      <div className="border-t mt-2 pt-2">
                        <InlineKeyInput
                          envVar={keyConfig.envVar}
                          label={keyConfig.label}
                          hint={keyConfig.hint}
                          kind={keyConfig.kind}
                          status={keys[keyConfig.envVar]}
                          onRefresh={() => handleLlmKeySaved(p.id)}
                        />
                        {keyConfig.extra && (
                          <InlineKeyInput
                            envVar={keyConfig.extra.envVar}
                            label={keyConfig.extra.label}
                            hint={keyConfig.extra.hint}
                            kind={keyConfig.extra.kind}
                            status={keys[keyConfig.extra.envVar]}
                            onRefresh={fetchKeys}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mt-3 space-y-2">
                  <select
                    value={isDefault ? llm.model : (modelChoice[p.id] ?? p.models[0]?.id ?? '')}
                    onChange={(e) => (isDefault ? setDefaultLlm({ model: e.target.value, online: false, latency: 0 }) : setModelChoice((m) => ({ ...m, [p.id]: e.target.value })))}
                    disabled={!isConfigured}
                    className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {p.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.tier === 'free' ? '🟢 ' : m.tier === 'credits' ? '🟡 ' : '💳 '}{m.label}{m.contextK ? ' — ' + m.contextK + 'k' : ''}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={isDefault ? 'outline' : 'default'}
                      className="flex-1 gap-1"
                      disabled={isDefault || !isConfigured}
                      title={!isConfigured ? 'Add an API key above first' : undefined}
                      onClick={() => {
                        setDefaultLlm({ providerId: p.id, model: modelChoice[p.id] ?? p.models[0]?.id ?? '', online: isDemo, latency: 0 });
                        log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'sync', message: p.label + ' set as the default AI provider.' });
                      }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> {isDefault ? 'In use' : 'Use as default'}
                    </Button>
                    {!isDemo && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isConfigured || llmTests[p.id]?.busy}
                        onClick={() => testLlm(p.id, isDefault ? llm.model : (modelChoice[p.id] ?? p.models[0]?.id ?? ''))}
                      >
                        {llmTests[p.id]?.busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
                      </Button>
                    )}
                  </div>
                  {llmTests[p.id]?.msg && (
                    <p className={cn('text-[11px]', llmTests[p.id]?.ok ? 'text-emerald-600' : 'text-rose-600')}>{llmTests[p.id]?.msg}</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        <details className="mt-3 rounded-lg border p-3">
          <summary className="cursor-pointer text-xs font-medium">Advanced: edit the model catalog (providers, base URLs, models)</summary>
          <div className="mt-3"><ModelCatalogEditor /></div>
        </details>

        <div className="mt-3 rounded-lg border border-dashed bg-muted/20 p-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground/70">Get free API keys</p>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {[
              { label: 'Groq (recommended, free)', href: 'https://console.groq.com' },
              { label: 'Google Gemini', href: 'https://aistudio.google.com/apikey' },
              { label: 'OpenRouter', href: 'https://openrouter.ai/keys' },
              { label: 'NVIDIA NIM', href: 'https://build.nvidia.com' },
            ].map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 hover:text-foreground hover:underline">
                {l.label} <ExternalLink className="h-2.5 w-2.5" />
              </a>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* ── Voice agents ──────────────────────────────────────────────────── */}
      {(section === 'ai-providers' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2">
          <AudioLines className="h-4 w-4 text-primary" />
          <SectionTitle title="Voice agents" sub="Paste API keys to enable real TTS and outbound calls" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {VOICE_PROVIDERS.map((p) => {
            const { id: connId, conn } = statusOf('voice', p.id.replace('voice-', ''), p.label);
            const connected = conn?.status === 'connected';
            const keyConfig = VOICE_KEY_MAP[p.id];
            const keyStatus = keyConfig ? keys[keyConfig.envVar] : undefined;
            const expanded = expandedProviders.has(p.id);

            return (
              <Card key={p.id} className="p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: p.accent }}>
                    <AudioLines className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{p.label}</p>
                      {keyStatus?.configured && (
                        <Badge className="shrink-0 bg-emerald-500/10 text-emerald-600 text-[10px]"><Check className="mr-0.5 h-2.5 w-2.5" /> ready</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.kind}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={connected ? 'outline' : 'default'}
                    className="shrink-0 gap-1"
                    disabled={!connected && !keyStatus?.configured}
                    title={!connected && !keyStatus?.configured ? 'Add an API key below first' : undefined}
                    onClick={() => {
                      if (connected) { conn && disconnect(conn); }
                      else if (keyStatus?.configured) connectApp(connId, { status: 'connected', account: '(API key)', lastSync: 'Just now', scopes: 'text-to-speech' });
                    }}
                  >
                    {connected ? <><Unplug className="h-3.5 w-3.5" /> Off</> : <><ShieldCheck className="h-3.5 w-3.5" /> On</>}
                  </Button>
                </div>

                {keyConfig && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.id)}
                      className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>{keyStatus?.configured ? 'Key configured — update' : 'Add API key'}</span>
                      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {expanded && (
                      <div className="border-t mt-2 pt-2">
                        <InlineKeyInput
                          envVar={keyConfig.envVar}
                          label={keyConfig.label}
                          hint={keyConfig.hint}
                          kind="key"
                          status={keyStatus}
                          onRefresh={() => handleVoiceKeySaved(p.id)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </section>
      )}

      {/* ── Twilio — real outbound calling ─────────────────────────────────── */}
      {(section === 'ai-providers' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Phone className="h-4 w-4 text-primary" />
          <SectionTitle
            title="Outbound calling (Twilio)"
            sub="Dial real phone numbers with the agent's ElevenLabs voice — without this, calls play locally instead"
          />
        </div>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">
            When configured, agent calls (Company → Agents, or the voice assistant&apos;s Place a call) dial a real number via Twilio
            and play the ElevenLabs-generated speech with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">&lt;Play&gt;</code> instead
            of Twilio&apos;s own voice. Requires a publicly reachable deployment — Twilio can&apos;t fetch call audio from localhost.
          </p>
          <div className="space-y-1">
            {TWILIO_KEYS.map((k) => (
              <InlineKeyInput
                key={k.envVar}
                envVar={k.envVar}
                label={k.label}
                hint={k.hint}
                kind={k.kind}
                status={keys[k.envVar]}
                onRefresh={fetchKeys}
              />
            ))}
          </div>
        </Card>
      </section>
      )}

      {/* ── SMTP / Email delivery ─────────────────────────────────────────── */}
      {(section === 'ai-providers' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Radio className="h-4 w-4 text-primary" />
          <SectionTitle title="SMTP / email delivery" sub="Send real emails (password resets, notifications) via your SMTP server" />
        </div>
        <Card className="p-4">
          <div className="space-y-1">
            {SMTP_KEYS.map((k) => (
              <InlineKeyInput
                key={k.envVar}
                envVar={k.envVar}
                label={k.label}
                hint={k.hint}
                kind={k.kind}
                status={keys[k.envVar]}
                onRefresh={fetchKeys}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <Input
              type="email"
              value={smtpTestTo}
              onChange={(e) => setSmtpTestTo(e.target.value)}
              placeholder="test@example.com"
              className="h-8 w-56 font-mono text-xs"
            />
            <Button
              size="sm"
              className="h-8 gap-1.5"
              disabled={!smtpTestTo.trim() || smtpSending}
              onClick={sendTestEmail}
            >
              {smtpSending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <AudioLines className="h-3.5 w-3.5" />}
              Send test email
            </Button>
          </div>
        </Card>
      </section>
      )}

      {/* ── Wigolo — local-first web search / fetch / crawl / research ────── */}
      {(section === 'ai-providers' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-4 w-4 text-primary" />
          <SectionTitle
            title="Web research (wigolo)"
            sub="Real multi-engine search, page fetch, site crawl & cited research for agents — local, no API key required"
          />
        </div>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">
            Agents call <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">web_search</code>,{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">web_crawl</code>,{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">web_research</code>, and an
            upgraded <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">browse_web</code> against a{' '}
            <a href="https://github.com/KnockOutEZ/wigolo" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">wigolo</a>{' '}
            daemon you run locally or self-host — nothing routes through a paid third-party API. Start it once with{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">npx wigolo init && npx wigolo serve</code>{' '}
            (defaults to <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">http://127.0.0.1:3333</code>, no config needed below unless you moved it or bound it past loopback).
          </p>
          <div className="space-y-1">
            {WIGOLO_KEYS.map((k) => (
              <InlineKeyInput
                key={k.envVar}
                envVar={k.envVar}
                label={k.label}
                hint={k.hint}
                kind={k.kind}
                status={keys[k.envVar]}
                onRefresh={fetchKeys}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={wigoloTesting} onClick={testWigolo}>
              {wigoloTesting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
              Test connection
            </Button>
            {wigoloResult && (
              <span className={cn('text-xs', wigoloResult.ok ? 'text-emerald-600' : 'text-destructive')}>
                {wigoloResult.message}
              </span>
            )}
          </div>
        </Card>
      </section>
      )}

      {/* ── Generic MCP server connections ─────────────────────────────────── */}
      {(section === 'ai-providers' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2 mb-3">
          <PlugZap className="h-4 w-4 text-primary" />
          <SectionTitle
            title="MCP Servers"
            sub="Connect any Model Context Protocol server — self-hosted or third-party — so agents can call its tools"
          />
        </div>

        {mcpServers.length > 0 && (
          <div className="mb-4 space-y-3">
            {mcpServers.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{s.name}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          s.status === 'connected' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
                          s.status === 'error' && 'border-destructive/30 text-destructive',
                        )}
                      >
                        {s.status === 'connected' ? `${s.toolCount ?? 0} tools` : s.status === 'error' ? 'error' : 'not connected'}
                      </Badge>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{s.authType}</span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{s.url}</p>
                    {s.lastError && <p className="mt-1 text-[11px] text-destructive">{s.lastError}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={mcpBusyId === s.id} onClick={() => refreshServer(s.id)}>
                      {mcpBusyId === s.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Test
                    </Button>
                    {s.authType === 'oauth' && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={mcpBusyId === s.id} onClick={() => connectServerOAuth(s.id, s.url)}>
                        <ExternalLink className="h-3.5 w-3.5" /> {s.status === 'connected' ? 'Reconnect' : 'Connect via OAuth'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => deleteMcpServer(s.id)} title="Remove server">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {s.authType === 'bearer' && (
                  <div className="mt-3 flex gap-1.5 border-t pt-3">
                    <Input
                      type="password"
                      value={mcpTokenDrafts[s.id] ?? ''}
                      onChange={(e) => setMcpTokenDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                      placeholder="Bearer token…"
                      className="h-8 flex-1 font-mono text-xs"
                    />
                    <Button size="sm" className="h-8 gap-1 px-2.5" disabled={!mcpTokenDrafts[s.id]?.trim() || mcpBusyId === s.id} onClick={() => saveServerToken(s.id)}>
                      <Save className="h-3 w-3" /> Save
                    </Button>
                  </div>
                )}
                {s.tools && s.tools.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1 border-t pt-3">
                    {s.tools.slice(0, 12).map((t) => (
                      <span key={t.name} title={t.description} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t.name}</span>
                    ))}
                    {s.tools.length > 12 && <span className="text-[10px] text-muted-foreground">+{s.tools.length - 12} more</span>}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        <Card className="p-4">
          <p className="text-xs font-medium">Add a server</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="Name (e.g. Notion)" className="h-8 text-xs" />
            <Input value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" className="h-8 font-mono text-xs" />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Auth</span>
            {(['none', 'bearer', 'oauth'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMcpAuthType(t)}
                className={cn('rounded-full border px-2.5 py-1 text-[11px] capitalize', mcpAuthType === t ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground')}
              >
                {t === 'none' ? 'No auth' : t === 'bearer' ? 'Bearer token' : 'OAuth'}
              </button>
            ))}
          </div>
          {mcpAuthType === 'bearer' && (
            <Input type="password" value={mcpToken} onChange={(e) => setMcpToken(e.target.value)} placeholder="Bearer token (optional — can add after saving)" className="mt-2 h-8 font-mono text-xs" />
          )}
          {mcpAuthType === 'oauth' && (
            <p className="mt-2 rounded-lg border border-dashed bg-muted/20 p-2 text-[11px] text-muted-foreground">
              Requires the server to publish OAuth discovery metadata (RFC 8414) and support dynamic client registration (RFC 7591) — most hosted MCP servers do. Add the server first, then click &ldquo;Connect via OAuth&rdquo; on it.
            </p>
          )}
          {mcpAddError && <p className="mt-2 text-xs text-destructive">{mcpAddError}</p>}
          <Button size="sm" className="mt-3 gap-1.5" disabled={!mcpName.trim() || !mcpUrl.trim() || mcpAdding} onClick={addServer}>
            {mcpAdding ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add server
          </Button>
        </Card>
      </section>
      )}

      {/* ── Email accounts ───────────────────────────────────────────────── */}
      {(section === 'email' || section === 'apps') && (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Radio className="h-4 w-4 text-primary" />
          </span>
          <SectionTitle
            title="Email accounts"
            sub={composio.apiKey ? 'Connect via OAuth — agents can read, send and manage mail' : 'Requires a Composio API key (below)'}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {EMAIL_APPS.map((app) => {
            const status = oauthStatuses[app.id] ?? 'off';
            const isConnecting = oauthConnecting === app.id;
            return (
              <Card key={app.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: app.accent }} />
                  <p className="text-sm font-semibold">{app.label}</p>
                  {status === 'connected' && (
                    <Badge className="ml-auto shrink-0 bg-emerald-500/10 text-emerald-600 text-[10px]">
                      <Check className="mr-0.5 h-2.5 w-2.5" /> connected
                    </Badge>
                  )}
                  {status === 'connecting' && (
                    <Badge className="ml-auto shrink-0 bg-amber-500/10 text-amber-600 text-[10px]">connecting—</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{app.description}</p>
                <Button
                  size="sm"
                  variant={status === 'connected' ? 'outline' : 'default'}
                  disabled={!composio.apiKey || isConnecting}
                  onClick={() => connectEmail(app)}
                  className="mt-auto gap-1.5"
                >
                  {isConnecting ? (
                    <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Waiting—</>
                  ) : status === 'connected' ? (
                    <><CircleCheck className="h-3.5 w-3.5 text-emerald-500" /> Reconnect</>
                  ) : (
                    <><ExternalLink className="h-3.5 w-3.5" /> Connect via OAuth</>
                  )}
                </Button>
              </Card>
            );
          })}
        </div>
        {!composio.apiKey && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Add your Composio API key below to enable OAuth email connections.
          </p>
        )}
      </section>
      )}

      {/* ── Composio.dev API configuration ───────────────────────────────── */}
      {(section === 'composio' || section === 'apps') && (
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold">Composio.dev API</p>
              <p className="text-xs text-muted-foreground">Required for OAuth toolkit connections. Get a key at composio.dev.</p>
            </div>
          </div>
          <Badge variant="outline" className={cn('gap-1.5', composio.configured && 'text-emerald-600')}>
            <span className={cn('h-2 w-2 rounded-full', composio.configured ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
            {composio.configured ? 'Configured' : 'Not configured'}
          </Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">API key</label>
            <div className="relative mt-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="composio-api-key"
                autoComplete="new-password"
                className="pr-16"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-2.5 text-xs font-medium text-primary hover:underline"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">API base URL</label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://backend.composio.dev" className="mt-1" />
          </div>
        </div>
        <Button className="mt-3 gap-1.5" size="sm" onClick={saveComposio}>
          <Save className="h-3.5 w-3.5" /> Save configuration
        </Button>
      </Card>
      )}

      {/* ── Toolkits from composio.dev ────────────────────────────────────── */}
      {(section === 'composio' || section === 'apps') && (
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SectionTitle
              title="Toolkits — composio.dev"
              sub={catalogLoading
                ? 'Loading catalog…'
                : `${allToolkits.filter((t) => t.installed).length} connected — ${allToolkits.length} available`}
            />
            {catalogLoading
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              : composio.apiKey
                ? <button onClick={refreshCatalog} title="Refresh live catalog from Composio" className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className="h-3.5 w-3.5" /></button>
                : null
            }
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search toolkits…" className="w-44 pl-8" />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((t) => {
            const { id: connId, conn } = statusOf('tool', t.id.replace('tk-', ''), t.name);
            const oauthStatus = oauthStatuses[t.id] ?? (conn?.status === 'connected' ? 'connected' : 'off');
            const isConnecting = oauthConnecting === t.id;
            const connected = oauthStatus === 'connected';
            return (
              <Card key={t.id} className="flex flex-col gap-3 p-3.5">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <PlugZap className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                      {connected && (
                        <Badge className="ml-auto shrink-0 bg-emerald-500/10 text-emerald-600 text-[10px]">
                          <Check className="mr-0.5 h-2.5 w-2.5" /> connected
                        </Badge>
                      )}
                      {oauthStatus === 'connecting' && (
                        <Badge className="ml-auto shrink-0 bg-amber-500/10 text-amber-600 text-[10px]">connecting—</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={connected ? 'outline' : 'default'}
                    disabled={!composio.apiKey || isConnecting}
                    onClick={() => connected
                      ? (conn && disconnect(conn), setOauthStatuses((s) => ({ ...s, [t.id]: 'off' })))
                      : connectViaOAuth(t.id, t.composioAppName, t.name, connId)
                    }
                    className="flex-1 gap-1.5"
                  >
                    {isConnecting ? (
                      <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Waiting—</>
                    ) : connected ? (
                      <><Unplug className="h-3.5 w-3.5" /> Disconnect</>
                    ) : (
                      <><ExternalLink className="h-3.5 w-3.5" /> Connect via OAuth</>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-muted-foreground"
                    onClick={() => (t.installed ? uninstallToolkit(t.id) : installToolkit(t.id))}
                    title={t.installed ? 'Remove agent access' : 'Grant agent access without OAuth'}
                  >
                    {t.installed ? <><Unplug className="h-3 w-3" /> Uninstall</> : <><Plus className="h-3 w-3" /> Install</>}
                  </Button>
                </div>
              </Card>
            );
          })}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground">No toolkits match &quot;{query}&quot;.</p>}
        </div>
      </section>
      )}

      {/* ── Connected apps ────────────────────────────────────────────────── */}
      {(section === 'email' || section === 'apps') && (
      <section>
        <SectionTitle title="Connected apps" sub="Active connections and their scopes" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {connections
            .filter((c) => c.status === 'connected')
            .map((c) => (
              <Card key={c.id} className="flex items-center gap-3 p-3">
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg ring-1', TYPE_STYLE[c.type])}>
                  {c.type === 'voice' ? <AudioLines className="h-4 w-4" /> : c.type === 'llm' ? <Cpu className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.account} — {c.scopes}</p>
                </div>
                <CircleCheck className="h-4 w-4 text-emerald-500" />
              </Card>
            ))}
        </div>
      </section>
      )}

      {/* ── Composio OAuth connect modal (Apollo-style) ───────────────────── */}
      <Dialog open={!!oauth} onOpenChange={(o) => !o && setOauth(null)}>
        <DialogContent className="sm:max-w-md">
          {oauth && (
            <>
              <DialogHeader>
                <DialogTitle>Connect {oauth.label}</DialogTitle>
                <DialogDescription>
                  Authorize Borga to act on your behalf in {oauth.label}. Your account is linked via a secure, revocable OAuth token — never stored in plaintext.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Provider card */}
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <PlugZap className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{oauth.label}</p>
                      <p className="text-[11px] text-muted-foreground">Tool — scoped read / write</p>
                    </div>
                    {composio.configured ? (
                      <Badge className="ml-auto bg-emerald-500/10 text-emerald-600 text-[10px]">Composio ready</Badge>
                    ) : (
                      <Badge variant="outline" className="ml-auto text-[10px]">Simulation mode</Badge>
                    )}
                  </div>
                </div>

                {/* Entity ID / email */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Account email or entity ID
                  </label>
                  <Input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="you@company.com"
                    type="email"
                    className="mt-1"
                    autoFocus
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    This identifies your account when Composio opens the OAuth redirect.
                  </p>
                </div>

                {/* Scopes granted */}
                <div className="rounded-lg border bg-muted/10 px-3 py-2.5 text-[11px] text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground/70">Permissions requested</p>
                  <p>— Read and write access scoped to {oauth.label}</p>
                  <p>— Access revocable at any time from Composio dashboard</p>
                </div>

                {/* ToS */}
                <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
                  <span>
                    I authorize this connection and understand that scoped data may be used by Borga agents to operate on my behalf. I can revoke access at any time.
                  </span>
                </label>

                <div className="flex gap-2">
                  <Button
                    className="flex-1 gap-1.5"
                    disabled={!agree || !account.trim() || connecting}
                    onClick={authorizeToolApp}
                  >
                    {connecting
                      ? <><RefreshCw className="h-4 w-4 animate-spin" /> Connecting—</>
                      : <><ShieldCheck className="h-4 w-4" /> Connect</>
                    }
                  </Button>
                  <Button variant="outline" onClick={() => setOauth(null)}>
                    Skip for now
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
