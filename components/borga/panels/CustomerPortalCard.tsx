'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';

interface TokenRow {
  id: string;
  customerId: string;
  customerName: string;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

/**
 * Client portal links for one account: mint a login-free link the customer
 * opens to see their invoices and accept quotes. The secret shows once —
 * copy it now — and any link revokes independently.
 */
export function CustomerPortalCard({ customerId, customerName }: { customerId: string; customerName: string }) {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [fresh, setFresh] = useState<{ secret: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/borga/portal-tokens?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
      const j = (await r.json()) as { ok: boolean; tokens?: TokenRow[] };
      if (j.ok) setTokens((j.tokens ?? []).filter((t) => t.customerId === customerId));
    } catch {
      /* section stays empty */
    }
  }, [ws, customerId]);

  useEffect(() => {
    setFresh(null);
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/borga/portal-tokens', {
        method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'create', ws, customerId }),
      });
      const j = (await r.json()) as { ok: boolean; secret?: string; url?: string; error?: string };
      if (j.ok && j.secret) {
        setFresh({ secret: j.secret, url: j.url ?? '' });
        await load();
      } else {
        toast({ title: 'Could not create the link', description: j.error, variant: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    const r = await fetch('/api/borga/portal-tokens', {
      method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'revoke', ws, id }),
    });
    if ((await r.json() as { ok: boolean }).ok) void load();
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toast({ title: 'Copied', variant: 'success' }),
      () => toast({ title: 'Copy failed — select it manually', variant: 'warning' }),
    );
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" /> Client portal</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">A login-free link where {customerName} sees their invoices and accepts quotes.</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1" disabled={busy} onClick={() => void create()}>
          <Plus className="h-3 w-3" /> {busy ? 'Creating…' : 'New link'}
        </Button>
      </div>
      {fresh && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium">Copy this link now — it is never shown again.</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">{fresh.url || fresh.secret}</code>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => copy(fresh.url || fresh.secret)}>
              <Copy className="h-3 w-3" /> Copy
            </Button>
          </div>
        </div>
      )}
      {tokens.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border text-xs">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate font-mono">{t.prefix}
                <span className="ml-2 font-sans text-muted-foreground">
                  created {new Date(t.createdAt).toLocaleDateString()}
                  {t.expiresAt ? ` · expires ${t.expiresAt}` : ' · never expires'}
                  {t.lastUsedAt ? ` · opened ${new Date(t.lastUsedAt).toLocaleDateString()}` : ' · never opened'}
                </span>
              </span>
              {t.revokedAt
                ? <span className="shrink-0 text-muted-foreground">revoked</span>
                : <button onClick={() => void revoke(t.id)} className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-destructive" title="Revoke this link"><Trash2 className="h-3 w-3" /> Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
