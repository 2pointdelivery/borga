'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  Calendar,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  FileText,
  FolderKanban,
  Layers,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sliders,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
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
  computeFeeSplit,
  type AdvisorCompanyInvite,
  type AdvisorModuleScope,
  type AdvisorProfile,
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
import { toast } from '@/lib/toast-bus';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

const fmtUsdCents = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface SharedServicesPortalPayload {
  ok: boolean;
  user: { id: string; name: string; email: string; isOperator: boolean } | null;
  config: { pricePerUserCents: number; platformFeePct: number; maintenanceBanner: string };
  myAdvisorProfile: AdvisorProfile | null;
  advisors: AdvisorProfile[];
  advisor: {
    bookings: ServiceBooking[];
    proposals: ServiceProposal[];
    engagements: ServiceEngagement[];
    teamInvites?: AdvisorCompanyInvite[];
  };
}

interface ClientWorkspaceConsoleData {
  engagement: ServiceEngagement;
  allowedEntities: string[];
  data: Record<string, unknown>;
}

export default function SharedServicesPortalPage() {
  const [state, setState] = useState<SharedServicesPortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Advisor profile editor state
  const [name, setName] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [hourlyDollars, setHourlyDollars] = useState('150');
  const [categories, setCategories] = useState<ServiceCategory[]>(['accounting']);
  const [defaultScopes, setDefaultScopes] = useState<AdvisorModuleScope[]>(['finance']);
  const [packages, setPackages] = useState<ServicePackage[]>([]);
  const [calComUrl, setCalComUrl] = useState('');
  const [calComEventTypeId, setCalComEventTypeId] = useState('');

  // New package form
  const [pkgTitle, setPkgTitle] = useState('');
  const [pkgDesc, setPkgDesc] = useState('');
  const [pkgCategory, setPkgCategory] = useState<ServiceCategory>('accounting');
  const [pkgPriceDollars, setPkgPriceDollars] = useState('500');
  const [pkgCycle, setPkgCycle] = useState<'monthly' | 'one_time'>('monthly');
  const [pkgScopes, setPkgScopes] = useState<AdvisorModuleScope[]>(['finance']);

  // Proposal modal state
  const [proposalBooking, setProposalBooking] = useState<ServiceBooking | null>(null);
  const [propTitle, setPropTitle] = useState('');
  const [propSummary, setPropSummary] = useState('');
  const [propCategory, setPropCategory] = useState<ServiceCategory>('accounting');
  const [propCycle, setPropCycle] = useState<'monthly' | 'one_time'>('monthly');
  const [propPriceDollars, setPropPriceDollars] = useState('1000');
  const [propScopes, setPropScopes] = useState<AdvisorModuleScope[]>(['finance']);

  // Active Client Workspace Console
  const [activeConsole, setActiveConsole] = useState<ClientWorkspaceConsoleData | null>(null);
  const [workScope, setWorkScope] = useState<AdvisorModuleScope>('finance');
  const [workSummary, setWorkSummary] = useState('');
  const [milestoneDesc, setMilestoneDesc] = useState('');
  const [milestoneDollars, setMilestoneDollars] = useState('');

  // Quick client record creation inside console
  const [quickTitle, setQuickTitle] = useState('');
  const [quickAmount, setQuickAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/borga/shared-services', { cache: 'no-store' });
      const json = (await res.json()) as SharedServicesPortalPayload;
      if (json.ok) {
        setState(json);
        if (json.myAdvisorProfile) {
          const p = json.myAdvisorProfile;
          setName(p.name);
          setAgencyName(p.agencyName ?? '');
          setHeadline(p.headline);
          setBio(p.bio);
          setHourlyDollars((p.hourlyRateCents / 100).toFixed(0));
          setCategories(p.categories);
          setDefaultScopes(p.defaultScopes);
          setPackages(p.packages);
          setCalComUrl(p.calComUrl ?? '');
          setCalComEventTypeId(p.calComEventTypeId ? String(p.calComEventTypeId) : '');
        } else if (json.user) {
          setName(json.user.name);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/borga/shared-services', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  };

  const saveProfile = async (nextPackages = packages) => {
    setBusy('saveProfile');
    const r = await post({
      action: 'saveAdvisorProfile',
      name,
      agencyName,
      headline,
      bio,
      categories,
      defaultScopes,
      hourlyRateCents: Math.round((Number(hourlyDollars) || 0) * 100),
      packages: nextPackages,
      calComUrl: calComUrl.trim(),
      calComEventTypeId: Number(calComEventTypeId) || undefined,
    });
    setBusy(null);
    if (r.ok) {
      toast({ title: 'Your advisor profile is saved', variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not save profile', description: r.error, variant: 'error' });
    }
  };

  const addPackage = async () => {
    if (!pkgTitle.trim()) return;
    const newPkg: ServicePackage = {
      id: `pkg-${Date.now().toString(36)}`,
      title: pkgTitle.trim(),
      description: pkgDesc.trim(),
      category: pkgCategory,
      scopes: pkgScopes.length ? pkgScopes : ['finance'],
      priceCents: Math.round((Number(pkgPriceDollars) || 0) * 100),
      billingCycle: pkgCycle,
      deliverables: [],
    };
    const next = [...packages, newPkg];
    setPackages(next);
    setPkgTitle('');
    setPkgDesc('');
    await saveProfile(next);
  };

  const removePackage = async (id: string) => {
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    await saveProfile(next);
  };

  const sendProposal = async () => {
    if (!proposalBooking || !propTitle.trim()) return;
    setBusy('sendProposal');
    const r = await post({
      action: 'createProposal',
      bookingId: proposalBooking.id,
      clientUserId: proposalBooking.clientUserId,
      clientWs: proposalBooking.clientWs,
      title: propTitle.trim(),
      summary: propSummary.trim(),
      category: propCategory,
      requestedScopes: propScopes,
      billingCycle: propCycle,
      grossCents: Math.round((Number(propPriceDollars) || 0) * 100),
    });
    setBusy(null);
    if (r.ok) {
      toast({ title: `Proposal sent to ${proposalBooking.clientCompanyName}`, variant: 'success' });
      setProposalBooking(null);
      setPropTitle('');
      setPropSummary('');
      void load();
    } else {
      toast({ title: 'Could not send proposal', description: r.error, variant: 'error' });
    }
  };

  const openClientWorkspace = async (engagementId: string) => {
    setBusy(`open-${engagementId}`);
    try {
      const res = await fetch(`/api/borga/shared-services?engagementId=${encodeURIComponent(engagementId)}`, { cache: 'no-store' });
      const json = (await res.json()) as ClientWorkspaceConsoleData & { ok: boolean; error?: string };
      if (json.ok) {
        setActiveConsole(json);
        setWorkScope(json.engagement.grantedScopes[0] ?? 'finance');
      } else {
        toast({ title: 'Could not open client company', description: json.error, variant: 'error' });
      }
    } finally {
      setBusy(null);
    }
  };

  const logWork = async () => {
    if (!activeConsole || !workSummary.trim()) return;
    setBusy('logWork');
    const r = await post({
      action: 'logAdvisorWork',
      engagementId: activeConsole.engagement.id,
      scope: workScope,
      summary: workSummary.trim(),
    });
    setBusy(null);
    if (r.ok) {
      setWorkSummary('');
      toast({ title: 'Update shared with client', variant: 'success' });
      void openClientWorkspace(activeConsole.engagement.id);
      void load();
    } else {
      toast({ title: 'Could not save update', description: r.error, variant: 'error' });
    }
  };

  const billMilestone = async () => {
    if (!activeConsole || !milestoneDesc.trim() || !(Number(milestoneDollars) > 0)) return;
    setBusy('billMilestone');
    const r = await post({
      action: 'billMilestone',
      engagementId: activeConsole.engagement.id,
      description: milestoneDesc.trim(),
      grossCents: Math.round(Number(milestoneDollars) * 100),
    });
    setBusy(null);
    if (r.ok) {
      setMilestoneDesc('');
      setMilestoneDollars('');
      toast({ title: 'Invoice recorded (85% your take-home / 15% platform fee)', variant: 'success' });
      void openClientWorkspace(activeConsole.engagement.id);
      void load();
    } else {
      toast({ title: 'Could not bill client', description: r.error, variant: 'error' });
    }
  };

  const createRecordOnBehalf = async (scope: AdvisorModuleScope) => {
    if (!activeConsole || !quickTitle.trim()) return;
    setBusy('writeEntity');
    const nowIso = new Date().toISOString().slice(0, 10);
    const amt = Number(quickAmount) || 0;
    let entity = 'tasks';
    let nextList: unknown[] = [];
    let summary = '';

    if (scope === 'finance') {
      entity = 'finance';
      const cur = (activeConsole.data.finance as unknown[]) ?? [];
      nextList = [
        {
          id: `f-adv-${Date.now()}`,
          date: nowIso,
          description: quickTitle.trim(),
          category: 'Advisory Adjustment',
          kind: amt >= 0 ? 'revenue' : 'expense',
          amount: Math.abs(amt),
          status: 'posted',
        },
        ...cur,
      ];
      summary = `Added bookkeeping entry: "${quickTitle.trim()}" ($${Math.abs(amt).toFixed(2)})`;
    } else if (scope === 'sales') {
      entity = 'leads';
      const cur = (activeConsole.data.leads as unknown[]) ?? [];
      nextList = [
        {
          id: `l-adv-${Date.now()}`,
          name: quickTitle.trim(),
          company: quickTitle.trim(),
          email: '',
          phone: '',
          value: amt,
          stage: 'qualified',
          source: 'Shared Services Agency',
          ownerId: 'a-sales',
          priority: 'P1',
          createdAt: new Date().toISOString(),
        },
        ...cur,
      ];
      summary = `Added sales lead: "${quickTitle.trim()}" ($${amt.toFixed(2)})`;
    } else if (scope === 'marketing') {
      entity = 'posts';
      const cur = (activeConsole.data.posts as unknown[]) ?? [];
      nextList = [
        {
          id: `sp-adv-${Date.now()}`,
          channel: 'linkedin',
          content: quickTitle.trim(),
          status: 'scheduled',
          scheduledAt: nowIso,
          author: activeConsole.engagement.advisorName,
          engagement: { likes: 0, comments: 0, shares: 0 },
        },
        ...cur,
      ];
      summary = `Scheduled social post: "${quickTitle.trim().slice(0, 60)}"`;
    } else {
      entity = 'tasks';
      const cur = (activeConsole.data.tasks as unknown[]) ?? [];
      nextList = [
        {
          id: `t-adv-${Date.now()}`,
          title: quickTitle.trim(),
          detail: `Created by ${activeConsole.engagement.advisorName} via Shared Services`,
          priority: 'P1',
          status: 'todo',
          bucket: 'today',
          assignee: activeConsole.engagement.advisorName,
          tags: ['advisor'],
          due: nowIso,
          progress: 0,
        },
        ...cur,
      ];
      summary = `Added project task: "${quickTitle.trim()}"`;
    }

    const r = await post({
      action: 'advisorWriteEntity',
      engagementId: activeConsole.engagement.id,
      entity,
      value: nextList,
      scope,
      summary,
    });
    setBusy(null);
    if (r.ok) {
      setQuickTitle('');
      setQuickAmount('');
      toast({ title: 'Saved to client company', description: summary, variant: 'success' });
      void openClientWorkspace(activeConsole.engagement.id);
      void load();
    } else {
      toast({ title: 'Not allowed by shared tabs', description: r.error, variant: 'error' });
    }
  };

  const feePct = state?.config.platformFeePct ?? 15;
  const myEngagements = useMemo(() => state?.advisor.engagements ?? [], [state]);
  const myBookings = state?.advisor.bookings ?? [];
  const myProposals = state?.advisor.proposals ?? [];
  const myTeamInvites = useMemo(() => state?.advisor.teamInvites ?? [], [state]);

  const respondInvite = async (inv: AdvisorCompanyInvite, decision: 'accepted' | 'declined') => {
    setBusy(`inv-${inv.inviteId}`);
    const r = await post({
      action: 'respondTeamInvite',
      clientUserId: inv.clientUserId,
      clientWs: inv.clientWs,
      inviteId: inv.inviteId,
      decision,
      scopes: inv.suggestedScopes,
    });
    setBusy(null);
    if (r.ok) {
      toast({
        title: decision === 'accepted' ? `Joined ${inv.clientCompanyName}` : 'Invite declined',
        description: decision === 'accepted' ? `Unlocked tabs: ${inv.suggestedScopes.join(', ')}` : undefined,
        variant: 'success',
      });
      await load();
      const eng = r.engagement as ServiceEngagement | undefined;
      if (decision === 'accepted' && eng?.id) {
        void openClientWorkspace(eng.id);
      }
    } else {
      toast({ title: 'Could not update invite', description: r.error, variant: 'error' });
    }
  };
  const totalNetCents = myEngagements.reduce((s, e) => s + e.advisorNetTotalCents, 0);
  const totalGrossCents = myEngagements.reduce((s, e) => s + e.paidTotalCents, 0);
  const totalPlatformFeeCents = myEngagements.reduce((s, e) => s + e.platformFeeTotalCents, 0);
  const propSplit = computeFeeSplit(Math.round((Number(propPriceDollars) || 0) * 100), feePct);

  const clientEarningsChartData = useMemo(
    () =>
      myEngagements.map((e) => ({
        client: e.clientCompanyName.slice(0, 18),
        yourTakeHome: Math.round(e.advisorNetTotalCents) / 100,
        platformFee: Math.round(e.platformFeeTotalCents) / 100,
      })),
    [myEngagements],
  );

  const allInvoices = useMemo(
    () =>
      myEngagements.flatMap((e) =>
        e.invoices.map((inv) => ({
          ...inv,
          clientCompanyName: e.clientCompanyName,
          engagementTitle: e.title,
        })),
      ),
    [myEngagements],
  );

  if (loading && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        Loading Advisor &amp; Agency Portal…
      </div>
    );
  }

  if (state?.myAdvisorProfile && (state.myAdvisorProfile.status === 'rejected' || state.myAdvisorProfile.status === 'suspended')) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <Briefcase className="h-10 w-10 text-rose-500" />
        <h1 className="text-lg font-semibold">Advisor Account Paused ({state.myAdvisorProfile.status})</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your advisor profile is currently marked <strong>{state.myAdvisorProfile.status}</strong> by the platform administrator. Client workspace access is paused.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login?role=advisor&next=/services">
            <Button>Switch Advisor Account</Button>
          </Link>
          <Link href="/app">
            <Button variant="outline">Back to Company Workspace</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Briefcase className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold">Advisor &amp; Agency Portal</h1>
                {state?.myAdvisorProfile ? (
                  <Badge variant={state.myAdvisorProfile.status === 'approved' ? 'default' : 'secondary'}>
                    {state.myAdvisorProfile.status === 'approved' ? 'Approved & Live' : 'Waiting for Admin Approval'}
                  </Badge>
                ) : (
                  <Badge variant="outline">Set up your profile below</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Help client companies with their books, projects, sales, or marketing. You keep {100 - feePct}% of every fee (Borga keeps {feePct}%).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {state?.user?.isOperator && (
              <Link href="/admin">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Sliders className="h-4 w-4" /> Admin Portal
                </Button>
              </Link>
            )}
            <Link href="/app">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Your Own Company (/app)
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void load()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* Humanized Earnings & Client Activity Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Your Take-Home Pay ({100 - feePct}%)</span>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-600">{fmtUsdCents(totalNetCents)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              From {fmtUsdCents(totalGrossCents)} billed to clients
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Borga Platform Fee ({feePct}%)</span>
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-bold">{fmtUsdCents(totalPlatformFeeCents)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Covers client billing, call rooms &amp; free seats on client accounts
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Client Companies You Help</span>
              <FolderKanban className="h-4 w-4 text-sky-500" />
            </div>
            <p className="mt-2 text-2xl font-bold">{myEngagements.filter((e) => e.status === 'active').length}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open their shared tabs to do work on their behalf
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Booked Calls &amp; Open Proposals</span>
              <Calendar className="h-4 w-4 text-amber-500" />
            </div>
            <p className="mt-2 text-2xl font-bold">
              {myBookings.filter((b) => b.status === 'scheduled').length} <span className="text-sm font-normal text-muted-foreground">upcoming calls</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {myProposals.filter((p) => p.status === 'sent').length} proposals waiting for client sign-off
            </p>
          </Card>
        </div>

        <Tabs defaultValue="workspaces" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="workspaces">
              Client Companies ({myEngagements.length})
              {myTeamInvites.filter((i) => i.status === 'pending').length > 0 && (
                <Badge className="ml-1.5 h-4 px-1.5 text-[10px]">
                  {myTeamInvites.filter((i) => i.status === 'pending').length} new invite
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="bookings">Booked Calls &amp; Proposals ({myBookings.length})</TabsTrigger>
            <TabsTrigger value="earnings">Earnings, Charts &amp; Payouts ({allInvoices.length})</TabsTrigger>
            <TabsTrigger value="profile">Your Profile &amp; Packages</TabsTrigger>
          </TabsList>

          {/* TAB 1: CLIENT WORKSPACES & ACT-ON-BEHALF CONSOLE */}
          <TabsContent value="workspaces" className="space-y-4">
            {/* Companies That Sent You a Team Invite */}
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Companies That Sent You a Team Invite ({myTeamInvites.length})</h2>
                  <p className="text-xs text-muted-foreground">
                    When a company invites your email address ({state?.user?.email}) from their Team Invites or Shared Services page, it shows up here so you can accept and help them right away.
                  </p>
                </div>
                {myTeamInvites.filter((i) => i.status === 'pending').length > 0 && (
                  <Badge>{myTeamInvites.filter((i) => i.status === 'pending').length} waiting for you</Badge>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {myTeamInvites.map((inv) => (
                  <div
                    key={`${inv.clientUserId}-${inv.clientWs}-${inv.inviteId}`}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{inv.clientCompanyName}</span>
                        <Badge variant={inv.status === 'accepted' ? 'default' : inv.status === 'pending' ? 'secondary' : 'outline'}>
                          {inv.status === 'pending' ? 'Invited you' : inv.status}
                        </Badge>
                        <span className="text-muted-foreground">
                          · {inv.clientIndustry} ({inv.clientCountry})
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        Role: <strong className="text-foreground">{inv.role}</strong> · Department:{' '}
                        <strong className="text-foreground">{inv.department}</strong> · Invited by {inv.invitedBy}
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {inv.suggestedScopes.map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px]">
                            Tab: {ADVISOR_SCOPE_LABELS[s]?.label ?? s}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {inv.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            disabled={busy === `inv-${inv.inviteId}`}
                            onClick={() => void respondInvite(inv, 'accepted')}
                            className="gap-1.5"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {busy === `inv-${inv.inviteId}` ? 'Joining…' : 'Accept & Open Company'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-600"
                            disabled={busy === `inv-${inv.inviteId}`}
                            onClick={() => void respondInvite(inv, 'declined')}
                          >
                            Decline
                          </Button>
                        </>
                      )}
                      {inv.status === 'accepted' && inv.engagementId && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === `open-${inv.engagementId}`}
                          onClick={() => void openClientWorkspace(inv.engagementId!)}
                          className="gap-1.5"
                        >
                          <Wrench className="h-3.5 w-3.5" /> Open Client Workspace
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {myTeamInvites.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No company team invites sent to {state?.user?.email} yet.
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold">Client Companies You Are Helping</h2>
              <p className="text-xs text-muted-foreground">
                Click <strong>Open Client Workspace</strong> to work inside the tabs the client shared with you. Your seat on their company account is completely free for them.
              </p>

              <div className="mt-4 space-y-3">
                {myEngagements.map((eng) => (
                  <div key={eng.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{eng.clientCompanyName}</span>
                        <Badge variant={eng.status === 'active' ? 'default' : 'secondary'}>{eng.status}</Badge>
                        <span className="text-muted-foreground">· {eng.title}</span>
                      </div>
                      <p className="text-muted-foreground">
                        Client paid: <strong>{fmtUsdCents(eng.paidTotalCents)}</strong> · Your take-home ({100 - eng.platformFeePct}%):{' '}
                        <strong className="text-emerald-600">{fmtUsdCents(eng.advisorNetTotalCents)}</strong> · Platform fee ({eng.platformFeePct}%):{' '}
                        <strong>{fmtUsdCents(eng.platformFeeTotalCents)}</strong>
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {eng.grantedScopes.map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px]">
                            <ShieldCheck className="mr-1 h-2.5 w-2.5 text-emerald-500" />
                            Shared tab: {ADVISOR_SCOPE_LABELS[s]?.label ?? s}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={eng.status !== 'active' || busy === `open-${eng.id}`}
                        onClick={() => void openClientWorkspace(eng.id)}
                        className="gap-1.5"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        {busy === `open-${eng.id}` ? 'Opening…' : 'Open Client Workspace'}
                      </Button>
                    </div>
                  </div>
                ))}
                {myEngagements.length === 0 && (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No active client companies yet. When a client accepts your proposal or hires one of your packages, their company shows up here.
                  </p>
                )}
              </div>
            </Card>

            {/* Active Client Workspace Console */}
            {activeConsole && (
              <Card className="border-primary/40 bg-primary/5 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge>Working inside {activeConsole.engagement.clientCompanyName}</Badge>
                      <span className="text-xs text-muted-foreground">{activeConsole.engagement.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Tabs shared with you: {activeConsole.engagement.grantedScopes.map((s) => ADVISOR_SCOPE_LABELS[s]?.label ?? s).join(', ')}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setActiveConsole(null)}>
                    Close Workspace
                  </Button>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  {/* Column 1 */}
                  <div className="space-y-3 rounded-lg border bg-background p-4 text-xs">
                    <p className="font-semibold">1. Do Work in Client&apos;s Books or Pipeline</p>
                    <p className="text-[11px] text-muted-foreground">
                      Saves straight into {activeConsole.engagement.clientCompanyName}&apos;s account and records your name in their activity log.
                    </p>
                    <Select value={workScope} onValueChange={(v) => setWorkScope(v as AdvisorModuleScope)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {activeConsole.engagement.grantedScopes.map((s) => (
                          <SelectItem key={s} value={s}>{ADVISOR_SCOPE_LABELS[s]?.label ?? s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={quickTitle}
                      onChange={(e) => setQuickTitle(e.target.value)}
                      placeholder={
                        workScope === 'finance'
                          ? 'Bookkeeping note (e.g. Monthly rent adjustment)'
                          : workScope === 'sales'
                            ? 'New lead or customer name'
                            : workScope === 'marketing'
                              ? 'Social post draft'
                              : 'Task title'
                      }
                      className="h-8 text-xs"
                    />
                    {(workScope === 'finance' || workScope === 'sales') && (
                      <Input
                        type="number"
                        value={quickAmount}
                        onChange={(e) => setQuickAmount(e.target.value)}
                        placeholder="Amount ($)"
                        className="h-8 text-xs"
                      />
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={busy === 'writeEntity' || !quickTitle.trim()}
                      onClick={() => void createRecordOnBehalf(workScope)}
                    >
                      Save to {activeConsole.engagement.clientCompanyName}
                    </Button>
                  </div>

                  {/* Column 2 */}
                  <div className="space-y-3 rounded-lg border bg-background p-4 text-xs">
                    <p className="font-semibold">2. Post a Work Update for the Client</p>
                    <p className="text-[11px] text-muted-foreground">
                      Let the client know what you finished today.
                    </p>
                    <Textarea
                      value={workSummary}
                      onChange={(e) => setWorkSummary(e.target.value)}
                      placeholder="e.g. Reconciled October bank statement and prepared Q3 tax worksheet…"
                      rows={3}
                      className="text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={busy === 'logWork' || !workSummary.trim()}
                      onClick={() => void logWork()}
                    >
                      Share Update with Client
                    </Button>
                  </div>

                  {/* Column 3 */}
                  <div className="space-y-3 rounded-lg border bg-background p-4 text-xs">
                    <p className="font-semibold">3. Bill a Milestone or Monthly Retainer</p>
                    <p className="text-[11px] text-muted-foreground">
                      Splits {100 - feePct}% to you and {feePct}% to Borga, and records the paid bill in the client&apos;s books.
                    </p>
                    <Input
                      value={milestoneDesc}
                      onChange={(e) => setMilestoneDesc(e.target.value)}
                      placeholder="What this invoice is for"
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={milestoneDollars}
                      onChange={(e) => setMilestoneDollars(e.target.value)}
                      placeholder="Amount ($ USD)"
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={busy === 'billMilestone' || !milestoneDesc.trim() || !(Number(milestoneDollars) > 0)}
                      onClick={() => void billMilestone()}
                    >
                      Bill Client
                    </Button>
                  </div>
                </div>

                {/* Live snapshot of scoped entities */}
                <div className="mt-4 rounded-lg border bg-background p-3 text-xs">
                  <p className="font-semibold">Client Records Visible to You:</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeConsole.allowedEntities.map((ent) => {
                      const arr = Array.isArray(activeConsole.data[ent]) ? (activeConsole.data[ent] as unknown[]) : [];
                      return (
                        <Badge key={ent} variant="secondary" className="text-[11px]">
                          {ent}: {arr.length}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>

          {/* TAB 2: CALL BOOKINGS & PROPOSALS */}
          <TabsContent value="bookings" className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Booked Discovery &amp; Kickoff Calls</h2>
              <p className="text-xs text-muted-foreground">
                Join video calls with clients, mark calls done, and send a clear proposal with the tabs you need access to.
              </p>

              <div className="mt-4 space-y-3">
                {myBookings.map((bk) => {
                  const inviteShape: MeetingInviteInput = {
                    bookingId: bk.id,
                    topic: bk.topic,
                    notes: bk.notes,
                    categoryLabel: SERVICE_CATEGORY_LABELS[bk.category] ?? bk.category,
                    scheduledAt: bk.scheduledAt,
                    durationMin: bk.durationMin,
                    meetingUrl: bk.meetingUrl,
                    calComUrl: bk.calComUrl,
                    advisorName: bk.advisorName,
                    advisorEmail: bk.advisorEmail ?? state?.user?.email ?? '',
                    clientName: bk.clientCompanyName,
                    clientCompanyName: bk.clientCompanyName,
                    clientEmail: bk.clientEmail,
                    status: bk.status === 'canceled' ? 'canceled' : 'scheduled',
                  };
                  return (
                  <div key={bk.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{bk.clientCompanyName}</span>
                        <Badge variant={bk.status === 'scheduled' ? 'default' : 'secondary'}>{bk.status}</Badge>
                        <span className="text-muted-foreground">· {SERVICE_CATEGORY_LABELS[bk.category]}</span>
                      </div>
                      <p className="font-medium">{bk.topic}</p>
                      <p className="text-muted-foreground">
                        When: {bk.scheduledAt.slice(0, 16).replace('T', ' ')} ({bk.durationMin} min) · Client email: {bk.clientEmail}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {bk.status === 'scheduled' && (
                        <>
                          <a href={buildGoogleCalendarUrl(inviteShape)} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="ghost" className="h-8 text-xs">
                              + Google Cal
                            </Button>
                          </a>
                          <a href={buildIcsDataUrl(buildMeetingIcs(inviteShape))} download={`borga-call-${bk.id}.ics`}>
                            <Button size="sm" variant="ghost" className="h-8 text-xs">
                              .ics
                            </Button>
                          </a>
                        </>
                      )}
                      <a href={bk.meetingUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
                          <ExternalLink className="h-3.5 w-3.5" /> Join Video Call
                        </Button>
                      </a>
                      <Button
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        onClick={() => {
                          setProposalBooking(bk);
                          setPropCategory(bk.category);
                          setPropTitle(`${SERVICE_CATEGORY_LABELS[bk.category]} for ${bk.clientCompanyName}`);
                        }}
                      >
                        <Send className="h-3.5 w-3.5" /> Send Proposal
                      </Button>
                      {bk.status === 'scheduled' && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => void post({ action: 'updateBookingStatus', bookingId: bk.id, status: 'completed' }).then(() => load())}
                          >
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs text-rose-600"
                            onClick={() => void post({ action: 'updateBookingStatus', bookingId: bk.id, status: 'canceled' }).then(() => load())}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  );
                })}
                {myBookings.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No calls booked yet.
                  </p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <h2 className="text-sm font-semibold">Proposals You Have Sent ({myProposals.length})</h2>
              <div className="mt-3 space-y-2">
                {myProposals.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs">
                    <div>
                      <span className="font-semibold">{p.title}</span>
                      <span className="ml-2 text-muted-foreground">→ {p.clientCompanyName}</span>
                      <p className="text-[11px] text-muted-foreground">
                        Tabs requested: {p.requestedScopes.join(', ')} · Client pays {fmtUsdCents(p.grossCents)} → Your take-home: {fmtUsdCents(p.advisorNetCents)}
                      </p>
                    </div>
                    <Badge variant={p.status === 'accepted' ? 'default' : p.status === 'sent' ? 'secondary' : 'outline'}>
                      {p.status}
                    </Badge>
                  </div>
                ))}
                {myProposals.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">No proposals sent yet.</p>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* TAB 3: EARNINGS, CHARTS & PAYOUT LEDGER */}
          <TabsContent value="earnings" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="p-5 lg:col-span-7">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Earnings by Client Company</h2>
                    <p className="text-xs text-muted-foreground">
                      Your {100 - feePct}% take-home pay compared to the {feePct}% platform fee for each client.
                    </p>
                  </div>
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <div className="mt-4 h-64 w-full">
                  {clientEarningsChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={clientEarningsChartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                        <XAxis dataKey="client" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip formatter={(value: number) => `$${Number(value).toLocaleString()}`} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="yourTakeHome" stackId="a" name={`Your Take-Home (${100 - feePct}%)`} fill="#10b981" />
                        <Bar dataKey="platformFee" stackId="a" name={`Platform Fee (${feePct}%)`} fill="#6366f1" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      Your client earnings chart will appear as soon as your first proposal or package is paid.
                    </div>
                  )}
                </div>
              </Card>

              <Card className="space-y-4 p-5 lg:col-span-5">
                <div>
                  <h2 className="text-sm font-semibold">Your Advisory Funnel</h2>
                  <p className="text-xs text-muted-foreground">How clients move from first call to completed work.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground">1. Discovery Calls</p>
                    <p className="mt-1 text-xl font-bold">{myBookings.length}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground">2. Proposals Sent</p>
                    <p className="mt-1 text-xl font-bold">{myProposals.length}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground">3. Active Clients</p>
                    <p className="mt-1 text-xl font-bold text-primary">{myEngagements.filter((e) => e.status === 'active').length}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-muted-foreground">4. Updates Logged</p>
                    <p className="mt-1 text-xl font-bold text-emerald-600">
                      {myEngagements.reduce((s, e) => s + e.workLog.length, 0)}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="text-sm font-semibold">All Invoices &amp; Payout History ({allInvoices.length})</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Client Company</th>
                      <th className="pb-2 font-medium">Description</th>
                      <th className="pb-2 font-medium">Client Paid</th>
                      <th className="pb-2 font-medium">Platform Fee ({feePct}%)</th>
                      <th className="pb-2 text-right font-medium">Your Take-Home ({100 - feePct}%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {allInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="py-2.5 pr-3">{(inv.paidAt ?? inv.issuedAt).slice(0, 10)}</td>
                        <td className="py-2.5 pr-3 font-semibold">{inv.clientCompanyName}</td>
                        <td className="py-2.5 pr-3">{inv.description}</td>
                        <td className="py-2.5 pr-3 font-medium">{fmtUsdCents(inv.grossCents)}</td>
                        <td className="py-2.5 pr-3 text-muted-foreground">{fmtUsdCents(inv.platformFeeCents)}</td>
                        <td className="py-2.5 text-right font-semibold text-emerald-600">{fmtUsdCents(inv.advisorNetCents)}</td>
                      </tr>
                    ))}
                    {allInvoices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-muted-foreground">
                          No invoices recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* TAB 4: ADVISOR PROFILE & PACKAGES */}
          <TabsContent value="profile" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="text-sm font-semibold">Your Public Advisor Profile</h2>
                  <p className="text-xs text-muted-foreground">
                    Tell business owners how you can help them and which tabs you usually need access to.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Your Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe, CPA" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Agency / Firm Name (optional)</label>
                    <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Apex Advisory Partners" />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Short Tagline</label>
                    <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Fractional CFO, Bookkeeping & Tax" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Hourly Rate ($ USD)</label>
                    <Input type="number" value={hourlyDollars} onChange={(e) => setHourlyDollars(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium">About You &amp; Your Experience</label>
                  <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Share your background and the kind of businesses you love helping…" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">What Services Do You Offer?</label>
                  <div className="flex flex-wrap gap-1.5">
                    {SERVICE_CATEGORIES.map((cat) => {
                      const active = categories.includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() =>
                            setCategories((prev) =>
                              prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition ${
                            active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground'
                          }`}
                        >
                          {SERVICE_CATEGORY_LABELS[cat]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Which Client Tabs Do You Usually Need?</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ADVISOR_MODULE_SCOPES.map((sc) => {
                      const active = defaultScopes.includes(sc);
                      return (
                        <button
                          key={sc}
                          type="button"
                          onClick={() =>
                            setDefaultScopes((prev) =>
                              prev.includes(sc) ? prev.filter((s) => s !== sc) : [...prev, sc],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition ${
                            active ? 'border-primary bg-primary/15 font-medium text-primary' : 'bg-background text-muted-foreground'
                          }`}
                        >
                          {ADVISOR_SCOPE_LABELS[sc].label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Cal.com Scheduling URL (optional)</label>
                    <Input
                      value={calComUrl}
                      onChange={(e) => setCalComUrl(e.target.value)}
                      placeholder="https://cal.com/your-name/45min"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Cal.com Event Type ID (optional)</label>
                    <Input
                      type="number"
                      value={calComEventTypeId}
                      onChange={(e) => setCalComEventTypeId(e.target.value)}
                      placeholder="e.g. 123456"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>

                <Button onClick={() => void saveProfile()} disabled={busy === 'saveProfile'}>
                  {busy === 'saveProfile' ? 'Saving…' : 'Save Your Profile'}
                </Button>
              </Card>

              <Card className="space-y-4 p-5">
                <div>
                  <h2 className="text-sm font-semibold">Fixed-Price Packages ({packages.length})</h2>
                  <p className="text-xs text-muted-foreground">
                    List ready-to-buy packages so business owners can hire you and share their tabs in one click.
                  </p>
                </div>

                <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs">
                  <p className="font-medium">Add a New Package</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={pkgTitle} onChange={(e) => setPkgTitle(e.target.value)} placeholder="e.g. Monthly Bookkeeping & Tax Close" className="h-8 text-xs" />
                    <Input type="number" value={pkgPriceDollars} onChange={(e) => setPkgPriceDollars(e.target.value)} placeholder="Price ($)" className="h-8 text-xs" />
                  </div>
                  <Input value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} placeholder="What you deliver for the client…" className="h-8 text-xs" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={pkgCategory} onValueChange={(v) => setPkgCategory(v as ServiceCategory)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SERVICE_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{SERVICE_CATEGORY_LABELS[c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={pkgCycle} onValueChange={(v) => setPkgCycle(v as 'monthly' | 'one_time')}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly Retainer</SelectItem>
                        <SelectItem value="one_time">One-Time Project</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {ADVISOR_MODULE_SCOPES.map((sc) => (
                      <button
                        key={sc}
                        type="button"
                        onClick={() =>
                          setPkgScopes((prev) => (prev.includes(sc) ? prev.filter((s) => s !== sc) : [...prev, sc]))
                        }
                        className={`rounded border px-2 py-0.5 text-[10px] ${
                          pkgScopes.includes(sc) ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground'
                        }`}
                      >
                        {ADVISOR_SCOPE_LABELS[sc].label}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => void addPackage()} disabled={!pkgTitle.trim()}>
                    <Plus className="h-3.5 w-3.5" /> Add Package
                  </Button>
                </div>

                <div className="space-y-2">
                  {packages.map((p) => {
                    const sp = computeFeeSplit(p.priceCents, feePct);
                    return (
                      <div key={p.id} className="flex items-center justify-between rounded-lg border p-3 text-xs">
                        <div>
                          <p className="font-semibold">{p.title} · {fmtUsdCents(p.priceCents)} ({p.billingCycle === 'monthly' ? 'monthly' : 'one-time'})</p>
                          <p className="text-[11px] text-muted-foreground">{p.description}</p>
                          <p className="text-[11px] text-emerald-600">
                            Your take-home ({100 - feePct}%): {fmtUsdCents(sp.advisorNetCents)} · Tabs: {p.scopes.join(', ')}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => void removePackage(p.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Send Proposal Dialog */}
      <Dialog open={!!proposalBooking} onOpenChange={(o) => !o && setProposalBooking(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Proposal to {proposalBooking?.clientCompanyName}</DialogTitle>
            <DialogDescription>
              Set your price and choose which tabs you need the client to share with you. You keep {100 - feePct}% and Borga takes a {feePct}% platform fee.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium">Proposal Title</label>
              <Input value={propTitle} onChange={(e) => setPropTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="font-medium">What You Will Do for Them</label>
              <Textarea value={propSummary} onChange={(e) => setPropSummary(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-medium">Price ($ USD)</label>
                <Input type="number" value={propPriceDollars} onChange={(e) => setPropPriceDollars(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="font-medium">How Often</label>
                <Select value={propCycle} onValueChange={(v) => setPropCycle(v as 'monthly' | 'one_time')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly Retainer</SelectItem>
                    <SelectItem value="one_time">One-Time Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="font-medium">Client Tabs You Need Access To</label>
              <div className="flex flex-wrap gap-1.5">
                {ADVISOR_MODULE_SCOPES.map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() =>
                      setPropScopes((prev) => (prev.includes(sc) ? prev.filter((s) => s !== sc) : [...prev, sc]))
                    }
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      propScopes.includes(sc) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {ADVISOR_SCOPE_LABELS[sc].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-2.5">
              Client pays <strong>{fmtUsdCents(propSplit.grossCents)}</strong> → Borga fee ({propSplit.platformFeePct}%):{' '}
              <strong>{fmtUsdCents(propSplit.platformFeeCents)}</strong> · Your take-home ({100 - propSplit.platformFeePct}%):{' '}
              <strong className="text-emerald-600">{fmtUsdCents(propSplit.advisorNetCents)}</strong>
            </div>
            <Button className="w-full gap-1.5" onClick={() => void sendProposal()} disabled={busy === 'sendProposal'}>
              <FileText className="h-4 w-4" /> {busy === 'sendProposal' ? 'Sending…' : 'Send Proposal to Client'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
