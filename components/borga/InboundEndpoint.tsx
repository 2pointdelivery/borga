'use client';

import { useEffect, useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast({ title: 'Copied', variant: 'success' }));
}

/** Shows this workspace's real inbound-event URL and bearer token (the old hint pointed at a URL no external sender could use). */
export function InboundEndpoint() {
  const { activeWorkspaceId: ws } = useBorga();
  const [info, setInfo] = useState<{ token: string; userId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async (regenerate = false) => {
    try {
      const res = await fetch(`/api/borga/webhooks/inbound?action=token&ws=${encodeURIComponent(ws)}${regenerate ? '&regenerate=1' : ''}`, { method: 'POST', headers: HEADERS });
      const j = (await res.json()) as { ok: boolean; token?: string; userId?: string; error?: string };
      if (!j.ok || !j.token || !j.userId) throw new Error(j.error ?? 'failed');
      setInfo({ token: j.token, userId: j.userId });
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  if (err) return <p className="text-xs text-muted-foreground">Inbound endpoint unavailable: {err}</p>;
  if (!info) return null;
  const url = `${window.location.origin}/api/borga/webhooks/inbound?u=${info.userId}&ws=${ws}&source=<name>&event=<type>`;
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
      <p className="font-medium">Inbound events for this company</p>
      <div className="flex gap-2">
        <Input readOnly value={url} className="font-mono text-[11px]" />
        <Button size="icon" variant="outline" onClick={() => copy(url)}><Copy className="h-4 w-4" /></Button>
      </div>
      <div className="flex gap-2">
        <Input readOnly type="password" value={info.token} className="font-mono text-[11px]" />
        <Button size="icon" variant="outline" onClick={() => copy(info.token)}><Copy className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => load(true)}><KeyRound className="h-3.5 w-3.5" /> Rotate</Button>
      </div>
      <p className="text-muted-foreground">
        POST JSON with <code>Authorization: Bearer &lt;token&gt;</code>, or sign the raw body with the secret of one of your webhooks (HMAC-SHA256 in <code>X-Hub-Signature-256</code>). Needs a public HTTPS address.
      </p>
    </div>
  );
}
