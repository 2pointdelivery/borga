'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Copy, Check, Trash2, KeyRound, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

interface ApiKeyMeta {
  id: string;
  name: string;
  prefix: string;
  wsIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function ApiKeysTab() {
  const { workspaces, activeWorkspaceId } = useBorga();
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [wsIds, setWsIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyMeta | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/borga/api-keys', { cache: 'no-store' });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; keys?: ApiKeyMeta[] } | null;
    if (j?.ok && j.keys) setKeys(j.keys);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (createOpen) setWsIds([activeWorkspaceId]);
  }, [createOpen, activeWorkspaceId]);

  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id;

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const r = await fetch('/api/borga/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'create', name: name.trim(), wsIds }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; key?: ApiKeyMeta; secret?: string; error?: string } | null;
    setCreating(false);
    if (!j?.ok || !j.key || !j.secret) {
      toast({ title: 'Could not create key', description: j?.error ?? 'Try again.', variant: 'error' });
      return;
    }
    setSecret(j.secret);
    setName('');
    await refresh();
  };

  const doRevoke = async () => {
    if (!confirmRevoke) return;
    const r = await fetch('/api/borga/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'revoke', id: confirmRevoke.id }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!j?.ok) toast({ title: 'Could not revoke key', description: j?.error ?? 'Try again.', variant: 'error' });
    setConfirmRevoke(null);
    await refresh();
  };

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const live = keys.filter((k) => !k.revokedAt);

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="API keys" sub="Bearer tokens for the public Borga API — the secret is shown once and stored hashed" />
        <Button onClick={() => { setSecret(null); setCreateOpen(true); }} className="gap-1.5"><Plus className="h-4 w-4" /> New key</Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : live.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No API keys yet. Create one to call the public API from your own apps and integrations.
        </Card>
      ) : (
        <div className="grid gap-3">
          {live.map((k) => (
            <Card key={k.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <KeyRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{k.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{k.prefix}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {k.wsIds.length} workspace{k.wsIds.length === 1 ? '' : 's'} · created {new Date(k.createdAt).toLocaleDateString()} · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}
                </p>
                {k.wsIds.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {k.wsIds.map((id) => (
                      <span key={id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{wsName(id)}</span>
                    ))}
                  </p>
                )}
              </div>
              <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground hover:text-destructive" onClick={() => setConfirmRevoke(k)}>
                <Trash2 className="h-3.5 w-3.5" /> Revoke
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setSecret(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Scoped to the workspaces you tick. The secret appears once — copy it now.</DialogDescription>
          </DialogHeader>
          {secret ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Copy it now — it can never be shown again.</p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{secret}</code>
                <button onClick={() => copy(secret)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary" title="Copy key">
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <Button className="w-full" onClick={() => { setCreateOpen(false); setSecret(null); }}>Done</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Key name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Website integration" className="mt-1" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Workspaces it can access</label>
                <div className="mt-1.5 max-h-40 space-y-1.5 overflow-y-auto rounded-lg border p-2.5">
                  {workspaces.length === 0 && <p className="text-xs text-muted-foreground">No workspaces yet.</p>}
                  {workspaces.map((w) => (
                    <label key={w.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={wsIds.includes(w.id)}
                        onChange={(e) => setWsIds((prev) => (e.target.checked ? [...prev, w.id] : prev.filter((id) => id !== w.id)))}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">{w.name}</span>
                      <code className="shrink-0 text-[10px] text-muted-foreground">{w.id}</code>
                    </label>
                  ))}
                </div>
                {wsIds.length === 0 && <p className="mt-1 text-[11px] text-muted-foreground">Unticked means every workspace you own.</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={create} disabled={creating || !name.trim()} className={cn(creating && 'opacity-70')}>
                  {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Create key
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRevoke}
        onOpenChange={(o) => { if (!o) setConfirmRevoke(null); }}
        title={`Revoke key "${confirmRevoke?.name ?? ''}"?`}
        description="Apps using it stop working immediately. This cannot be undone — create a new key instead."
        confirmLabel="Revoke key"
        onConfirm={doRevoke}
      />
    </div>
  );
}
