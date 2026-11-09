'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Copy,
  Mail,
  Ban,
  Trash2,
  Link2,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { INVITE_STATUS_STYLE, type TeamInvite, type InviteStatus } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

function makeToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function InvitesTab() {
  const { invites, addInvite, setInviteStatus, deleteInvite, employees, log, userName, activeWorkspace, addEmployee } = useBorga();

  const [open, setOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptToken, setAcceptToken] = useState('');
  const [acceptError, setAcceptError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<TeamInvite | null>(null);
  const [confirmDeleteInvite, setConfirmDeleteInvite] = useState<TeamInvite | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: '', department: '' });

  // Deep-link support: /?invite=<token> pre-fills the accept box.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token) {
      setAcceptToken(token);
      setAcceptOpen(true);
      // Clean the URL without a reload.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const inviteOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkFor = (i: TeamInvite) => `${inviteOrigin}/?invite=${i.token}`;

  const submitInvite = () => {
    const email = form.email.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    const invite: TeamInvite = {
      id: `inv-${Date.now().toString(36)}`,
      email,
      name: form.name.trim() || email.split('@')[0],
      role: form.role.trim() || 'Team member',
      department: form.department.trim() || 'General',
      token: makeToken(),
      status: 'pending',
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      invitedBy: userName,
    };
    addInvite(invite);
    log({
      agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task',
      message: `Invite created for ${email} (${invite.role}) — valid 14 days.`,
    });
    setForm({ email: '', name: '', role: '', department: '' });
    setOpen(false);
    void navigator.clipboard?.writeText(linkFor(invite)).catch(() => null);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId((c) => (c === invite.id ? null : c)), 2000);
  };

  const copyLink = async (i: TeamInvite) => {
    try {
      await navigator.clipboard.writeText(linkFor(i));
      setCopiedId(i.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const mailto = (i: TeamInvite) =>
    `mailto:${i.email}?subject=${encodeURIComponent(`You're invited to join ${activeWorkspace()?.name ?? 'the workspace'}`)}&body=${encodeURIComponent(
      `Hi ${i.name},\n\nYou've been invited to join ${activeWorkspace()?.name ?? 'our company'} on Borga as ${i.role}.\n\nAccept your invite: ${linkFor(i)}\n\nThis link expires ${new Date(i.expiresAt).toLocaleDateString()}.\n`,
    )}`;

  const acceptInvite = () => {
    const token = acceptToken.trim();
    const invite = invites.find((i) => i.token === token);
    if (!invite) {
      setAcceptError('This invite token was not found in this workspace.');
      return;
    }
    if (invite.status === 'revoked') {
      setAcceptError('This invite was revoked.');
      return;
    }
    if (new Date(invite.expiresAt) < new Date()) {
      setInviteStatus(invite.id, 'expired');
      setAcceptError('This invite has expired.');
      return;
    }
    if (employees.some((e) => e.email.toLowerCase() === invite.email)) {
      setAcceptError(`${invite.email} is already on the team.`);
      return;
    }
    addEmployee({
      id: `emp-${Date.now().toString(36)}`,
      name: invite.name,
      role: invite.role,
      department: invite.department,
      email: invite.email,
      employmentType: 'full-time',
      status: 'onboarding',
      salary: 0,
      location: 'Remote',
      startedAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
      performance: 70,
    });
    setInviteStatus(invite.id, 'accepted');
    log({
      agentId: 'a-people', agentName: 'Rigby', actor: 'system', kind: 'task',
      message: `${invite.name} accepted the invite and joined as ${invite.role} (onboarding).`,
    });
    setAcceptOpen(false);
    setAcceptToken('');
    setAcceptError('');
  };

  const statusOf = (i: TeamInvite): InviteStatus =>
    i.status === 'pending' && new Date(i.expiresAt) < new Date() ? 'expired' : i.status;

  const stats = useMemo(
    () => ({
      pending: invites.filter((i) => statusOf(i) === 'pending').length,
      accepted: invites.filter((i) => i.status === 'accepted').length,
      revokedOrExpired: invites.filter((i) => ['revoked', 'expired'].includes(statusOf(i))).length,
    }),
    [invites],
  );

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Team invites" sub={`${stats.pending} pending — ${stats.accepted} accepted — workspace invites carry a unique token link (14 days)`} />
        <Button onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" /> Invite teammate
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pending', value: stats.pending },
          { label: 'Accepted', value: stats.accepted },
          { label: 'Revoked / expired', value: stats.revokedOrExpired },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-xl font-semibold">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">Invitations</p>
          <p className="text-[11px] text-muted-foreground">Share the secure link — accepting it creates an onboarding employee record</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Invitee</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Role</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">Invited</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="w-28 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => {
              const st = statusOf(i);
              return (
                <tr key={i.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{i.name}</p>
                    <p className="text-[11px] text-muted-foreground">{i.email}</p>
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{i.role}</td>
                  <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                    {new Date(i.invitedAt).toLocaleDateString()} — by {i.invitedBy}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 capitalize', INVITE_STATUS_STYLE[st])}>
                      {st}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <button
                        onClick={() => void copyLink(i)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title={copiedId === i.id ? 'Link copied!' : 'Copy invite link'}
                      >
                        {copiedId === i.id ? <ShieldCheck className="h-3 w-3 text-emerald-500" /> : <Link2 className="h-3 w-3" />}
                      </button>
                      <a
                        href={mailto(i)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Send via email"
                      >
                        <Mail className="h-3 w-3" />
                      </a>
                      {st === 'pending' && (
                        <button
                          onClick={() => setConfirmRevoke(i)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                          title="Revoke invite"
                        >
                          <Ban className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDeleteInvite(i)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete invite"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {invites.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-muted-foreground">No invites yet — invite your first teammate.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Accept flow (also opened via /?invite=TOKEN deep link) */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UserPlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Join with an invite</p>
            <p className="text-[11px] text-muted-foreground">Paste an invite token (or open an invite link) to add that teammate to this company</p>
          </div>
          <div className="flex w-full max-w-md gap-2">
            <Input value={acceptToken} onChange={(e) => { setAcceptToken(e.target.value); setAcceptError(''); }} placeholder="Invite token…" className="font-mono text-xs" />
            <Button onClick={acceptInvite} disabled={!acceptToken.trim()}>Accept</Button>
          </div>
        </div>
        {acceptError && <p className="mt-2 text-xs text-destructive">{acceptError}</p>}
      </Card>

      {/* New invite dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>
              A unique token link is generated instantly. Copy it or send via email — accepting adds the person as an onboarding employee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email *</label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" className="mt-1" autoFocus />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Cooper" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Dispatch Coordinator" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Department</label>
                <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Operations" className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitInvite} disabled={!form.email.trim() || !form.email.includes('@')}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Create invite & copy link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Accept dialog (deep link) */}
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Accept team invite</DialogTitle>
            <DialogDescription>Confirm the token to join this company workspace.</DialogDescription>
          </DialogHeader>
          <Input value={acceptToken} onChange={(e) => { setAcceptToken(e.target.value); setAcceptError(''); }} placeholder="Invite token…" className="font-mono text-xs" />
          {acceptError && <p className="text-xs text-destructive">{acceptError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptOpen(false)}>Cancel</Button>
            <Button onClick={acceptInvite} disabled={!acceptToken.trim()}>Join workspace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRevoke}
        onOpenChange={(o) => { if (!o) setConfirmRevoke(null); }}
        title={`Revoke the invite for ${confirmRevoke?.email ?? ''}?`}
        description="The link stops working immediately and cannot be reactivated — you would need to invite them again."
        confirmLabel="Revoke invite"
        onConfirm={() => {
          if (!confirmRevoke) return;
          setInviteStatus(confirmRevoke.id, 'revoked');
          log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Invite for ${confirmRevoke.email} revoked.` });
          setConfirmRevoke(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteInvite}
        onOpenChange={(o) => { if (!o) setConfirmDeleteInvite(null); }}
        title={`Delete the invite for ${confirmDeleteInvite?.email ?? ''}?`}
        description="The invite record is removed permanently."
        confirmLabel="Delete invite"
        onConfirm={() => {
          if (!confirmDeleteInvite) return;
          deleteInvite(confirmDeleteInvite.id);
          log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Invite for ${confirmDeleteInvite.email} deleted.` });
          setConfirmDeleteInvite(null);
        }}
      />
    </div>
  );
}
