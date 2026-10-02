'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/lib/toast-bus';
import { useBorga } from '@/lib/borga/store';
import { ConnectionPanel } from './ConnectionsTab';

interface BankConnection {
  id: string;
  institution: string;
  status?: string;
  lastSyncAt?: string;
  accounts: number;
}

interface Status {
  configured: boolean;
  source: 'workspace' | 'platform' | null;
  testBanks: boolean;
  connections: BankConnection[];
}

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

const ago = (iso?: string) => {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return mins < 2 ? 'just now' : mins < 90 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`;
};

/** Connect a bank through Salt Edge and import its transactions for reconciliation. */
export function BankFeedCard() {
  const { activeWorkspaceId: ws, activeWorkspace, importBankFeed, disconnectBankFeed, bankTxns } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const [status, setStatus] = useState<Status | null>(null);
  const [days, setDays] = useState('90');
  const [busy, setBusy] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/borga/saltedge?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
      const j = (await r.json()) as Status & { ok: boolean };
      if (j.ok) setStatus(j);
    } catch { /* the card stays in its loading state */ }
  }, [ws]);
  useEffect(() => { void load(); }, [load]);

  const call = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/borga/saltedge', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ws, currency, ...body }) });
    const j = (await r.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
    if (!j.ok) throw new Error(j.error ?? 'Salt Edge request failed.');
    return j;
  };

  const connect = async () => {
    setBusy('connect');
    try {
      const j = await call({ action: 'connect', daysBack: Number(days) });
      window.location.href = String(j.connectUrl);
    } catch (e) {
      toast({ title: 'Could not start the bank connection', description: (e as Error).message, variant: 'error' });
      setBusy(null);
    }
  };

  const sync = async (c: BankConnection) => {
    setBusy(c.id);
    try {
      const j = await call({ action: 'sync', connectionId: c.id });
      const stats = importBankFeed(j.feed as never);
      const refresh = j.refresh as { ok: boolean; message?: string };
      toast({
        title: `${c.institution}: ${stats.txnsAdded} new transaction${stats.txnsAdded === 1 ? '' : 's'}`,
        description: refresh.ok ? 'The bank was asked for newer data; it appears on the next sync.' : `The bank was not asked for newer data: ${refresh.message ?? 'not possible right now'}.`,
        variant: 'success',
      });
      await load();
    } catch (e) {
      toast({ title: `Could not sync ${c.institution}`, description: (e as Error).message, variant: 'error' });
    } finally { setBusy(null); }
  };

  const disconnect = async (c: BankConnection) => {
    if (!window.confirm(`Disconnect ${c.institution}? Its accounts and the transactions already imported stay; no new ones arrive.`)) return;
    setBusy(c.id);
    try {
      await call({ action: 'disconnect', connectionId: c.id });
      disconnectBankFeed(c.id);
      await load();
    } catch (e) {
      toast({ title: `Could not disconnect ${c.institution}`, description: (e as Error).message, variant: 'error' });
    } finally { setBusy(null); }
  };

  const imported = bankTxns.filter((t) => t.externalId).length;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><Landmark className="h-4 w-4 text-primary" /> Bank feed (Salt Edge)</p>
          <p className="text-[11px] text-muted-foreground">
            Sign in to your bank on Salt Edge&apos;s page and its transactions arrive here, ready to reconcile. Borga never sees your bank password. {imported > 0 ? `${imported} imported so far.` : ''}
          </p>
        </div>
        {status?.configured && (
          <div className="flex items-center gap-2">
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[['30', 'Last 30 days'], ['90', 'Last 3 months'], ['180', 'Last 6 months'], ['365', 'Last 12 months']].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => void connect()} disabled={busy !== null}>{busy === 'connect' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Landmark className="h-3.5 w-3.5" />} Connect a bank</Button>
          </div>
        )}
      </div>

      {status && !status.configured && (
        <p className="rounded-md bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          Salt Edge is not set up yet. Add your Salt Edge App ID and Secret below (a free test client works for trying it), or ask the deployment administrator to set them for everyone.
        </p>
      )}
      {status?.testBanks && <p className="text-[11px] text-muted-foreground">Test banks are on: Salt Edge&apos;s fake banks appear in the list so you can try the flow without a real account.</p>}

      {status && status.connections.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {status.connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">{c.institution}</span>
                <span className="ml-2 text-xs text-muted-foreground">{c.accounts} account{c.accounts === 1 ? '' : 's'} · synced {ago(c.lastSyncAt)}{c.status && c.status !== 'active' ? ` · ${c.status}` : ''}</span>
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void sync(c)}>{busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sync now</Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy !== null} onClick={() => void disconnect(c)}><Unplug className="h-3.5 w-3.5" /> Disconnect</Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <button className="text-[11px] text-primary underline-offset-2 hover:underline" onClick={() => setShowKeys((v) => !v)}>
          {showKeys ? 'Hide Salt Edge credentials' : status?.source === 'platform' ? 'Use your own Salt Edge credentials instead' : 'Salt Edge credentials'}
        </button>
        {showKeys && <div className="mt-2"><ConnectionPanel providerId="saltedge" onChange={() => void load()} /></div>}
      </div>
    </Card>
  );
}
