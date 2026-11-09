'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  DollarSign,
  Globe,
  Lock,
  MailPlus,
  PauseCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FEATURE_GROUPS, type FeatureDef, type FeatureId } from '@/lib/borga/features';
import {
  ADMIN_PAYMENT_RAIL_LABELS,
  SERVICE_CATEGORY_LABELS,
  ADVISOR_SCOPE_LABELS,
  DEFAULT_PAYMENT_RAILS_CONFIG,
  computeFeeSplit,
  type AdminCollectionKind,
  type AdminCollectionStatus,
  type AdminCollectionsSummary,
  type AdminPaymentCollectionRecord,
  type AdminPaymentRail,
  type AdminPaymentRailsConfig,
  type AdvisorLeaderboardRow,
  type AdvisorProfile,
  type AdvisorStatus,
  type CategoryRevenueBreakdown,
  type CountryCompanyBreakdown,
  type FeatureAdoptionRow,
  type IndustryCompanyBreakdown,
  type MonthlyRevenuePoint,
  type PlatformAdminConfig,
  type ServiceBooking,
  type ServiceEngagement,
  type ServiceProposal,
} from '@/lib/borga/shared-services';
import type { AdminCompanyRow } from '@/lib/borga/shared-services-server';
import { toast } from '@/lib/toast-bus';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };
const CHART_COLORS = ['#6366f1', '#10b981', '#0ea5e9', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

const fmtUsdCents = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface AdminOverviewResponse {
  ok: boolean;
  error?: string;
  operator?: { userId: string; email: string };
  config: PlatformAdminConfig;
  featureCatalog: readonly FeatureDef[];
  envLockedFeatures: FeatureId[];
  companies: AdminCompanyRow[];
  advisors: AdvisorProfile[];
  bookings: ServiceBooking[];
  proposals: ServiceProposal[];
  engagements: ServiceEngagement[];
  collections: AdminPaymentCollectionRecord[];
  collectionsSummary: AdminCollectionsSummary;
  analytics: {
    totalWorkspaces: number;
    billableWorkspaces: number;
    totalSeats: number;
    billableSeats: number;
    subscriptionMrrCents: number;
    servicesGrossCents: number;
    platformFeeRevenueCents: number;
    advisorNetPayoutCents: number;
    activeEngagements: number;
  };
  breakdowns: {
    revenueByCategory: CategoryRevenueBreakdown[];
    companiesByCountry: CountryCompanyBreakdown[];
    companiesByIndustry: IndustryCompanyBreakdown[];
    advisorLeaderboard: AdvisorLeaderboardRow[];
    featureAdoption: FeatureAdoptionRow[];
    monthlySeries: MonthlyRevenuePoint[];
  };
}

interface InviteRow {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  revoked: boolean;
}

export default function AdminPortalPage() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Global settings state
  const [platformName, setPlatformName] = useState('Borga');
  const [supportEmail, setSupportEmail] = useState('support@borga.app');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [defaultTimezone, setDefaultTimezone] = useState('UTC');
  const [seatPriceDollars, setSeatPriceDollars] = useState('2.00');
  const [platformFeePct, setPlatformFeePct] = useState('15');
  const [trialDays, setTrialDays] = useState('14');
  const [maxWorkspaces, setMaxWorkspaces] = useState('10');
  const [autoApproveAdvisors, setAutoApproveAdvisors] = useState(false);
  const [allowUpfrontPackages, setAllowUpfrontPackages] = useState(true);
  const [minAdvisorRateDollars, setMinAdvisorRateDollars] = useState('25');
  const [dailyAiCap, setDailyAiCap] = useState('30');
  const [requireHumanApproval, setRequireHumanApproval] = useState(true);
  const [signupMode, setSignupMode] = useState<'default' | 'open' | 'invite' | 'closed'>('default');
  const [billingMode, setBillingMode] = useState<'default' | 'off' | 'enforce'>('default');
  const [banner, setBanner] = useState('');
  const [paymentRails, setPaymentRails] = useState<AdminPaymentRailsConfig>(DEFAULT_PAYMENT_RAILS_CONFIG);

  // Payment collection composer & filter state
  const [activeAdminTab, setActiveAdminTab] = useState('analytics');
  const [colKind, setColKind] = useState<AdminCollectionKind>('subscription');
  const [colCompanyKey, setColCompanyKey] = useState('');
  const [colEngagementId, setColEngagementId] = useState('');
  const [colAmountDollars, setColAmountDollars] = useState('');
  const [colRail, setColRail] = useState<AdminPaymentRail>('stripe');
  const [colStatus, setColStatus] = useState<AdminCollectionStatus>('pending');
  const [colDescription, setColDescription] = useState('');
  const [colReference, setColReference] = useState('');
  const [colFilter, setColFilter] = useState<'all' | 'pending' | 'paid' | 'payouts-due'>('all');

  // Company filter & modal
  const [companyQuery, setCompanyQuery] = useState('');
  const [inspectCompany, setInspectCompany] = useState<AdminCompanyRow | null>(null);

  // Invites
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, invRes] = await Promise.all([
        fetch('/api/borga/admin', { cache: 'no-store' }),
        fetch('/api/borga/operator/invites', { cache: 'no-store' }),
      ]);
      const json = (await res.json()) as AdminOverviewResponse;
      if (!res.ok || !json.ok) {
        setForbidden(json.error ?? 'Access denied.');
        setLoading(false);
        return;
      }
      setForbidden(null);
      setData(json);
      const c = json.config;
      setPlatformName(c.platformName);
      setSupportEmail(c.supportEmail);
      setDefaultCurrency(c.defaultCurrency);
      setDefaultTimezone(c.defaultTimezone);
      setSeatPriceDollars((c.pricePerUserCents / 100).toFixed(2));
      setPlatformFeePct(String(c.platformFeePct));
      setTrialDays(String(c.trialDays));
      setMaxWorkspaces(String(c.maxWorkspacesPerUser));
      setAutoApproveAdvisors(c.autoApproveAdvisors);
      setAllowUpfrontPackages(c.allowUpfrontPackages);
      setMinAdvisorRateDollars((c.minAdvisorRateCents / 100).toFixed(0));
      setDailyAiCap(String(c.defaultDailyAiRunCap));
      setRequireHumanApproval(c.requireHumanApprovalForPayments);
      setSignupMode(c.signupModeOverride);
      setBillingMode(c.billingModeOverride);
      setBanner(c.maintenanceBanner);
      setPaymentRails(c.paymentRails ?? DEFAULT_PAYMENT_RAILS_CONFIG);
      if (json.companies.length > 0) {
        const first = json.companies[0];
        setColCompanyKey((prev) => prev || `${first.userId}::${first.wsId}`);
        setColAmountDollars((prev) => prev || (first.monthlyCents / 100).toFixed(2));
      }

      if (invRes.ok) {
        const invJson = (await invRes.json()) as { ok: boolean; invites?: InviteRow[] };
        if (invJson.ok && invJson.invites) setInvites(invJson.invites);
      }
    } catch {
      setForbidden('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const postAdmin = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/borga/admin', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(payload),
    });
    return (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  };

  const saveConfig = async () => {
    setBusy('saveConfig');
    const r = await postAdmin({
      action: 'saveConfig',
      platformName,
      supportEmail,
      defaultCurrency,
      defaultTimezone,
      pricePerUserCents: Math.round((Number(seatPriceDollars) || 0) * 100),
      platformFeePct: Number.isFinite(Number(platformFeePct)) ? Number(platformFeePct) : 15,
      trialDays: Math.round(Number(trialDays) || 14),
      maxWorkspacesPerUser: Math.round(Number(maxWorkspaces) || 10),
      autoApproveAdvisors,
      allowUpfrontPackages,
      minAdvisorRateCents: Math.round((Number(minAdvisorRateDollars) || 0) * 100),
      defaultDailyAiRunCap: Math.round(Number(dailyAiCap) || 30),
      requireHumanApprovalForPayments: requireHumanApproval,
      signupModeOverride: signupMode,
      billingModeOverride: billingMode,
      maintenanceBanner: banner,
      paymentRails,
    });
    setBusy(null);
    if (r.ok) {
      toast({ title: 'Global settings saved', description: 'Your changes are live across the platform.', variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not save settings', description: r.error, variant: 'error' });
    }
  };

  const toggleGlobal = async (featureId: FeatureId, enabled: boolean) => {
    setBusy(`gf-${featureId}`);
    const r = await postAdmin({ action: 'toggleGlobalFeature', featureId, enabled });
    setBusy(null);
    if (r.ok) {
      toast({ title: enabled ? 'Tool turned on for everyone' : 'Tool turned off platform-wide', description: featureId, variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not change tool', description: r.error, variant: 'error' });
    }
  };

  const toggleCompanyFeature = async (company: AdminCompanyRow, featureId: FeatureId, enabled: boolean) => {
    setBusy(`wf-${company.wsId}-${featureId}`);
    const r = await postAdmin({
      action: 'toggleWorkspaceFeature',
      userId: company.userId,
      ws: company.wsId,
      featureId,
      enabled,
    });
    setBusy(null);
    if (r.ok) {
      const updatedFlags = { ...company.features, [featureId]: enabled };
      setInspectCompany({ ...company, features: updatedFlags });
      void load();
    } else {
      toast({ title: 'Could not update company tool', description: r.error, variant: 'error' });
    }
  };

  const toggleComped = async (company: AdminCompanyRow, comped: boolean) => {
    setBusy(`comp-${company.wsId}`);
    const r = await postAdmin({
      action: 'setComped',
      userId: company.userId,
      ws: company.wsId,
      comped,
    });
    setBusy(null);
    if (r.ok) {
      toast({
        title: comped ? `${company.name} is now on the house ($0/mo)` : `${company.name} is back on standard billing`,
        variant: 'success',
      });
      void load();
    } else {
      toast({ title: 'Could not update billing', description: r.error, variant: 'error' });
    }
  };

  const vetAdvisor = async (advisorId: string, status: AdvisorStatus) => {
    setBusy(`adv-${advisorId}`);
    const r = await postAdmin({ action: 'vetAdvisor', advisorId, status });
    setBusy(null);
    if (r.ok) {
      toast({ title: `Advisor marked ${status}`, variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not update advisor', description: r.error, variant: 'error' });
    }
  };

  const createInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy('invite');
    const res = await fetch('/api/borga/operator/invites', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });
    const j = (await res.json()) as { ok: boolean; link?: string; error?: string };
    setBusy(null);
    if (j.ok && j.link) {
      setLastInviteLink(j.link);
      setInviteEmail('');
      toast({ title: 'Invite link created', variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not create invite', description: j.error, variant: 'error' });
    }
  };

  const prefillCompanyCollection = (company: AdminCompanyRow) => {
    setColKind('subscription');
    setColCompanyKey(`${company.userId}::${company.wsId}`);
    setColAmountDollars((Math.max(200, company.monthlyCents) / 100).toFixed(2));
    setColDescription(`${company.name} — Monthly Workspace Subscription (${company.seats} seats)`);
    setActiveAdminTab('collections');
  };

  const submitCollection = async () => {
    if (!data) return;
    const grossCents = Math.round((Number(colAmountDollars) || 0) * 100);
    if (grossCents <= 0) {
      toast({ title: 'Enter an amount greater than $0.00', variant: 'warning' });
      return;
    }

    let targetUserId = '';
    let targetWs = '';
    let companyName = '';
    let contactEmail = '';
    let advisorId: string | undefined;
    let advisorName: string | undefined;

    if (colKind === 'shared_service_fee' && colEngagementId) {
      const eng = data.engagements.find((e) => e.id === colEngagementId);
      if (eng) {
        targetUserId = eng.clientUserId;
        targetWs = eng.clientWs;
        companyName = eng.clientCompanyName;
        const matchedCo = data.companies.find((c) => c.userId === eng.clientUserId && c.wsId === eng.clientWs);
        contactEmail = matchedCo?.ownerEmail ?? '';
        advisorId = eng.advisorId;
        advisorName = eng.advisorName;
      }
    }

    if (!targetUserId || !targetWs) {
      const [uId, wId] = colCompanyKey.split('::');
      const co = data.companies.find((c) => c.userId === uId && c.wsId === wId) ?? data.companies[0];
      if (!co) {
        toast({ title: 'Select a target company workspace', variant: 'warning' });
        return;
      }
      targetUserId = co.userId;
      targetWs = co.wsId;
      companyName = co.name;
      contactEmail = co.ownerEmail;
    }

    setBusy('createCollection');
    const r = await postAdmin({
      action: 'createCollection',
      kind: colKind,
      targetUserId,
      targetWs,
      companyName,
      contactEmail,
      engagementId: colKind === 'shared_service_fee' ? colEngagementId || undefined : undefined,
      advisorId,
      advisorName,
      description: colDescription.trim() || undefined,
      grossCents,
      currency: defaultCurrency,
      rail: colRail,
      status: colStatus,
      reference: colReference.trim() || undefined,
    });
    setBusy(null);
    if (r.ok) {
      toast({
        title: colStatus === 'paid' ? 'Payment collected & recorded' : 'Payment collection request issued',
        description: `${fmtUsdCents(grossCents)} for ${companyName} via ${ADMIN_PAYMENT_RAIL_LABELS[colRail]}`,
        variant: 'success',
      });
      setColDescription('');
      setColReference('');
      void load();
    } else {
      toast({ title: 'Could not create collection', description: r.error, variant: 'error' });
    }
  };

  const markCollectionPaidNow = async (collectionId: string) => {
    setBusy(`col-paid-${collectionId}`);
    const r = await postAdmin({ action: 'markCollectionPaid', collectionId });
    setBusy(null);
    if (r.ok) {
      toast({ title: 'Collection marked as paid', variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not update collection', description: r.error, variant: 'error' });
    }
  };

  const disburseAdvisorPayoutNow = async (collectionId: string) => {
    setBusy(`col-payout-${collectionId}`);
    const r = await postAdmin({ action: 'markPayoutDisbursed', collectionId });
    setBusy(null);
    if (r.ok) {
      toast({ title: '85% Advisor payout marked as disbursed', variant: 'success' });
      void load();
    } else {
      toast({ title: 'Could not record payout', description: r.error, variant: 'error' });
    }
  };

  const filteredCompanies = useMemo(() => {
    if (!data) return [];
    const q = companyQuery.trim().toLowerCase();
    if (!q) return data.companies;
    return data.companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ownerEmail.toLowerCase().includes(q) ||
        c.industry.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q),
    );
  }, [data, companyQuery]);

  const sampleSplit = useMemo(
    () => computeFeeSplit(100_000, Number(platformFeePct) || 15),
    [platformFeePct],
  );

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        Loading Admin Control Center…
      </div>
    );
  }

  if (forbidden || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <ShieldAlert className="h-10 w-10 text-rose-500" />
        <h1 className="text-lg font-semibold">Admin Portal Rail Restricted</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {forbidden ?? 'Only platform administrators can open this page. Sign in with an authorized administrator account.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login?role=admin&next=/admin">
            <Button className="gap-1.5">
              <Sliders className="h-4 w-4" /> Log in as System Administrator
            </Button>
          </Link>
          <Link href="/app">
            <Button variant="outline" className="gap-1.5">
              <ArrowLeft className="h-4 w-4" /> Back to Company Workspace
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { analytics, breakdowns, config, advisors } = data;
  const totalPlatformMonthlyCents = analytics.subscriptionMrrCents + analytics.platformFeeRevenueCents;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sliders className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold">{config.platformName} Admin Control Center</h1>
                <Badge variant="secondary" className="text-[11px]">Signed in: {data.operator?.email}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Look after every company, review advisors, set global rules ({fmtUsdCents(config.pricePerUserCents)}/person/mo + {config.platformFeePct}% advisor fee), and track platform growth.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/services">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Briefcase className="h-4 w-4" /> Advisor Portal (/services)
              </Button>
            </Link>
            <Link href="/app">
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowLeft className="h-4 w-4" /> Company Dashboard (/app)
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => void load()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* Humanized Headline KPI Strip */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Monthly Seat Subscriptions</span>
              <DollarSign className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-2 text-2xl font-bold">
              {fmtUsdCents(analytics.subscriptionMrrCents)}
              <span className="text-xs font-normal text-muted-foreground"> / month</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {analytics.billableSeats} paid team members across {analytics.billableWorkspaces} companies ({fmtUsdCents(config.pricePerUserCents)} each)
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{config.platformName}&apos;s {config.platformFeePct}% Share of Advisor Fees</span>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-2 text-2xl font-bold text-primary">{fmtUsdCents(analytics.platformFeeRevenueCents)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              From {fmtUsdCents(analytics.servicesGrossCents)} in total client work billed through Shared Services
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Paid Out to Advisors ({100 - config.platformFeePct}%)</span>
              <Briefcase className="h-4 w-4 text-sky-500" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-600">{fmtUsdCents(analytics.advisorNetPayoutCents)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {analytics.activeEngagements} active client jobs · {advisors.filter((a) => a.status === 'approved').length} approved advisors
            </p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Total Platform Earnings</span>
              <Building2 className="h-4 w-4 text-amber-500" />
            </div>
            <p className="mt-2 text-2xl font-bold">{fmtUsdCents(totalPlatformMonthlyCents)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {analytics.totalWorkspaces} companies · {analytics.totalSeats} team members (outside advisors ride free)
            </p>
          </Card>
        </div>

        <Tabs value={activeAdminTab} onValueChange={setActiveAdminTab} className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="analytics">Analytics &amp; Charts</TabsTrigger>
            <TabsTrigger value="collections">Payment Collections ({data.collections?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="companies">Companies ({data.companies.length})</TabsTrigger>
            <TabsTrigger value="settings">Global Settings &amp; Pricing</TabsTrigger>
            <TabsTrigger value="features">Turn Tools On / Off ({data.featureCatalog.length})</TabsTrigger>
            <TabsTrigger value="advisors">Advisors &amp; Agencies ({advisors.length})</TabsTrigger>
            <TabsTrigger value="ledger">Fee Split Ledger ({data.engagements.length})</TabsTrigger>
          </TabsList>

          {/* TAB 1.5: ADMIN PAYMENT COLLECTIONS & PAYOUTS HUB */}
          <TabsContent value="collections" className="space-y-6">
            {/* Collections KPI Strip */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {[
                { label: 'Total Collected', val: fmtUsdCents(data.collectionsSummary?.totalCollectedCents ?? 0), tone: 'text-emerald-600' },
                { label: 'Pending Requests', val: fmtUsdCents(data.collectionsSummary?.pendingCollectionCents ?? 0), tone: 'text-amber-600' },
                { label: 'SaaS Subscriptions', val: fmtUsdCents(data.collectionsSummary?.subscriptionCollectedCents ?? 0), tone: 'text-foreground' },
                { label: `${config.platformFeePct}% Platform Fees`, val: fmtUsdCents(data.collectionsSummary?.platformFeeCollectedCents ?? 0), tone: 'text-primary' },
                { label: '85% Payouts Due', val: fmtUsdCents(data.collectionsSummary?.pendingAdvisorPayoutCents ?? 0), tone: 'text-rose-600' },
                { label: 'Payouts Disbursed', val: fmtUsdCents(data.collectionsSummary?.completedAdvisorPayoutCents ?? 0), tone: 'text-sky-600' },
              ].map((k) => (
                <Card key={k.label} className="gap-1 p-3.5">
                  <p className="text-[11px] font-medium text-muted-foreground">{k.label}</p>
                  <p className={`font-mono text-base font-semibold tabular-nums ${k.tone}`}>{k.val}</p>
                </Card>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
              {/* Left: Issue / Record Payment Collection */}
              <Card className="space-y-4 p-5 lg:col-span-5">
                <div>
                  <h2 className="text-sm font-semibold">Collect or Record a Payment</h2>
                  <p className="text-xs text-muted-foreground">
                    Bill a company for its $2/seat subscription, collect a Shared Services engagement (auto-splits 85% advisor / {config.platformFeePct}% platform), or record a bank/MoMo receipt.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Collection Type</label>
                    <Select
                      value={colKind}
                      onValueChange={(v) => {
                        const kind = v as AdminCollectionKind;
                        setColKind(kind);
                        if (kind === 'shared_service_fee' && data.engagements[0]) {
                          const firstEng = data.engagements[0];
                          setColEngagementId(firstEng.id);
                          setColAmountDollars(((firstEng.grossCents || 50_000) / 100).toFixed(2));
                        } else if (kind === 'subscription' && data.companies[0]) {
                          const [uId, wId] = colCompanyKey.split('::');
                          const co = data.companies.find((c) => c.userId === uId && c.wsId === wId) ?? data.companies[0];
                          setColAmountDollars((Math.max(200, co.monthlyCents) / 100).toFixed(2));
                        }
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="subscription">Workspace SaaS Subscription ($2/seat/mo)</SelectItem>
                        <SelectItem value="shared_service_fee">Shared Services Engagement (85/15 Split)</SelectItem>
                        <SelectItem value="custom">Custom Platform Charge</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {colKind === 'shared_service_fee' && data.engagements.length > 0 ? (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Client Engagement</label>
                      <Select
                        value={colEngagementId || data.engagements[0]?.id || ''}
                        onValueChange={(id) => {
                          setColEngagementId(id);
                          const eng = data.engagements.find((e) => e.id === id);
                          if (eng && eng.grossCents > 0) {
                            setColAmountDollars((eng.grossCents / 100).toFixed(2));
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Choose engagement…" /></SelectTrigger>
                        <SelectContent>
                          {data.engagements.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.clientCompanyName} · {e.title} ({e.advisorName})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Target Company Workspace</label>
                      <Select
                        value={colCompanyKey}
                        onValueChange={(val) => {
                          setColCompanyKey(val);
                          const [uId, wId] = val.split('::');
                          const co = data.companies.find((c) => c.userId === uId && c.wsId === wId);
                          if (co && colKind === 'subscription') {
                            setColAmountDollars((Math.max(200, co.monthlyCents) / 100).toFixed(2));
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select company…" /></SelectTrigger>
                        <SelectContent>
                          {data.companies.map((c) => (
                            <SelectItem key={`${c.userId}::${c.wsId}`} value={`${c.userId}::${c.wsId}`}>
                              {c.name} ({c.seats} seats · {fmtUsdCents(c.monthlyCents)}/mo)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Amount ({defaultCurrency})</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={colAmountDollars}
                        onChange={(e) => setColAmountDollars(e.target.value)}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Payment Rail</label>
                      <Select value={colRail} onValueChange={(v) => setColRail(v as AdminPaymentRail)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="stripe">Stripe (Cards &amp; Checkout)</SelectItem>
                          <SelectItem value="paystack">Paystack (Card &amp; Bank)</SelectItem>
                          <SelectItem value="momo">Mobile Money (MoMo)</SelectItem>
                          <SelectItem value="bank_transfer">Bank Wire / ACH</SelectItem>
                          <SelectItem value="manual">Manual / Offline Receipt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Collection Action</label>
                      <Select value={colStatus} onValueChange={(v) => setColStatus(v as AdminCollectionStatus)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Send Payment Request (Pending)</SelectItem>
                          <SelectItem value="paid">Record as Paid Immediately</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Reference / Receipt #</label>
                      <Input
                        value={colReference}
                        onChange={(e) => setColReference(e.target.value)}
                        placeholder="Auto-generated if blank"
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Description / Memo</label>
                    <Input
                      value={colDescription}
                      onChange={(e) => setColDescription(e.target.value)}
                      placeholder="e.g. Monthly workspace subscription or Q4 accounting retainer"
                      className="text-xs"
                    />
                  </div>

                  {colKind === 'shared_service_fee' && Number(colAmountDollars) > 0 && (
                    <div className="rounded-lg border border-border/80 bg-muted/20 p-2.5 text-xs">
                      {(() => {
                        const sp = computeFeeSplit(Math.round((Number(colAmountDollars) || 0) * 100), config.platformFeePct);
                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums">
                            <span>Platform ({config.platformFeePct}%): <strong>{fmtUsdCents(sp.platformFeeCents)}</strong></span>
                            <span className="text-emerald-600">Advisor ({100 - config.platformFeePct}%): <strong>{fmtUsdCents(sp.advisorNetCents)}</strong></span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    disabled={busy === 'createCollection'}
                    onClick={() => void submitCollection()}
                  >
                    {busy === 'createCollection'
                      ? 'Processing…'
                      : colStatus === 'paid'
                        ? 'Collect & Mark Paid Now'
                        : 'Issue Payment Collection Request'}
                  </Button>
                </div>
              </Card>

              {/* Right: Payment Gateways & Receiving Accounts Setup */}
              <Card className="space-y-4 p-5 lg:col-span-7">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Admin Payment Gateways &amp; Receiving Rails</h2>
                    <p className="text-xs text-muted-foreground">
                      Configure where company subscription payments and Shared Services fees land across Stripe, Paystack, Mobile Money (MoMo), and Bank Wire.
                    </p>
                  </div>
                  <Button size="sm" onClick={() => void saveConfig()} disabled={busy === 'saveConfig'}>
                    {busy === 'saveConfig' ? 'Saving…' : 'Save Payment Rails'}
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Stripe */}
                  <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/15 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Stripe (Cards &amp; Subscriptions)</span>
                      <Switch
                        checked={paymentRails.stripeEnabled}
                        onCheckedChange={(v) => setPaymentRails({ ...paymentRails, stripeEnabled: v })}
                      />
                    </div>
                    <Input
                      value={paymentRails.stripePublishableKey}
                      onChange={(e) => setPaymentRails({ ...paymentRails, stripePublishableKey: e.target.value })}
                      placeholder="pk_live_… (Publishable key)"
                      className="h-8 font-mono text-xs"
                    />
                    <Input
                      value={paymentRails.stripePaymentLinkBase}
                      onChange={(e) => setPaymentRails({ ...paymentRails, stripePaymentLinkBase: e.target.value })}
                      placeholder="https://buy.stripe.com/… (Optional link)"
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  {/* Paystack & Mobile Money */}
                  <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/15 p-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Paystack &amp; Mobile Money (MoMo)</span>
                      <Switch
                        checked={paymentRails.momoEnabled}
                        onCheckedChange={(v) => setPaymentRails({ ...paymentRails, momoEnabled: v, paystackEnabled: v })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={paymentRails.momoProvider}
                        onChange={(e) => setPaymentRails({ ...paymentRails, momoProvider: e.target.value })}
                        placeholder="MTN MoMo / Telecel"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={paymentRails.momoMerchantNumber}
                        onChange={(e) => setPaymentRails({ ...paymentRails, momoMerchantNumber: e.target.value })}
                        placeholder="+233 … / Merchant ID"
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <Input
                      value={paymentRails.paystackPublicKey}
                      onChange={(e) => setPaymentRails({ ...paymentRails, paystackPublicKey: e.target.value })}
                      placeholder="pk_live_… (Paystack public key)"
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  {/* Bank Wire / ACH */}
                  <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/15 p-3.5 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">Bank Wire / ACH Receiving Account</span>
                      <Switch
                        checked={paymentRails.bankTransferEnabled}
                        onCheckedChange={(v) => setPaymentRails({ ...paymentRails, bankTransferEnabled: v })}
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Input
                        value={paymentRails.bankName}
                        onChange={(e) => setPaymentRails({ ...paymentRails, bankName: e.target.value })}
                        placeholder="Bank Name (e.g. Mercury / Ecobank)"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={paymentRails.bankAccountName}
                        onChange={(e) => setPaymentRails({ ...paymentRails, bankAccountName: e.target.value })}
                        placeholder="Account Holder Name"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={paymentRails.bankAccountNumber}
                        onChange={(e) => setPaymentRails({ ...paymentRails, bankAccountNumber: e.target.value })}
                        placeholder="Account # / IBAN"
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={paymentRails.bankRoutingOrSwift}
                        onChange={(e) => setPaymentRails({ ...paymentRails, bankRoutingOrSwift: e.target.value })}
                        placeholder="Routing / SWIFT / Sort Code"
                        className="h-8 font-mono text-xs"
                      />
                      <Input
                        value={paymentRails.paymentInstructions}
                        onChange={(e) => setPaymentRails({ ...paymentRails, paymentInstructions: e.target.value })}
                        placeholder="Payment memo instructions"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* Collections & Advisor Payouts Ledger */}
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Payment Collections &amp; Advisor Payouts Ledger</h2>
                  <p className="text-xs text-muted-foreground">
                    Track every subscription invoice and Shared Services collection, mark pending requests paid, and disburse 85% advisor payouts.
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-border/80 bg-muted/35 p-0.5 text-xs">
                  {(
                    [
                      ['all', 'All'],
                      ['pending', 'Pending'],
                      ['paid', 'Collected'],
                      ['payouts-due', '85% Payouts Due'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setColFilter(id)}
                      className={`rounded-md px-3 py-1 font-medium transition ${
                        colFilter === id ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2.5 font-medium">Ref &amp; Description</th>
                      <th className="pb-2.5 font-medium">Company / Advisor</th>
                      <th className="pb-2.5 font-medium">Rail</th>
                      <th className="pb-2.5 text-right font-medium">Gross</th>
                      <th className="pb-2.5 text-right font-medium">Platform Cut</th>
                      <th className="pb-2.5 text-right font-medium">Advisor 85%</th>
                      <th className="pb-2.5 font-medium">Status</th>
                      <th className="pb-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(data.collections ?? [])
                      .filter((c) => {
                        if (colFilter === 'pending') return c.status === 'pending';
                        if (colFilter === 'paid') return c.status === 'paid';
                        if (colFilter === 'payouts-due') return c.status === 'paid' && c.advisorPayoutStatus === 'unpaid' && c.advisorPayoutCents > 0;
                        return true;
                      })
                      .map((c) => (
                        <tr key={c.id} className="hover:bg-muted/25">
                          <td className="py-2.5 pr-3">
                            <p className="font-medium text-foreground">{c.description}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {c.reference} · {new Date(c.issuedAt).toLocaleDateString()}
                            </p>
                          </td>
                          <td className="py-2.5 pr-3">
                            <p className="font-medium">{c.companyName}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {c.advisorName ? `Advisor: ${c.advisorName}` : c.contactEmail}
                            </p>
                          </td>
                          <td className="py-2.5 pr-3">
                            <Badge variant="outline" className="text-[10px]">
                              {ADMIN_PAYMENT_RAIL_LABELS[c.rail] ?? c.rail}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono font-medium tabular-nums">
                            {fmtUsdCents(c.grossCents)}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums text-primary">
                            {fmtUsdCents(c.platformFeeCents)}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-emerald-600">
                            {c.advisorPayoutCents > 0 ? fmtUsdCents(c.advisorPayoutCents) : '—'}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="flex flex-wrap items-center gap-1">
                              <Badge variant={c.status === 'paid' ? 'default' : 'secondary'}>
                                {c.status}
                              </Badge>
                              {c.advisorPayoutCents > 0 && (
                                <Badge variant={c.advisorPayoutStatus === 'paid' ? 'secondary' : 'outline'} className="text-[10px]">
                                  {c.advisorPayoutStatus === 'paid' ? 'Advisor Paid' : 'Payout Due'}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {c.status === 'pending' && (
                                <Button
                                  size="sm"
                                  className="h-7 text-[11px]"
                                  disabled={busy === `col-paid-${c.id}`}
                                  onClick={() => void markCollectionPaidNow(c.id)}
                                >
                                  Mark Paid
                                </Button>
                              )}
                              {c.status === 'paid' && c.advisorPayoutCents > 0 && c.advisorPayoutStatus === 'unpaid' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-[11px]"
                                  disabled={busy === `col-payout-${c.id}`}
                                  onClick={() => void disburseAdvisorPayoutNow(c.id)}
                                >
                                  Disburse 85%
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    {(data.collections ?? []).length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-muted-foreground">
                          No payment collections recorded yet — use the form above or click &ldquo;Collect&rdquo; next to any company.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* TAB 1: ANALYTICS, CHARTS, GRAPHS & TABLES */}
          <TabsContent value="analytics" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Chart 1: 6-Month Revenue & Fee Trend */}
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Platform Revenue &amp; Advisor Payout Trend (Last 6 Months)</h2>
                    <p className="text-xs text-muted-foreground">
                      Seat subscriptions ($2/user) alongside Shared Services platform fees ({config.platformFeePct}%) and advisor take-home ({100 - config.platformFeePct}%).
                    </p>
                  </div>
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <div className="mt-4 h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={breakdowns.monthlySeries}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(value: number) => `$${Number(value).toLocaleString()}`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="subscriptionMrrDollars" name="Seat Subscriptions ($)" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                      <Area type="monotone" dataKey="platformFeeDollars" name={`Platform ${config.platformFeePct}% Fee ($)`} stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
                      <Area type="monotone" dataKey="advisorNetDollars" name={`Advisor ${100 - config.platformFeePct}% Take-Home ($)`} stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.15} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Chart 2: Shared Services Revenue by Service Category */}
              <Card className="p-5">
                <div>
                  <h2 className="text-sm font-semibold">Shared Services Billings by Category</h2>
                  <p className="text-xs text-muted-foreground">
                    Which services companies hire most (Advisor 85% take-home vs Borga 15% fee).
                  </p>
                </div>
                <div className="mt-4 h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={breakdowns.revenueByCategory.map((r) => ({
                        name: r.label.split(' ')[0],
                        fullLabel: r.label,
                        advisorDollars: Math.round(r.advisorNetCents) / 100,
                        platformDollars: Math.round(r.platformFeeCents) / 100,
                        jobs: r.engagements,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip formatter={(value: number) => `$${Number(value).toLocaleString()}`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="advisorDollars" stackId="a" name="Advisor Take-Home ($)" fill="#10b981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="platformDollars" stackId="a" name="Platform 15% Cut ($)" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            {/* Row 2: Geography Pie Chart + Country/Industry Tables */}
            <div className="grid gap-6 lg:grid-cols-12">
              <Card className="p-5 lg:col-span-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Companies by Country</h2>
                    <p className="text-xs text-muted-foreground">Where workspaces and team seats are located.</p>
                  </div>
                  <Globe className="h-4 w-4 text-sky-500" />
                </div>
                <div className="mt-3 h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breakdowns.companiesByCountry}
                        dataKey="companies"
                        nameKey="country"
                        cx="50%"
                        cy="50%"
                        outerRadius={72}
                        label={(entry) => `${entry.country} (${entry.companies})`}
                      >
                        {breakdowns.companiesByCountry.map((entry, idx) => (
                          <Cell key={entry.country} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 divide-y border-t pt-2 text-xs">
                  {breakdowns.companiesByCountry.map((c) => (
                    <div key={c.country} className="flex items-center justify-between py-1.5">
                      <span className="font-medium">{c.country}</span>
                      <span className="text-muted-foreground">
                        {c.companies} {c.companies === 1 ? 'company' : 'companies'} · {c.seats} seats · <strong>{fmtUsdCents(c.mrrCents)}/mo</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Top Advisors & Agencies Leaderboard Table */}
              <Card className="p-5 lg:col-span-7">
                <div>
                  <h2 className="text-sm font-semibold">Advisor &amp; Agency Performance Leaderboard</h2>
                  <p className="text-xs text-muted-foreground">
                    Ranked by client work billed, active companies served, and platform fee contribution.
                  </p>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="pb-2 font-medium">Advisor / Agency</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Active Clients</th>
                        <th className="pb-2 font-medium">Total Billed</th>
                        <th className="pb-2 font-medium">Platform {config.platformFeePct}%</th>
                        <th className="pb-2 text-right font-medium">Advisor {100 - config.platformFeePct}%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {breakdowns.advisorLeaderboard.map((row) => (
                        <tr key={row.advisorId}>
                          <td className="py-2.5 pr-2">
                            <p className="font-semibold">{row.name}</p>
                            <p className="text-[11px] text-muted-foreground">{row.email} · ★ {row.rating.toFixed(1)}</p>
                          </td>
                          <td className="py-2.5 pr-2">
                            <Badge variant={row.status === 'approved' ? 'default' : 'secondary'}>{row.status}</Badge>
                          </td>
                          <td className="py-2.5 pr-2 font-medium">{row.activeClients}</td>
                          <td className="py-2.5 pr-2 font-medium">{fmtUsdCents(row.grossCents)}</td>
                          <td className="py-2.5 pr-2 font-semibold text-primary">{fmtUsdCents(row.platformFeeCents)}</td>
                          <td className="py-2.5 text-right font-semibold text-emerald-600">{fmtUsdCents(row.advisorNetCents)}</td>
                        </tr>
                      ))}
                      {breakdowns.advisorLeaderboard.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-muted-foreground">
                            No advisors registered yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Row 3: Feature Adoption Across Workspaces Table */}
            <Card className="p-5">
              <div>
                <h2 className="text-sm font-semibold">Tool Adoption Across All Companies</h2>
                <p className="text-xs text-muted-foreground">
                  How many companies have each module switched on right now.
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {breakdowns.featureAdoption.slice(0, 15).map((f) => (
                  <div key={f.id} className="space-y-1.5 rounded-lg border p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{f.label}</span>
                      <span className="font-mono text-[11px] font-semibold">{f.adoptionPct}%</span>
                    </div>
                    <Progress value={f.adoptionPct} className="h-1.5" />
                    <p className="text-[11px] text-muted-foreground">
                      {f.enabledCount} of {data.companies.length} companies · {f.group}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* TAB 2: COMPANIES */}
          <TabsContent value="companies" className="space-y-4">
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">All Companies on {config.platformName}</h2>
                  <p className="text-xs text-muted-foreground">
                    See who owns each company, how many people are on their team, which advisors are helping them, and customize their tools or billing.
                  </p>
                </div>
                <div className="relative w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={companyQuery}
                    onChange={(e) => setCompanyQuery(e.target.value)}
                    placeholder="Search company, owner, or country…"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 font-medium">Company</th>
                      <th className="pb-2 font-medium">Owner</th>
                      <th className="pb-2 font-medium">Location &amp; Currency</th>
                      <th className="pb-2 font-medium">Team Size</th>
                      <th className="pb-2 font-medium">Outside Advisors</th>
                      <th className="pb-2 font-medium">Monthly Bill</th>
                      <th className="pb-2 font-medium">Free Account (On the House)</th>
                      <th className="pb-2 text-right font-medium">Tools</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredCompanies.map((c) => (
                      <tr key={`${c.userId}-${c.wsId}`} className="hover:bg-muted/30">
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold text-foreground">{c.name}</p>
                          <p className="text-[11px] text-muted-foreground">{c.industry || 'General'}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          <p>{c.ownerName}</p>
                          <p className="text-[11px] text-muted-foreground">{c.ownerEmail}</p>
                        </td>
                        <td className="py-2.5 pr-3">
                          {c.country} ({c.currency})
                        </td>
                        <td className="py-2.5 pr-3 font-medium">{c.seats} {c.seats === 1 ? 'person' : 'people'}</td>
                        <td className="py-2.5 pr-3">
                          {c.activeAdvisors > 0 ? (
                            <Badge variant="secondary">{c.activeAdvisors} helping ($0 seat)</Badge>
                          ) : (
                            <span className="text-muted-foreground">None</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 font-semibold">
                          {c.comped ? (
                            <Badge variant="outline">Free ($0.00)</Badge>
                          ) : (
                            `${fmtUsdCents(c.monthlyCents)}/mo`
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Switch
                            checked={c.comped}
                            disabled={busy === `comp-${c.wsId}`}
                            onCheckedChange={(v) => void toggleComped(c, v)}
                            aria-label={`Free account for ${c.name}`}
                          />
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!c.comped && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 text-xs"
                                onClick={() => prefillCompanyCollection(c)}
                              >
                                Collect {fmtUsdCents(c.monthlyCents)}
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setInspectCompany(c)}>
                              Choose Tools
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredCompanies.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-muted-foreground">
                          No companies match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* TAB 3: COMPREHENSIVE GLOBAL SETTINGS & PRICING */}
          <TabsContent value="settings" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-12">
              <Card className="space-y-5 p-5 lg:col-span-8">
                <div>
                  <h2 className="text-sm font-semibold">Global Platform Settings &amp; Pricing Rules</h2>
                  <p className="text-xs text-muted-foreground">
                    Set the platform name, support contact, seat pricing, advisor commission split, marketplace rules, and AI safety limits.
                  </p>
                </div>

                {/* Section A: Platform Identity & Defaults */}
                <div className="space-y-3 border-t pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1. Platform Identity &amp; Defaults</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Platform Name</label>
                      <Input value={platformName} onChange={(e) => setPlatformName(e.target.value)} placeholder="Borga" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Support Email</label>
                      <Input value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@borga.app" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Default Currency (ISO)</label>
                      <Input value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} placeholder="USD" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Default Timezone</label>
                      <Input value={defaultTimezone} onChange={(e) => setDefaultTimezone(e.target.value)} placeholder="UTC" />
                    </div>
                  </div>
                </div>

                {/* Section B: Pricing, Trials & Limits */}
                <div className="space-y-3 border-t pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2. Pricing, Free Trials &amp; Account Limits</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Price per Person ($/mo)</label>
                      <Input type="number" step="0.50" min="0" value={seatPriceDollars} onChange={(e) => setSeatPriceDollars(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Platform Fee on Advisors (%)</label>
                      <Input type="number" step="0.5" min="0" max="50" value={platformFeePct} onChange={(e) => setPlatformFeePct(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Free Trial (Days)</label>
                      <Input type="number" min="0" max="365" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Max Companies / User</label>
                      <Input type="number" min="1" max="500" value={maxWorkspaces} onChange={(e) => setMaxWorkspaces(e.target.value)} />
                    </div>
                  </div>

                  <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                    <p className="font-semibold">How a $1,000.00 advisor invoice splits with your current settings:</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded border bg-background p-2">
                        <p className="text-[11px] text-muted-foreground">Client Pays</p>
                        <p className="text-sm font-bold">{fmtUsdCents(sampleSplit.grossCents)}</p>
                      </div>
                      <div className="rounded border bg-background p-2">
                        <p className="text-[11px] text-muted-foreground">{platformName} Keeps ({sampleSplit.platformFeePct}%)</p>
                        <p className="text-sm font-bold text-primary">{fmtUsdCents(sampleSplit.platformFeeCents)}</p>
                      </div>
                      <div className="rounded border bg-background p-2">
                        <p className="text-[11px] text-muted-foreground">Advisor Takes Home ({100 - sampleSplit.platformFeePct}%)</p>
                        <p className="text-sm font-bold text-emerald-600">{fmtUsdCents(sampleSplit.advisorNetCents)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section C: Shared Services Marketplace & AI Guardrails */}
                <div className="space-y-3 border-t pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">3. Advisor Marketplace &amp; AI Safety Rules</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between rounded-lg border p-3 text-xs">
                      <div>
                        <p className="font-medium">Auto-approve new advisors</p>
                        <p className="text-[11px] text-muted-foreground">Skip manual review when an advisor registers</p>
                      </div>
                      <Switch checked={autoApproveAdvisors} onCheckedChange={setAutoApproveAdvisors} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3 text-xs">
                      <div>
                        <p className="font-medium">Allow upfront fixed packages</p>
                        <p className="text-[11px] text-muted-foreground">Let companies buy advisor packages immediately</p>
                      </div>
                      <Switch checked={allowUpfrontPackages} onCheckedChange={setAllowUpfrontPackages} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3 text-xs">
                      <div>
                        <p className="font-medium">Require human sign-off for payments</p>
                        <p className="text-[11px] text-muted-foreground">AI helpers must ask before moving money</p>
                      </div>
                      <Switch checked={requireHumanApproval} onCheckedChange={setRequireHumanApproval} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium">Min Advisor Rate ($/hr)</label>
                        <Input type="number" min="0" value={minAdvisorRateDollars} onChange={(e) => setMinAdvisorRateDollars(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium">Daily AI Runs / Co.</label>
                        <Input type="number" min="1" max="1000" value={dailyAiCap} onChange={(e) => setDailyAiCap(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section D: Access & Announcement Banner */}
                <div className="space-y-3 border-t pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">4. Sign-Up Access &amp; Top Banner</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Who can create an account?</label>
                      <Select value={signupMode} onValueChange={(v) => setSignupMode(v as typeof signupMode)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Use server default</SelectItem>
                          <SelectItem value="open">Anyone can sign up</SelectItem>
                          <SelectItem value="invite">Invite link required</SelectItem>
                          <SelectItem value="closed">Closed to new sign-ups</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Require paid subscription?</label>
                      <Select value={billingMode} onValueChange={(v) => setBillingMode(v as typeof billingMode)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Use server default</SelectItem>
                          <SelectItem value="off">No (free for everyone)</SelectItem>
                          <SelectItem value="enforce">Yes (require active subscription)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium">Top Announcement Banner (shown across the app when filled in)</label>
                    <Input
                      value={banner}
                      onChange={(e) => setBanner(e.target.value)}
                      placeholder="e.g. Welcome to Borga! Need a bookkeeper? Check out Shared Services."
                    />
                  </div>
                </div>

                <Button onClick={() => void saveConfig()} disabled={busy === 'saveConfig'}>
                  {busy === 'saveConfig' ? 'Saving…' : 'Save All Global Settings'}
                </Button>
              </Card>

              {/* Invite Card */}
              <Card className="space-y-4 p-5 lg:col-span-4">
                <div className="flex items-center gap-2">
                  <MailPlus className="h-4 w-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold">Send a Personal Invite Link</h2>
                    <p className="text-xs text-muted-foreground">
                      Invite a founder or advisor by email when sign-ups are set to invite-only.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="h-9 text-xs"
                  />
                  <Button size="sm" onClick={() => void createInvite()} disabled={busy === 'invite' || !inviteEmail.trim()}>
                    Create Link
                  </Button>
                </div>

                {lastInviteLink && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
                    <p className="font-medium text-emerald-700">Invite link ready to share:</p>
                    <p className="mt-1 break-all font-mono text-[11px]">{lastInviteLink}</p>
                  </div>
                )}

                <div className="max-h-80 divide-y overflow-y-auto rounded-lg border text-xs">
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between px-3 py-2">
                      <div>
                        <p className="font-medium">{inv.email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant={inv.used ? 'secondary' : inv.revoked ? 'outline' : 'default'}>
                        {inv.revoked ? 'Cancelled' : inv.used ? 'Joined' : 'Waiting'}
                      </Badge>
                    </div>
                  ))}
                  {invites.length === 0 && (
                    <p className="p-4 text-center text-muted-foreground">No invite links sent yet.</p>
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* TAB 4: TURN TOOLS ON / OFF GLOBALLY */}
          <TabsContent value="features" className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Turn Tools On or Off Across the Entire Platform</h2>
              <p className="text-xs text-muted-foreground">
                Switching a tool off here hides it for every company. If you only want to turn a tool off for one specific company, use the <strong>Companies</strong> tab instead.
              </p>

              <div className="mt-4 space-y-6">
                {FEATURE_GROUPS.map((group) => {
                  const items = data.featureCatalog.filter((f) => f.group === group);
                  if (!items.length) return null;
                  return (
                    <div key={group} className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</h3>
                      <div className="divide-y rounded-lg border">
                        {items.map((f) => {
                          const envLocked = data.envLockedFeatures.includes(f.id as FeatureId);
                          const adminLocked = config.globalFeaturesOff.includes(f.id as FeatureId);
                          const isAllowedGlobally = !envLocked && !adminLocked;
                          return (
                            <div key={f.id} className="flex items-center justify-between gap-4 px-3.5 py-2.5 text-xs">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{f.label}</span>
                                  <Badge variant="outline" className="text-[10px]">{f.status}</Badge>
                                  {envLocked && (
                                    <Badge variant="secondary" className="gap-1 text-[10px]">
                                      <Lock className="h-2.5 w-2.5" /> Locked by server env
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-0.5 text-muted-foreground">{f.description}</p>
                              </div>
                              <Switch
                                checked={isAllowedGlobally}
                                disabled={envLocked || busy === `gf-${f.id}`}
                                onCheckedChange={(v) => void toggleGlobal(f.id as FeatureId, v)}
                                aria-label={`Global toggle ${f.label}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          {/* TAB 5: ADVISOR & AGENCY APPROVALS */}
          <TabsContent value="advisors" className="space-y-4">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Advisors &amp; Agencies ({advisors.length})</h2>
                  <p className="text-xs text-muted-foreground">
                    Approve accountants, CFOs, project managers, and agencies so companies can book calls and hire them.
                  </p>
                </div>
                <Link href="/services">
                  <Button size="sm" variant="outline">Open Advisor Portal</Button>
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                {advisors.map((adv) => (
                  <div key={adv.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl border p-4 text-xs">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{adv.agencyName ? `${adv.agencyName} (${adv.name})` : adv.name}</span>
                        <Badge variant={adv.status === 'approved' ? 'default' : adv.status === 'pending' ? 'secondary' : 'outline'}>
                          {adv.status === 'approved' ? 'Approved & Live' : adv.status === 'pending' ? 'Waiting for Approval' : adv.status}
                        </Badge>
                        <span className="text-muted-foreground">{adv.email}</span>
                        <span className="font-medium text-primary">{fmtUsdCents(adv.hourlyRateCents)}/hr</span>
                      </div>
                      <p className="font-medium text-foreground/90">{adv.headline}</p>
                      {adv.bio && <p className="max-w-2xl text-muted-foreground">{adv.bio}</p>}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {adv.categories.map((cat) => (
                          <Badge key={cat} variant="secondary" className="text-[10px]">
                            {SERVICE_CATEGORY_LABELS[cat]}
                          </Badge>
                        ))}
                        {adv.defaultScopes.map((sc) => (
                          <Badge key={sc} variant="outline" className="text-[10px]">
                            Needs access to: {ADVISOR_SCOPE_LABELS[sc]?.label ?? sc}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {adv.status !== 'approved' && (
                        <Button
                          size="sm"
                          className="h-8 gap-1 text-xs"
                          disabled={busy === `adv-${adv.id}`}
                          onClick={() => void vetAdvisor(adv.id, 'approved')}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </Button>
                      )}
                      {adv.status === 'approved' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 text-xs"
                          disabled={busy === `adv-${adv.id}`}
                          onClick={() => void vetAdvisor(adv.id, 'suspended')}
                        >
                          <PauseCircle className="h-3.5 w-3.5" /> Pause
                        </Button>
                      )}
                      {adv.status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1 text-xs text-rose-600"
                          disabled={busy === `adv-${adv.id}`}
                          onClick={() => void vetAdvisor(adv.id, 'rejected')}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Decline
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {advisors.length === 0 && (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No advisors have signed up yet.
                  </p>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* TAB 6: SHARED SERVICES FEE SPLIT LEDGER */}
          <TabsContent value="ledger" className="space-y-4">
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Client Jobs &amp; 85/15 Fee Split Ledger</h2>
              <p className="text-xs text-muted-foreground">
                Every advisor job across the platform, showing what the client paid, {config.platformName}&apos;s {config.platformFeePct}% platform fee, and the advisor&apos;s {100 - config.platformFeePct}% take-home pay.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="pb-2 font-medium">Service / Job</th>
                      <th className="pb-2 font-medium">Client Company</th>
                      <th className="pb-2 font-medium">Advisor / Agency</th>
                      <th className="pb-2 font-medium">Shared Tabs</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Client Paid</th>
                      <th className="pb-2 font-medium">{config.platformName} Fee ({config.platformFeePct}%)</th>
                      <th className="pb-2 text-right font-medium">Advisor Take-Home ({100 - config.platformFeePct}%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.engagements.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2.5 pr-3">
                          <p className="font-semibold">{e.title}</p>
                          <p className="text-[11px] text-muted-foreground">{SERVICE_CATEGORY_LABELS[e.category]} · {e.billingCycle === 'monthly' ? 'Monthly' : 'One-time'}</p>
                        </td>
                        <td className="py-2.5 pr-3">{e.clientCompanyName}</td>
                        <td className="py-2.5 pr-3">{e.advisorName}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {e.grantedScopes.map((s) => (
                              <Badge key={s} variant="outline" className="text-[10px]">{ADVISOR_SCOPE_LABELS[s]?.label ?? s}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge variant={e.status === 'active' ? 'default' : 'secondary'}>{e.status}</Badge>
                        </td>
                        <td className="py-2.5 pr-3 font-medium">{fmtUsdCents(e.paidTotalCents)}</td>
                        <td className="py-2.5 pr-3 font-semibold text-primary">{fmtUsdCents(e.platformFeeTotalCents)}</td>
                        <td className="py-2.5 text-right font-semibold text-emerald-600">{fmtUsdCents(e.advisorNetTotalCents)}</td>
                      </tr>
                    ))}
                    {data.engagements.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-muted-foreground">
                          No advisor jobs recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Per-Company Tool Toggles Modal */}
      <Dialog open={!!inspectCompany} onOpenChange={(o) => !o && setInspectCompany(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tools for {inspectCompany?.name}</DialogTitle>
            <DialogDescription>
              Switch modules on or off specifically for {inspectCompany?.name} ({inspectCompany?.ownerEmail}).
            </DialogDescription>
          </DialogHeader>
          {inspectCompany && (
            <div className="divide-y rounded-lg border">
              {data.featureCatalog.map((f) => {
                const lockedGlobally =
                  data.envLockedFeatures.includes(f.id as FeatureId) ||
                  config.globalFeaturesOff.includes(f.id as FeatureId);
                const on = !!inspectCompany.features[f.id as FeatureId];
                return (
                  <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <div>
                      <span className="font-medium">{f.label}</span>
                      <span className="ml-2 text-[10px] text-muted-foreground">({f.group})</span>
                      {lockedGlobally && <span className="ml-2 text-[10px] text-amber-600">Off platform-wide</span>}
                    </div>
                    <Switch
                      checked={on}
                      disabled={lockedGlobally || busy === `wf-${inspectCompany.wsId}-${f.id}`}
                      onCheckedChange={(v) => void toggleCompanyFeature(inspectCompany, f.id as FeatureId, v)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
