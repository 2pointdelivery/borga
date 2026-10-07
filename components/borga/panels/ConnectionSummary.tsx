'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Settings2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import type { ProviderDef, ProviderId } from '@/lib/borga/providers';

interface Answer {
  ok?: boolean;
  providers?: ProviderDef[];
  statuses?: Array<{ provider: ProviderId; configured: boolean; lastTest: { ok: boolean; message: string } | null }>;
}

/**
 * Where a credential is used, without a second copy of its form. The one place credentials are entered and tested is
 * Integrations → Connections; everywhere else shows whether it is set up and links there. (The same form used to appear in several
 * places, so a company could fill one in while the one that worked sat empty somewhere else.)
 */
export function ConnectionSummary({ providerId, hint }: { providerId: ProviderId; hint?: string }) {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const [state, setState] = useState<{ label: string; configured: boolean; test: { ok: boolean; message: string } | null } | null>(null);

  useEffect(() => {
    if (!ws) return;
    let off = false;
    void fetch(`/api/borga/connections?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j: Answer) => {
        if (off || !j.ok) return;
        const def = j.providers?.find((p) => p.id === providerId);
        const st = j.statuses?.find((s) => s.provider === providerId);
        if (def && st) setState({ label: def.label, configured: st.configured, test: st.lastTest });
      })
      .catch(() => {});
    return () => { off = true; };
  }, [ws, providerId]);

  const manage = () => window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: 'integrations', tab: 'connections' } }));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
      <div className="min-w-0 text-xs">
        {!state ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {state.configured ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
              {state.label}: {state.configured ? 'set up' : 'not set up'}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {state.test ? state.test.message : hint ?? 'Credentials are entered and tested in Integrations → Connections.'}
            </p>
          </>
        )}
      </div>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={manage}><Settings2 className="h-3.5 w-3.5" /> {state?.configured ? 'Manage' : 'Set up'} in Connections</Button>
    </div>
  );
}
