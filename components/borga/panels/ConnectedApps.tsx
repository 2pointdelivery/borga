'use client';

import { useState } from 'react';
import { AlertTriangle, AudioLines, CircleCheck, Cpu, Loader2, PlugZap, RefreshCw, Settings2, ShieldCheck, Unplug } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBorga } from '@/lib/borga/store';
import type { AppConnection } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { ConfirmDialog } from '../ConfirmDialog';
import { useConnectionActions } from '../use-connection-actions';
import { useComposioReady } from '../use-composio-ready';

const TYPE_STYLE: Record<AppConnection['type'], string> = {
  tool: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  llm: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  voice: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
};

const STATUS: Record<'connected' | 'error' | 'connecting', { label: string; cls: string }> = {
  connected: { label: 'Connected', cls: 'bg-emerald-500/10 text-emerald-600' },
  error: { label: 'Needs attention', cls: 'bg-rose-500/10 text-rose-600' },
  connecting: { label: 'Connecting…', cls: 'bg-amber-500/10 text-amber-600' },
};

/**
 * The apps this company has connected. A connection that has expired or broken stays here, marked "Needs attention", so it can be
 * refreshed or reconnected; before, it simply vanished from the list. Every app can be checked, refreshed, reconnected (a fresh
 * sign-in) or disconnected whenever the person wishes. Models and voices are managed where their keys live.
 */
export function ConnectedApps() {
  const connections = useBorga((s) => s.connections);
  const { ready } = useComposioReady();
  const { check, refresh, reconnect, disconnect } = useConnectionActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AppConnection | null>(null);

  const shown = connections.filter((c) => c.status === 'connected' || c.status === 'error' || c.status === 'connecting');
  const run = async (c: AppConnection, what: string, fn: (c: AppConnection) => Promise<unknown>) => {
    setBusy(`${c.id}:${what}`);
    try { await fn(c); } finally { setBusy(null); }
  };
  const manage = () => window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: 'integrations', tab: 'ai-providers' } }));

  return (
    <section>
      <SectionTitle title="Connected apps" sub="Check, refresh, reconnect or disconnect any app, whenever you wish" />
      {shown.length === 0 ? (
        <Card className="mt-4 flex items-center gap-3 border-dashed p-4 text-sm text-muted-foreground">
          <PlugZap className="h-4 w-4 shrink-0" /> Nothing is connected yet. Connect an app from Composio Toolkits and it appears here.
        </Card>
      ) : (
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {shown.map((c) => {
            const st = STATUS[c.status as keyof typeof STATUS];
            const isTool = c.type === 'tool';
            const working = (what: string) => busy === `${c.id}:${what}`;
            return (
              <Card key={c.id} className={cn('p-3', c.status === 'error' && 'border-rose-500/30')}>
                <div className="flex items-center gap-3">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1', TYPE_STYLE[c.type])}>
                    {c.type === 'voice' ? <AudioLines className="h-4 w-4" /> : c.type === 'llm' ? <Cpu className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{c.label}</span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', st.cls)}>{st.label}</span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {[c.account, c.scopes].filter(Boolean).join(' · ') || 'No details'}
                      {c.lastSync && c.lastSync !== '…' ? ` · ${c.lastSync}` : ''}
                    </p>
                  </div>
                  {c.status === 'connected' && <CircleCheck className="h-4 w-4 shrink-0 text-emerald-500" />}
                  {c.status === 'error' && <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />}
                  {c.status === 'connecting' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />}
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {isTool ? (
                    <>
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!ready || busy !== null} onClick={() => void run(c, 'check', check)} title="Ask the provider whether this connection still works">
                        {working('check') ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Check
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={!ready || busy !== null} onClick={() => void run(c, 'refresh', refresh)} title="Renew the connection; if it has expired you are asked to sign in again">
                        {working('refresh') ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
                      </Button>
                      <Button size="sm" variant={c.status === 'error' ? 'default' : 'outline'} className="h-7 gap-1 px-2 text-xs" disabled={!ready || busy !== null} onClick={() => void run(c, 'reconnect', reconnect)} title="Sign in to the app again">
                        {working('reconnect') ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />} Reconnect
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-rose-600 hover:text-rose-600" disabled={!ready || busy !== null} onClick={() => setConfirm(c)} title="Remove this connection">
                        <Unplug className="h-3 w-3" /> Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={manage} title="Keys and models are managed under AI & Voice">
                      <Settings2 className="h-3 w-3" /> Manage in AI &amp; Voice
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {!ready && shown.some((c) => c.type === 'tool') && (
        <p className="mt-2 text-[11px] text-muted-foreground">Add a Composio API key to check, refresh or disconnect apps.</p>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={`Disconnect ${confirm?.label ?? 'this app'}?`}
        description="Borga and your agents lose access to it right away, and the connection is removed at the provider. You can connect it again whenever you like."
        confirmLabel="Disconnect"
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void run(c, 'disconnect', disconnect); }}
      />
    </section>
  );
}
