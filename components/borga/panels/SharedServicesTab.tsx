'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ExternalLink,
  MailPlus,
  Package,
  ShieldCheck,
  Sliders,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ADVISOR_MODULE_SCOPES,
  ADVISOR_SCOPE_LABELS,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  type AdvisorModuleScope,
  type AdvisorProfile,
  type EngagementStatus,
  type ServiceBooking,
  type ServiceCategory,
  type ServiceEngagement,
  type ServicePackage,
  type ServiceProposal,
} from '@/lib/borga/shared-services';
import {
  buildGoogleCalendarUrl,
  buildIcsDataUrl,
  buildMeetingIcs,
  type MeetingInviteInput,
} from '@/lib/borga/meeting-invites';
import type { TeamInvite } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { toast } from '@/lib/toast-bus';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

const fmtUsdCents = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface ClientSharedServicesState {
  ok: boolean;
  user: { id: string; name: string; email: string; isOperator: boolean } | null;
  config: { pricePerUserCents: number; platformFeePct: number };
  advisors: AdvisorProfile[];
  client: {
    ws: string | null;
    bookings: ServiceBooking[];
    proposals: ServiceProposal[];
    engagements: ServiceEngagement[];
  };
}

export function SharedServicesTab({ initialTab }: { initialTab?: string }) {
  const { activeWorkspaceId: ws, activeWorkspace, hydrate, invites, addInvite, userName, log } = useBorga();
  const [tab, setTab] = useState(
    initialTab === 'active' || initialTab === 'proposals' || initialTab === 'marketplace'
      ? initialTab
      : 'marketplace',
  );
  const [data, setData] = useState<ClientSharedServicesState | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | ServiceCategory>('all');
  const [busy, setBusy] = useState<string | null>(null);

  // Direct team invite for an advisor
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDept, setInviteDept] = useState('Finance');
  const inviteRole = 'External Advisor';

  // Book call modal
  const [bookTarget, setBookTarget] = useState<AdvisorProfile | null>(null);
  const [callDateTime, setCallDateTime] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
  const [callTopic, setCallTopic] = useState('');
  const [callNotes, setCallNotes] = useState('');

  // Buy package modal
  const [pkgTarget, setPkgTarget] = useState<{ advisor: AdvisorProfile; pkg: ServicePackage } | null>(null);
  const [pkgScopes, setPkgScopes] = useState<AdvisorModuleScope[]>(['finance']);
  const [pkgKickoff, setPkgKickoff] = useState('');

  // Accept proposal modal
  const [acceptTarget, setAcceptTarget] = useState<ServiceProposal | null>(null);
  const [acceptScopes, setAcceptScopes] = useState<AdvisorModuleScope[]>(['finance']);

  const load = useCallback(async () => {
    if (!ws) return;
    try {
      const res = await fetch(`/api/borga/shared-services?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
      const json = (await res.json()) as ClientSharedServicesState;
      if (json.ok) setData(json);
    } catch {
      /* ignore transient fetch errors */
    }
  }, [ws]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/borga/shared-services', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ ws, ...payload }),
    });
    return (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  };

  const sendDirectAdvisorInvite = () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      toast({ title: 'Enter a valid advisor email', variant: 'warning' });
      return;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const inv: TeamInvite = {
      id: `inv-${Date.now().toString(36)}`,
      email,
      name: inviteName.trim() || email.split('@')[0],
      role: inviteRole.trim() || 'External Advisor',
      department: inviteDept,
      token,
      status: 'pending',
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      invitedBy: userName || 'Owner',
    };
    addInvite(inv);
    log({
      agentId: 'a-people',
      agentName: 'Rigby',
      actor: 'user',
      kind: 'task',
      message: `Invited advisor ${email} (${inv.role} — ${inv.department}). Visible in their Advisor Portal.`,
    });
    setInviteEmail('');
    setInviteName('');
    toast({
      title: `Invite sent to ${email}`,
      description: 'They will see your company in their Advisor Portal (/services) and can accept in one click.',
      variant: 'success',
    });
  };

  const submitBookCall = async () => {
    if (!bookTarget || !callTopic.trim() || !callDateTime) return;
    setBusy('bookCall');
    const r = await post({
      action: 'bookCall',
      advisorId: bookTarget.id,
      category: bookTarget.categories[0] ?? 'accounting',
      scheduledAt: new Date(callDateTime).toISOString(),
      durationMin: 45,
      topic: callTopic.trim(),
      notes: callNotes.trim(),
    });
    setBusy(null);
    if (r.ok) {
      toast({
        title: `Call booked with ${bookTarget.agencyName || bookTarget.name}`,
        description: 'Meeting invite (.ics) sent to both your email and the advisor’s email.',
        variant: 'success',
      });
      setBookTarget(null);
      setCallTopic('');
      setCallNotes('');
      void load();
    } else {
      toast({ title: 'Could not book call', description: r.error, variant: 'error' });
    }
  };

  const submitPurchasePackage = async () => {
    if (!pkgTarget) return;
    setBusy('buyPackage');
    const r = await post({
      action: 'purchasePackage',
      advisorId: pkgTarget.advisor.id,
      packageId: pkgTarget.pkg.id,
      grantedScopes: pkgScopes,
      kickoffAt: pkgKickoff ? new Date(pkgKickoff).toISOString() : undefined,
    });
    setBusy(null);
    if (r.ok) {
      toast({
        title: `Hired ${pkgTarget.advisor.agencyName || pkgTarget.advisor.name}`,
        description: `Shared tabs: ${pkgScopes.join(', ')}. Paid bill recorded in Vendors & AP.`,
        variant: 'success',
      });
      setPkgTarget(null);
      void load();
      void hydrate();
    } else {
      toast({ title: 'Could not purchase package', description: r.error, variant: 'error' });
    }
  };

  const submitProposalDecision = async (proposal: ServiceProposal, decision: 'accepted' | 'declined', scopes?: AdvisorModuleScope[]) => {
    setBusy(`prop-${proposal.id}`);
    const r = await post({
      action: 'respondProposal',
      proposalId: proposal.id,
      decision,
      grantedScopes: scopes,
    });
    setBusy(null);
    if (r.ok) {
      toast({
        title: decision === 'accepted' ? `Proposal accepted — ${proposal.advisorName} can now help you` : 'Proposal declined',
        variant: 'success',
      });
      setAcceptTarget(null);
      void load();
      if (decision === 'accepted') void hydrate();
    } else {
      toast({ title: 'Could not update proposal', description: r.error, variant: 'error' });
    }
  };

  const updateAccess = async (engagement: ServiceEngagement, patch: { status?: EngagementStatus; grantedScopes?: AdvisorModuleScope[] }) => {
    setBusy(`eng-${engagement.id}`);
    const r = await post({
      action: 'updateEngagementAccess',
      engagementId: engagement.id,
      ...patch,
    });
    setBusy(null);
    if (r.ok) {
      toast({ title: 'Advisor access updated', variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not update access', description: r.error, variant: 'error' });
    }
  };

  const advisors = (data?.advisors ?? []).filter((a) =>
    categoryFilter === 'all' ? true : a.categories.includes(categoryFilter),
  );
  const proposals = data?.client.proposals ?? [];
  const bookings = data?.client.bookings ?? [];
  const engagements = data?.client.engagements ?? [];
  const openProposalsCount = proposals.filter((p) => p.status === 'sent').length;
  const wsName = activeWorkspace()?.name ?? 'your company';

  return (
    <div className="borga-fade-up space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Shared Services — Hire an Advisor or Agency"
          sub={`Book a call, invite your own accountant, or hire a vetted CFO, project manager, or agency to help run ${wsName}. You choose which tabs they can see.`}
        />
        <div className="flex items-center gap-2">
          <Link href="/services">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Briefcase className="h-4 w-4" /> Advisor Portal (/services)
            </Button>
          </Link>
          {data?.user?.isOperator && (
            <Link href="/admin">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Sliders className="h-4 w-4" /> Admin Portal (/admin)
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Pricing Transparency Banner */}
      <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/25 bg-primary/5 p-3.5 text-xs">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>
            <strong>No extra seat charge:</strong> Outside accountants, CFOs, and agencies never add a{' '}
            {fmtUsdCents(data?.config.pricePerUserCents ?? 200)}/month seat to your workspace bill. Borga simply keeps a{' '}
            {data?.config.platformFeePct ?? 15}% platform fee from their payout.
          </span>
        </div>
        <Badge variant="outline">You control which tabs they see</Badge>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="marketplace">Find an Advisor ({advisors.length})</TabsTrigger>
          <TabsTrigger value="active">Active Advisors &amp; Shared Tabs ({engagements.length})</TabsTrigger>
          <TabsTrigger value="proposals">
            Proposals, Calls &amp; Invites ({bookings.length + proposals.length})
            {openProposalsCount > 0 && (
              <Badge className="ml-1.5 h-4 px-1.5 text-[10px]">{openProposalsCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: MARKETPLACE */}
        <TabsContent value="marketplace" className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                categoryFilter === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              All Services
            </button>
            {SERVICE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  categoryFilter === cat ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
                }`}
              >
                {SERVICE_CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {advisors.map((adv) => (
              <Card key={adv.id} className="flex flex-col justify-between space-y-4 p-5 text-xs">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold">{adv.agencyName ? `${adv.agencyName} (${adv.name})` : adv.name}</h3>
                      <p className="font-medium text-primary">{adv.headline}</p>
                    </div>
                    <Badge variant="secondary">{fmtUsdCents(adv.hourlyRateCents)}/hr</Badge>
                  </div>
                  {adv.bio && <p className="text-muted-foreground">{adv.bio}</p>}
                  <div className="flex flex-wrap gap-1">
                    {adv.categories.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">{SERVICE_CATEGORY_LABELS[c]}</Badge>
                    ))}
                  </div>

                  {adv.packages.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ready-to-Hire Packages</p>
                      {adv.packages.map((pkg) => (
                        <div key={pkg.id} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5">
                          <div>
                            <p className="font-semibold">{pkg.title} · {fmtUsdCents(pkg.priceCents)} ({pkg.billingCycle === 'monthly' ? 'monthly' : 'one-time'})</p>
                            <p className="text-[11px] text-muted-foreground">{pkg.description}</p>
                          </div>
                          <Button
                            size="sm"
                            className="h-7 shrink-0 gap-1 text-xs"
                            onClick={() => {
                              setPkgTarget({ advisor: adv, pkg });
                              setPkgScopes(pkg.scopes);
                            }}
                          >
                            <Package className="h-3 w-3" /> Hire Package
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <span className="text-[11px] text-muted-foreground">
                    <UserCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />
                    Vetted Advisor · {adv.completedEngagements} completed
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setBookTarget(adv);
                      setCallTopic(`Intro Call — ${wsName}`);
                    }}
                  >
                    <Calendar className="h-3.5 w-3.5" /> Book a Call
                  </Button>
                </div>
              </Card>
            ))}

            {advisors.length === 0 && (
              <Card className="col-span-full p-8 text-center text-xs text-muted-foreground">
                No vetted advisors listed in this category yet. You can also invite your own accountant or agency under the{' '}
                <button type="button" onClick={() => setTab('proposals')} className="font-medium text-primary underline">
                  Proposals, Calls &amp; Invites
                </button>{' '}
                tab.
              </Card>
            )}
          </div>
        </TabsContent>

        {/* TAB 2: ACTIVE ADVISORS & SHARED TABS */}
        <TabsContent value="active" className="space-y-4">
          <Card className="space-y-3 p-5">
            <div>
              <h3 className="text-sm font-semibold">Advisors Helping {wsName} ({engagements.length})</h3>
              <p className="text-xs text-muted-foreground">
                Click any tab chip below to share or unshare that part of your business with the advisor in real time, or pause/turn off their access.
              </p>
            </div>
            <div className="space-y-3">
              {engagements.map((eng) => (
                <div key={eng.id} className="space-y-3 rounded-xl border p-4 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{eng.advisorName}</span>
                        <Badge variant={eng.status === 'active' ? 'default' : 'secondary'}>{eng.status}</Badge>
                        <span className="text-muted-foreground">· {eng.title}</span>
                      </div>
                      <p className="mt-0.5 text-muted-foreground">
                        Total billed: <strong>{fmtUsdCents(eng.paidTotalCents)}</strong> · Advisor seat cost: <strong>$0.00 (Free)</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {eng.status === 'active' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={busy === `eng-${eng.id}`}
                          onClick={() => void updateAccess(eng, { status: 'paused' })}
                        >
                          Pause Access
                        </Button>
                      )}
                      {eng.status === 'paused' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={busy === `eng-${eng.id}`}
                          onClick={() => void updateAccess(eng, { status: 'active' })}
                        >
                          Resume Access
                        </Button>
                      )}
                      {eng.status !== 'revoked' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-rose-600"
                          disabled={busy === `eng-${eng.id}`}
                          onClick={() => void updateAccess(eng, { status: 'revoked', grantedScopes: [] })}
                        >
                          Remove Access
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Tabs this advisor can see (click to share or unshare):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ADVISOR_MODULE_SCOPES.map((sc) => {
                        const on = eng.grantedScopes.includes(sc);
                        return (
                          <button
                            key={sc}
                            type="button"
                            disabled={eng.status !== 'active' || busy === `eng-${eng.id}`}
                            onClick={() => {
                              const next = on ? eng.grantedScopes.filter((s) => s !== sc) : [...eng.grantedScopes, sc];
                              void updateAccess(eng, { grantedScopes: next });
                            }}
                            className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition ${
                              on
                                ? 'border-emerald-500/50 bg-emerald-500/10 font-medium text-emerald-700'
                                : 'border-border bg-background text-muted-foreground opacity-65'
                            }`}
                          >
                            <ShieldCheck className="h-3 w-3" />
                            {ADVISOR_SCOPE_LABELS[sc].label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {eng.workLog.length > 0 && (
                    <div className="rounded-lg bg-muted/30 p-2.5">
                      <p className="text-[11px] font-semibold">Recent Work Updates from {eng.advisorName}:</p>
                      <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                        {eng.workLog.slice(0, 5).map((w) => (
                          <li key={w.id}>
                            <Badge variant="outline" className="mr-1.5 text-[9px]">{w.scope}</Badge>
                            <span className="text-foreground">{w.summary}</span> · {w.at.slice(0, 16).replace('T', ' ')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
              {engagements.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No active advisors yet. Hire a package, accept a proposal, or invite your accountant by email.
                </p>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* TAB 3: PROPOSALS, CALLS & DIRECT ADVISOR INVITES */}
        <TabsContent value="proposals" className="space-y-4">
          {/* Invite Your Own Accountant / Advisor by Email */}
          <Card className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <MailPlus className="h-4 w-4 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">Invite Your Own Accountant or Advisor by Email</h3>
                <p className="text-xs text-muted-foreground">
                  Already work with a bookkeeper, CPA, or agency? Send them a team invite here—your company will appear immediately in their Advisor Portal (/services).
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="advisor@firm.com" className="h-8 text-xs" />
              <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Name (e.g. Ama Mensah)" className="h-8 text-xs" />
              <Select value={inviteDept} onValueChange={setInviteDept}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Finance">Finance &amp; Accounting</SelectItem>
                  <SelectItem value="Sales">Sales &amp; Pipeline</SelectItem>
                  <SelectItem value="Marketing">Marketing &amp; Social</SelectItem>
                  <SelectItem value="Projects">Projects &amp; Operations</SelectItem>
                  <SelectItem value="HR">HR &amp; Payroll</SelectItem>
                  <SelectItem value="Support">Support Desk</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs" onClick={sendDirectAdvisorInvite}>
                Send Advisor Invite
              </Button>
            </div>
            {invites.length > 0 && (
              <div className="pt-2 text-xs text-muted-foreground">
                Recent invites sent from {wsName}:{' '}
                {invites.slice(0, 4).map((i) => (
                  <Badge key={i.id} variant="outline" className="mr-1.5 text-[10px]">
                    {i.email} ({i.department} · {i.status})
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {/* Proposals */}
          <Card className="space-y-3 p-5">
            <h3 className="text-sm font-semibold">Proposals from Advisors ({proposals.length})</h3>
            {proposals.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{p.title}</span>
                    <Badge variant="secondary">{p.advisorName}</Badge>
                    <Badge variant={p.status === 'accepted' ? 'default' : 'outline'}>{p.status}</Badge>
                  </div>
                  {p.summary && <p className="text-muted-foreground">{p.summary}</p>}
                  <p className="text-muted-foreground">
                    Price: <strong className="text-foreground">{fmtUsdCents(p.grossCents)}</strong> ({p.billingCycle === 'monthly' ? 'monthly' : 'one-time'}) · Tabs requested:{' '}
                    <strong>{p.requestedScopes.map((s) => ADVISOR_SCOPE_LABELS[s]?.label ?? s).join(', ')}</strong>
                  </p>
                </div>
                {p.status === 'sent' && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => {
                        setAcceptTarget(p);
                        setAcceptScopes(p.requestedScopes);
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Accept &amp; Share Tabs
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600"
                      disabled={busy === `prop-${p.id}`}
                      onClick={() => void submitProposalDecision(p, 'declined')}
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Decline
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {proposals.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No proposals received yet.</p>
            )}
          </Card>

          {/* Scheduled Calls */}
          <Card className="space-y-2 p-5">
            <h3 className="text-sm font-semibold">Scheduled Advisor Calls ({bookings.length})</h3>
            <div className="divide-y text-xs">
              {bookings.map((b) => {
                const inviteShape: MeetingInviteInput = {
                  bookingId: b.id,
                  topic: b.topic,
                  notes: b.notes,
                  categoryLabel: SERVICE_CATEGORY_LABELS[b.category] ?? b.category,
                  scheduledAt: b.scheduledAt,
                  durationMin: b.durationMin,
                  meetingUrl: b.meetingUrl,
                  calComUrl: b.calComUrl,
                  advisorName: b.advisorName,
                  advisorEmail: b.advisorEmail ?? '',
                  clientName: wsName,
                  clientCompanyName: b.clientCompanyName,
                  clientEmail: b.clientEmail,
                  status: b.status === 'canceled' ? 'canceled' : 'scheduled',
                };
                return (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{b.advisorName}</span>
                        <span>· {b.topic}</span>
                        <Badge variant={b.status === 'scheduled' ? 'default' : 'secondary'} className="text-[10px]">
                          {b.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {b.scheduledAt.slice(0, 16).replace('T', ' ')} ({b.durationMin} min)
                        {b.advisorEmail ? ` · Advisor: ${b.advisorEmail}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {b.status === 'scheduled' && (
                        <>
                          <a href={buildGoogleCalendarUrl(inviteShape)} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="ghost" className="h-7 text-[11px]">
                              + Google Cal
                            </Button>
                          </a>
                          <a href={buildIcsDataUrl(buildMeetingIcs(inviteShape))} download={`borga-call-${b.id}.ics`}>
                            <Button size="sm" variant="ghost" className="h-7 text-[11px]">
                              .ics
                            </Button>
                          </a>
                          <a href={b.meetingUrl} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                              <ExternalLink className="h-3 w-3" /> Join Video Call
                            </Button>
                          </a>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-[11px] text-rose-600"
                            onClick={() => void post({ action: 'updateBookingStatus', bookingId: b.id, status: 'canceled' }).then(() => load())}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {bookings.length === 0 && (
                <p className="py-4 text-center text-muted-foreground">No calls booked yet.</p>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Book Discovery Call Dialog */}
      <Dialog open={!!bookTarget} onOpenChange={(o) => !o && setBookTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Book a Call with {bookTarget?.agencyName || bookTarget?.name}</DialogTitle>
            <DialogDescription>
              Pick a time for your video call. Afterwards, the advisor can send a proposal or you can hire one of their packages.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium">Date &amp; Time</label>
              <Input type="datetime-local" value={callDateTime} onChange={(e) => setCallDateTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="font-medium">What do you want help with?</label>
              <Input value={callTopic} onChange={(e) => setCallTopic(e.target.value)} placeholder="Monthly bookkeeping & tax returns" />
            </div>
            <div className="space-y-1">
              <label className="font-medium">Extra notes (optional)</label>
              <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} rows={3} />
            </div>
            <Button className="w-full" onClick={() => void submitBookCall()} disabled={busy === 'bookCall' || !callTopic.trim()}>
              {busy === 'bookCall' ? 'Booking…' : 'Confirm Call'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Purchase Fixed Package Dialog */}
      <Dialog open={!!pkgTarget} onOpenChange={(o) => !o && setPkgTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hire {pkgTarget?.pkg.title}</DialogTitle>
            <DialogDescription>
              {pkgTarget ? fmtUsdCents(pkgTarget.pkg.priceCents) : ''} ({pkgTarget?.pkg.billingCycle === 'monthly' ? 'monthly' : 'one-time'}). Choose which tabs {pkgTarget?.advisor.name} can access for {wsName}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1.5">
              <label className="font-medium">Tabs to Share</label>
              <div className="flex flex-wrap gap-1.5">
                {ADVISOR_MODULE_SCOPES.map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() =>
                      setPkgScopes((prev) => (prev.includes(sc) ? prev.filter((s) => s !== sc) : [...prev, sc]))
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      pkgScopes.includes(sc) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {ADVISOR_SCOPE_LABELS[sc].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="font-medium">Optional Kickoff Call Time</label>
              <Input type="datetime-local" value={pkgKickoff} onChange={(e) => setPkgKickoff(e.target.value)} />
            </div>
            <Button className="w-full" onClick={() => void submitPurchasePackage()} disabled={busy === 'buyPackage' || pkgScopes.length === 0}>
              {busy === 'buyPackage' ? 'Confirming…' : 'Pay & Share Selected Tabs'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Accept Proposal Dialog */}
      <Dialog open={!!acceptTarget} onOpenChange={(o) => !o && setAcceptTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Accept Proposal: {acceptTarget?.title}</DialogTitle>
            <DialogDescription>
              Choose which tabs {acceptTarget?.advisorName} will be allowed to see for {wsName}.
            </DialogDescription>
          </DialogHeader>
          {acceptTarget && (
            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">
                Price: <strong className="text-foreground">{fmtUsdCents(acceptTarget.grossCents)}</strong> ({acceptTarget.billingCycle === 'monthly' ? 'monthly' : 'one-time'})
              </p>
              <div className="space-y-1.5">
                <label className="font-medium">Tabs to Share</label>
                <div className="flex flex-wrap gap-1.5">
                  {ADVISOR_MODULE_SCOPES.map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() =>
                        setAcceptScopes((prev) => (prev.includes(sc) ? prev.filter((s) => s !== sc) : [...prev, sc]))
                      }
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        acceptScopes.includes(sc) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {ADVISOR_SCOPE_LABELS[sc].label}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                className="w-full"
                disabled={busy === `prop-${acceptTarget.id}` || acceptScopes.length === 0}
                onClick={() => void submitProposalDecision(acceptTarget, 'accepted', acceptScopes)}
              >
                Accept Proposal &amp; Share Tabs
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
