'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Download, ExternalLink, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { FREELLM_DIRECTORY_URL, FREE_LLM_PROVIDERS, type FreeProviderPreset } from '@/lib/borga/model-catalog';
import type { LlmProvider } from '@/lib/borga/data';

const ago = (t?: number) => {
  if (!t) return null;
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Can the live list be fetched right now? Yes when the list is public (including keyless providers) or a key is saved. */
export function usableNow(preset: FreeProviderPreset, hasKey: boolean): boolean {
  return hasKey || !!preset.keyOptional;
}

// Companies whose public lists were already fetched in this browser session (the panel remounts when you change tabs).
const autoLoaded = new Set<string>();

/**
 * Free LLM hub. FreeLLM.net is a directory of providers that give out free API keys; it has no API of its own, so this
 * panel loads the free models straight from each provider into the workspace catalog. Public lists (and the providers that
 * need no account at all) load by themselves; the ones that gate their list behind a key load as soon as the key is saved.
 */
export function FreeLlmPanel({ catalog, hasKey }: { catalog: LlmProvider[]; hasKey: (providerId: string) => boolean }) {
  const { loadFreeModels, activeWorkspaceId } = useBorga();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; msg: string; soft?: boolean }>>({});
  const loadedOnce = useRef(false);

  const run = async (p: FreeProviderPreset): Promise<{ ok: boolean; count: number }> => {
    setBusy(p.id);
    try {
      const r = await loadFreeModels(p.id);
      const msg = r.ok ? `${r.count} free model${r.count === 1 ? '' : 's'} loaded${r.total ? ` (of ${r.total} listed)` : ''}` : (r.error ?? 'Failed');
      // "needs a key" and "local CLI not reachable" are not failures worth a red message
      setResults((prev) => ({ ...prev, [p.id]: { ok: !!r.ok, msg, soft: !r.ok && (!!r.needsKey || !!p.local) } }));
      return { ok: !!r.ok, count: r.count ?? 0 };
    } catch (error) {
      setResults((prev) => ({ ...prev, [p.id]: { ok: false, msg: error instanceof Error ? error.message : 'Request failed' } }));
      return { ok: false, count: 0 };
    } finally {
      setBusy(null);
    }
  };

  // First visit this session: fetch every public list so the dropdowns show what is really available, with no clicks.
  useEffect(() => {
    if (loadedOnce.current || !activeWorkspaceId || autoLoaded.has(activeWorkspaceId)) return;
    loadedOnce.current = true;
    autoLoaded.add(activeWorkspaceId);
    void (async () => {
      for (const p of FREE_LLM_PROVIDERS) {
        const entry = catalog.find((c) => c.id === p.id);
        if (!entry || entry.modelsLoadedAt || !usableNow(p, hasKey(p.id))) continue;
        await run(p);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  const loadAll = async () => {
    const targets = FREE_LLM_PROVIDERS.filter((p) => usableNow(p, hasKey(p.id)));
    const skipped = FREE_LLM_PROVIDERS.filter((p) => !usableNow(p, hasKey(p.id)));
    let models = 0;
    let ok = 0;
    for (const p of targets) {
      const r = await run(p);
      if (r.ok) { ok++; models += r.count; }
    }
    const needKey = skipped.length ? ` ${skipped.map((p) => p.label).join(', ')} need${skipped.length === 1 ? 's' : ''} a free key for the live list (save it in the provider card and it loads automatically).` : '';
    toast({
      title: `Loaded ${models} free models from ${ok} of ${targets.length} providers`,
      description: (ok < targets.length ? 'Some failed: see the message next to each one.' : 'Pick one in a provider card and press Use as default.') + needKey,
      variant: ok === targets.length ? 'success' : 'warning',
    });
  };

  return (
    <Card className="mb-3 space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Free LLMs</p>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Several providers need no account at all, and many more give out free API keys, no card needed. <a href={FREELLM_DIRECTORY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">FreeLLM.net</a> keeps a directory of them. Public model lists load automatically; for the others, save your free key in the provider&apos;s card and its models load by themselves. Free tiers are rate limited by each provider.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={loadAll} disabled={busy !== null}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Load all free models
        </Button>
      </div>

      <ul className="divide-y rounded-lg border">
        {FREE_LLM_PROVIDERS.map((p) => {
          const entry = catalog.find((c) => c.id === p.id);
          const free = entry?.models.filter((m) => m.tier === 'free' || m.tier === 'credits').length ?? 0;
          const keyed = hasKey(p.id);
          const res = results[p.id];
          const loadable = usableNow(p, keyed);
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.label}
                  {p.keyless ? (
                    <Badge className="bg-emerald-500/10 text-[10px] text-emerald-600"><Check className="mr-0.5 h-2.5 w-2.5" /> no key needed</Badge>
                  ) : keyed ? (
                    <Badge className="bg-emerald-500/10 text-[10px] text-emerald-600"><Check className="mr-0.5 h-2.5 w-2.5" /> key saved</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">{p.keyOptional ? 'list is public · key to chat' : 'needs a free key'}</Badge>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {p.note}. {free > 0 ? `${free} model${free === 1 ? '' : 's'} in your catalog${entry?.modelsLoadedAt ? `, loaded ${ago(entry.modelsLoadedAt)}` : ''}.` : ''}
                </p>
                {res && <p className={res.ok ? 'text-[11px] text-emerald-600' : res.soft ? 'text-[11px] text-muted-foreground' : 'text-[11px] text-rose-600'}>{res.msg}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!keyed && !p.keyless && p.signupUrl && (
                  <a href={p.signupUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                    Get free key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null || !loadable} onClick={() => run(p)} title={!loadable ? 'Save this provider’s free API key in its card first, then its models load automatically' : undefined}>
                  {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {p.local ? 'Load installed models' : 'Load free models'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
