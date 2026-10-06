'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Globe, Loader2, Mail, Mic, Play, Sparkles, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/lib/toast-bus';
import { useBorga } from '@/lib/borga/store';
import { ELEVENLABS_VOICES, type KnowledgeCategoryId } from '@/lib/borga/data';
import { presetFor } from '@/lib/borga/model-catalog';
import { ConnectionPanel } from './panels/ConnectionsTab';
import { ModelPicker, tierSections } from './panels/ModelPicker';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

// ── website ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Fact {
  id: string;
  category: KnowledgeCategoryId;
  title: string;
  answer: string;
  source: string;
}

interface SiteRead {
  site: string;
  pages: Array<{ url: string; title: string }>;
  facts: Fact[];
  skipped: Array<{ url: string; reason: string }>;
}

/** Reads the company's own website and proposes knowledge-base entries to approve. Nothing is saved until the user presses Add. */
export function WebsiteStep({ initialUrl, onAdded }: { initialUrl?: string; onAdded: (count: number) => void }) {
  const { activeWorkspaceId: ws, addKnowledge } = useBorga();
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [read, setRead] = useState<SiteRead | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const go = async () => {
    setBusy(true); setError(''); setRead(null);
    try {
      const r = await fetch('/api/borga/website', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ws, url }) });
      const j = (await r.json()) as { ok: boolean; error?: string } & Partial<SiteRead>;
      if (!j.ok) throw new Error(j.error ?? 'Could not read that website.');
      const result = j as SiteRead;
      setRead(result);
      setPicked(new Set(result.facts.map((f) => f.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const add = () => {
    if (!read) return;
    const host = (() => { try { return new URL(read.site).host; } catch { return read.site; } })();
    const chosen = read.facts.filter((f) => picked.has(f.id));
    chosen.forEach((f, i) => addKnowledge({ id: `kb-web-${Date.now().toString(36)}-${i}`, category: f.category, title: f.title, answer: f.answer, source: `Website: ${host}`, updatedAt: new Date().toISOString() }));
    toast({ title: `${chosen.length} entr${chosen.length === 1 ? 'y' : 'ies'} added to the knowledge base`, description: 'Your agents can use them now. Edit them any time under Company → Knowledge Base.', variant: 'success' });
    onAdded(chosen.length);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && void go()} placeholder="yourcompany.com" className="pl-8" aria-label="Your website" />
        </div>
        <Button onClick={() => void go()} disabled={busy || !url.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Read my website</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Borga reads your home page and up to five more (about, services, pricing, contact) from your own site, follows its robots.txt, and proposes entries for you to approve. It reads only what the site says: it does not guess.
      </p>
      {error && <p className="rounded-md bg-rose-500/10 p-2.5 text-xs text-rose-600">{error}</p>}

      {read && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Read {read.pages.length} page{read.pages.length === 1 ? '' : 's'} of {new URL(read.site).host}. {read.skipped.length > 0 && `${read.skipped.length} skipped (${[...new Set(read.skipped.map((s) => s.reason))].join('; ')}).`}</p>
          {read.facts.length === 0 ? (
            <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">The site had nothing Borga could use (it may build its pages with scripts, so the text is not in the page itself). You can add the details by hand in the next steps or in the Knowledge Base.</p>
          ) : (
            <>
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {read.facts.map((f) => (
                  <li key={f.id} className="rounded-lg border p-3 text-sm">
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input type="checkbox" className="mt-1" checked={picked.has(f.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} />
                      <span className="min-w-0">
                        <span className="block font-medium">{f.title}</span>
                        <span className="mt-0.5 block whitespace-pre-wrap break-words text-xs text-muted-foreground">{f.answer}</span>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground">from {f.source}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Check these before adding. Your agents treat the knowledge base as true, so remove anything out of date or not about you.</p>
              <div className="flex justify-end"><Button onClick={add} disabled={picked.size === 0}><Check className="h-4 w-4" /> Add {picked.size} to the knowledge base</Button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI model ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface KeyStatus { envVar: string; configured: boolean }

/** Choose the model agents use: the built-in demo, a free keyless provider, or any provider the deployment already has a key for. */
export function AiStep({ onChosen }: { onChosen: () => void }) {
  const { llm, llmCatalog, loadFreeModels, setDefaultLlm, activeWorkspaceId: ws } = useBorga();
  const [keys, setKeys] = useState<KeyStatus[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void fetch('/api/borga/config', { cache: 'no-store' }).then((r) => r.json()).then((j: { keys?: KeyStatus[] }) => setKeys(j.keys ?? [])).catch(() => setKeys([]));
  }, []);

  // Keyless providers are ready immediately; keyed ones need their key. Local
  // CLI providers (Muse) are only ready once their endpoint exists — either a
  // base URL edited into the catalog or the configured MUSE_BASE_URL.
  const ready = useMemo(() => llmCatalog.filter((p) => {
    const preset = presetFor(p.id);
    if (preset?.local) return !!p.baseUrl || !!keys?.some((k) => k.envVar === 'MUSE_BASE_URL' && k.configured);
    return preset?.keyless || (p.envVar && keys?.some((k) => k.envVar === p.envVar && k.configured));
  }), [llmCatalog, keys]);
  const needKey = llmCatalog.filter((p) => !ready.includes(p));
  const current = llmCatalog.find((p) => p.id === llm.providerId);
  const firstOf = (p: (typeof llmCatalog)[number]) => (p.models.find((m) => m.tier === 'free') ?? p.models[0])?.id ?? '';

  const choose = (providerId: string, model: string) => { setTest(null); setDefaultLlm({ providerId, model }); onChosen(); };
  const load = async (id: string) => {
    setLoading(id);
    const r = await loadFreeModels(id);
    setLoading(null);
    if (!r.ok) toast({ title: 'Could not load the models', description: r.error ?? 'Try again in a moment.', variant: 'error' });
  };
  const runTest = useCallback(async () => {
    setTesting(true); setTest(null);
    try {
      const r = await fetch('/api/borga/llm-test', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ws, providerId: llm.providerId, model: llm.model }) });
      const j = (await r.json()) as { ok: boolean; error?: string; latencyMs?: number; note?: string };
      setTest({ ok: !!j.ok, text: j.ok ? (j.note ?? `Answered in ${j.latencyMs} ms.`) : (j.error ?? 'No answer.') });
    } catch { setTest({ ok: false, text: 'Could not reach the server.' }); } finally { setTesting(false); }
  }, [ws, llm.providerId, llm.model]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
        <span>Agents use <strong>{current?.label ?? llm.providerId}</strong> · <code className="text-xs">{llm.model}</code></span>
        <Button size="sm" variant="outline" onClick={() => void runTest()} disabled={testing}>{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Test it</Button>
      </div>
      {test && <p className={`text-xs ${test.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{test.ok ? 'Works: ' : 'Did not work: '}{test.text}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {ready.map((p) => {
          const isCurrent = llm.providerId === p.id;
          const loaded = p.models.length > 0;
          return (
            <div key={p.id} className={`rounded-lg border p-3 ${isCurrent ? 'border-primary/50 bg-primary/5' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.accent }} />{p.label}</p>
                <span className="rounded-full bg-emerald-500/10 px-2 text-[10px] font-medium text-emerald-600">{presetFor(p.id)?.keyless ? 'no key needed' : 'key set'}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{presetFor(p.id)?.note ?? p.freeTierNote ?? `${p.models.length} models`}</p>
              <div className="mt-2.5">
                {loaded ? (
                  <ModelPicker sections={tierSections(p.models)} value={isCurrent ? llm.model : firstOf(p)} onChange={(id) => choose(p.id, id)} aria-label={`Model for ${p.label}`} />
                ) : (
                  <Button size="sm" variant="outline" disabled={loading === p.id} onClick={() => void load(p.id)}>{loading === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load free models</Button>
                )}
              </div>
              {!isCurrent && loaded && <Button size="sm" className="mt-2" onClick={() => choose(p.id, firstOf(p))}>Use {p.label}</Button>}
              {isCurrent && <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-primary"><Check className="h-3 w-3" /> In use</p>}
            </div>
          );
        })}
      </div>
      {needKey.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Not ready yet: {needKey.map((p) => p.label).join(', ')}. API keys are set once for the whole deployment by its administrator, under Integrations → AI &amp; Voice; local providers need their endpoint instead.
        </p>
      )}
    </div>
  );
}

// ── email ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The company's own outgoing mail server, with a test message sent to the person setting it up. */
export function EmailStep({ onConfigured }: { onConfigured: () => void }) {
  const { activeWorkspaceId: ws } = useBorga();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const sendTest = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await fetch('/api/borga/smtp-test', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ws }) });
      const j = (await r.json()) as { ok: boolean; error?: string; via?: string };
      setResult({ ok: !!j.ok, text: j.ok ? `Sent through ${j.via === 'shared' ? 'the shared sender' : j.via}. Check your inbox (and spam).` : (j.error ?? 'It did not send.') });
      if (j.ok && j.via !== 'shared') onConfigured();
    } catch { setResult({ ok: false, text: 'Could not reach the server.' }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Borga sends ticket replies and update emails. With your own mail server they come from your address and your domain&apos;s reputation. Skip this and Borga uses the shared sender, if the administrator has set one.</p>
      <ConnectionPanel providerId="smtp" onChange={onConfigured} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void sendTest()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send me a test email</Button>
        {result && <span className={`text-xs ${result.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{result.text}</span>}
      </div>
    </div>
  );
}

// ── voice ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The voice assistant: always-listening on or off, and the voice agents speak with. Works with the browser's voice; ElevenLabs is better when the deployment has a key. */
export function VoiceStep({ onChosen }: { onChosen: () => void }) {
  const { settings, setSettings, elevenlabs, setElevenlabs } = useBorga();
  const [speaking, setSpeaking] = useState(false);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const hear = () => {
    if (!canSpeak) return;
    const u = new SpeechSynthesisUtterance("Hello, I'm Borga. I can read out your updates and take your commands.");
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium"><Mic className="h-4 w-4 text-primary" /> Always listening</p>
          <p className="text-xs text-muted-foreground">The microphone stays on while Borga is open, and Borga only acts after you say &ldquo;Borga&rdquo;. The browser asks for permission first.</p>
        </div>
        <Switch checked={settings.notifications.voice} onCheckedChange={(v) => { setSettings({ notifications: { ...settings.notifications, voice: v } }); onChosen(); }} aria-label="Always listening" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs text-muted-foreground">Agent voice</Label>
          <select
            value={elevenlabs.voice}
            onChange={(e) => { setElevenlabs({ voice: e.target.value }); onChosen(); }}
            className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!elevenlabs.connected}
          >
            {ELEVENLABS_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label} — {v.tag}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">{elevenlabs.connected ? 'ElevenLabs is set up: agents use this voice.' : 'ElevenLabs is not set up on this deployment (the administrator adds its key under Integrations → AI & Voice), so agents use your browser\'s voice.'}</p>
        </div>
        <div className="flex items-end">
          <Button variant="outline" onClick={hear} disabled={!canSpeak || speaking}>{speaking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />} Hear a sample</Button>
        </div>
      </div>
      {!canSpeak && <p className="text-xs text-amber-600">This browser cannot speak. Voice works best in Chrome, Edge or Safari.</p>}
    </div>
  );
}
