'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Loader2, Copy, Check, Ban } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast-bus';
import { ConfirmDialog } from '../ConfirmDialog';

interface Invite { id: string; email: string; createdAt: number; expiresAt: number; used: boolean; revoked?: boolean }

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Deployment administrators only: issue single-use signup invites. Renders nothing for everyone else. */
export function InvitesCard() {
  const [allowed, setAllowed] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [now, setNow] = useState(0);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ link: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<Invite | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/borga/operator/invites', { cache: 'no-store' });
      if (!r.ok) return setAllowed(false);
      const j = (await r.json()) as { ok: boolean; invites: Invite[] };
      setAllowed(true);
      setInvites(j.invites ?? []);
      setNow(Date.now());
    } catch {
      setAllowed(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!allowed) return null;

  const create = async () => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return toast({ title: 'That is not a valid email address', variant: 'warning' });
    setBusy(true);
    const r = await fetch('/api/borga/operator/invites', { method: 'POST', headers: HEADERS, body: JSON.stringify({ email: e }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; link?: string; error?: string };
    setBusy(false);
    if (!j.ok || !j.link) return toast({ title: 'Invite not created', description: j.error, variant: 'error' });
    setFresh({ link: j.link, email: e });
    setEmail('');
    void load();
  };

  const revoke = async (id: string) => {
    const r = await fetch('/api/borga/operator/invites', { method: 'POST', headers: HEADERS, body: JSON.stringify({ action: 'revoke', id }) });
    if (!r.ok) toast({ title: 'Could not revoke the invite', variant: 'error' });
    void load();
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', description: 'Select the link and copy it manually.', variant: 'warning' });
    }
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <UserPlus className="h-4 w-4 text-primary" /> Signup invitations
        <Badge variant="outline">Administrator</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        New accounts need a single-use invite tied to the invitee&apos;s email address. It expires after 7 days. Send the link yourself; it is shown once and cannot be retrieved later.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="invitee@company.com" className="h-8 max-w-xs" />
        <Button size="sm" className="gap-1.5" onClick={create} disabled={busy || !email.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Create invite
        </Button>
      </div>

      {fresh && (
        <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium">Invite for {fresh.email}. Copy it now, it will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">{fresh.link}</code>
            <Button size="sm" variant="outline" className="gap-1" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <ul className="divide-y rounded-lg border text-xs">
          {invites.map((i) => {
            const expired = !i.used && i.expiresAt < now;
            const label = i.revoked ? 'Revoked' : i.used ? 'Used' : expired ? 'Expired' : 'Pending';
            return (
              <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{i.email}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {new Date(i.createdAt).toLocaleDateString()}
                  <Badge variant={i.used && !i.revoked ? 'secondary' : 'outline'}>{label}</Badge>
                  {!i.used && !expired && (
                    <button type="button" aria-label={`Revoke invite for ${i.email}`} className="text-muted-foreground hover:text-rose-600" onClick={() => setConfirmRevoke(i)}>
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirmRevoke}
        onOpenChange={(o) => { if (!o) setConfirmRevoke(null); }}
        title={`Revoke the signup invite for ${confirmRevoke?.email ?? ''}?`}
        description="The link stops working immediately and cannot be reactivated."
        confirmLabel="Revoke invite"
        onConfirm={async () => {
          if (!confirmRevoke) return;
          await revoke(confirmRevoke.id);
          setConfirmRevoke(null);
        }}
      />
    </Card>
  );
}
