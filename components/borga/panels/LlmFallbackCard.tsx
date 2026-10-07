'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useBorga } from '@/lib/borga/store';

interface Link { providerId: string; label: string; model: string; primary: boolean; activated: boolean; coolingUntil: number | null }

/** The fallback chain: which model is used first and which activated models take over when it fails. */
export function LlmFallbackCard() {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const loaded = useBorga((s) => s.loadedWorkspaceId);
  const settings = useBorga((s) => s.settings);
  const llm = useBorga((s) => s.llm);
  const setSettings = useBorga((s) => s.setSettings);
  const [chain, setChain] = useState<Link[] | null>(null);
  // the clock the pause countdown is read against, refreshed with every load (not read during render)
  const [now, setNow] = useState(0);
  const enabled = settings.llmFallback !== false;

  const load = useCallback(() => {
    if (!ws || loaded !== ws) return;
    void fetch(`/api/borga/llm-fallback?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: { ok?: boolean; chain?: Link[] }) => { setNow(Date.now()); setChain(j.ok ? j.chain ?? [] : []); })
      .catch(() => setChain([]));
  }, [ws, loaded]);

  // reload when the chosen model or the order changes, and every half minute so a recovered model shows as healthy again
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load, llm.providerId, settings.llmFallbackOrder]);

  const fallbacks = (chain ?? []).filter((c) => !c.primary && c.activated);
  const move = (id: string, dir: -1 | 1) => {
    const ids = fallbacks.map((c) => c.providerId);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setSettings({ llmFallbackOrder: ids });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Layers className="h-4 w-4 text-primary" /> Automatic fallback</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            When the model in use fails (rate limit, outage, refused key, no answer), the next activated model answers instead, so agents, chat and voice keep working.
            Only models you set up with your own key or address are used; the free no-account services are never a silent fallback.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => setSettings({ llmFallback: v })} aria-label="Automatic fallback" />
      </div>

      {!enabled ? (
        <p className="mt-3 text-xs text-muted-foreground">Off: a failing model stops the request.</p>
      ) : chain === null ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {chain.filter((c) => c.primary || c.activated).map((c, i) => {
            const cooling = !!c.coolingUntil && c.coolingUntil > now;
            const idx = fallbacks.findIndex((f) => f.providerId === c.providerId);
            return (
              <li key={c.providerId} className="flex items-center gap-2 rounded-lg border bg-muted/10 px-2.5 py-1.5 text-xs">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate"><span className="font-medium">{c.label}</span> <span className="text-muted-foreground">{c.model}</span></span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{c.primary ? 'in use' : 'fallback'}</span>
                <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium', cooling ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600')}>
                  {cooling ? `paused ${Math.max(1, Math.round(((c.coolingUntil ?? now) - now) / 60_000))} min` : 'healthy'}
                </span>
                {!c.primary && (
                  <span className="flex shrink-0">
                    <button aria-label={`Move ${c.label} up`} disabled={idx <= 0} onClick={() => move(c.providerId, -1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                    <button aria-label={`Move ${c.label} down`} disabled={idx < 0 || idx >= fallbacks.length - 1} onClick={() => move(c.providerId, 1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                  </span>
                )}
              </li>
            );
          })}
          {fallbacks.length === 0 && (
            <li className="text-[11px] text-muted-foreground">No other model is activated yet. Add a second key (OpenRouter, Groq, Gemini and others have free tiers) and it joins the chain automatically.</li>
          )}
        </ol>
      )}
    </Card>
  );
}
