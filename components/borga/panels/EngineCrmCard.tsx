'use client';

import { useState } from 'react';
import { Database, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { useCrmPull } from '../use-crm-pull';
import { ConnectionPanel } from './ConnectionsTab';

const fmt = (s?: { added: number; updated: number; unchanged: number }) => (s ? s.added + ' new, ' + s.updated + ' updated, ' + s.unchanged + ' unchanged' : 'not pulled');

/** The company's API portal: connection settings plus a pull of customers and deals from its CRM. */
export function EngineCrmCard({ onConnectionChange }: { onConnectionChange?: () => void }) {
  const { settings, setSettings, customers, leads } = useBorga();
  const pull = useCrmPull();
  const [busy, setBusy] = useState(false);
  const last = settings.crmLastPull;

  const run = async () => {
    setBusy(true);
    const r = await pull();
    setBusy(false);
    if (!r.ok && !r.customers && !r.leads) return toast({ title: 'Pull failed', description: r.error, variant: 'error' });
    toast({
      title: r.error ? 'Pulled with problems' : 'CRM data pulled',
      description: 'Customers: ' + fmt(r.customers) + '. Deals: ' + fmt(r.leads) + '.' + (r.skipped ? ' ' + r.skipped + ' record(s) skipped (no id or name).' : '') + (r.truncated ? ' Stopped at the safety limit (1000 records / 10 pages).' : '') + (r.error ? ' ' + r.error : ''),
      variant: r.error ? 'warning' : 'success',
    });
  };

  return (
    <div className="space-y-4">
      <ConnectionPanel providerId="company_engine" onChange={onConnectionChange} />
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-primary" /> CRM data</div>
          <Button size="sm" className="gap-1.5" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Pull now
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Reads customers and deals from your API (read-only) and merges them into Sales → Customers and the pipeline. Records are matched by CRM id, then e-mail, then name, so pulling again updates instead of duplicating. Borga-only fields (owner, notes) are never overwritten, and nothing is written back to your CRM.
        </p>
        <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">Keep in sync automatically</span>
            <span className="block text-xs text-muted-foreground">Pulls every 30 minutes while Borga is open in a browser.</span>
          </span>
          <Switch checked={!!settings.crmAutoPull} onCheckedChange={(v) => setSettings({ crmAutoPull: v })} />
        </label>
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 p-2.5"><p className="text-muted-foreground">In Borga now</p><p className="font-medium">{customers.length} customers, {leads.length} deals</p></div>
          <div className="rounded-lg border bg-muted/20 p-2.5"><p className="text-muted-foreground">Last pull</p><p className="font-medium">{last ? new Date(last.at).toLocaleString() : 'never'}</p></div>
          <div className="rounded-lg border bg-muted/20 p-2.5"><p className="text-muted-foreground">Result</p><p className="font-medium">{last ? (last.error ? 'Problem' : 'OK') : '—'}</p></div>
        </div>
        {last && !last.error && <p className="text-xs text-muted-foreground">Customers: {fmt(last.customers)}. Deals: {fmt(last.leads)}.{last.skipped ? ' ' + last.skipped + ' skipped.' : ''}</p>}
        {last?.error && <p className="text-xs text-rose-600">{last.error}</p>}
      </Card>
    </div>
  );
}
