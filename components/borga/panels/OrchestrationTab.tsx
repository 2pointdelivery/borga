'use client';

import { useEffect, useState } from 'react';
import {
  Radio,
  RefreshCw,
  Users,
  Truck,
  MapPin,
  Wallet,
  UserPlus,
  Boxes,
  Activity,
  Clock,
  ShieldCheck,
  Webhook as WebhookIcon,
  Plus,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { EngineCrmCard } from './EngineCrmCard';
import { InboundEndpoint } from '../InboundEndpoint';
import { cn } from '@/lib/utils';
import { BOOKING_STATUS_ORDER, BOOKING_STATUS_STYLE, WEBHOOK_EVENTS, type BookingStatus, type Driver, type Webhook } from '@/lib/borga/data';

type EngineInfo = { engine: string; mode: string; ok: boolean; fleet?: number };

const SLA_TICK: Record<string, string> = {
  'On-time delivery': 'text-emerald-500',
  'Avg pickup delay': 'text-amber-500',
  'Booking confirm time': 'text-sky-500',
  'Tracking coverage': 'text-violet-500',
};

const DRIVER_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  onboarding: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  pending: 'bg-muted text-muted-foreground ring-border',
};

const PIE_COLORS = ['#f59e0b', '#0ea5e9', '#8b5cf6', '#10b981', '#f43f5e'];

export function OrchestrationTab() {
  const {
    ops, setBookingStatus, addDriver, log, workflows, runWorkflow, setWorkflow, addWorkflow, deleteWorkflow,
    webhooks, addWebhook, toggleWebhook, deleteWebhook,
    activeWorkspace, activeWorkspaceId, userName,
  } = useBorga();
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [logMsg, setLogMsg] = useState<string[]>([]);
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverForm, setDriverForm] = useState({ name: '', vehicle: '', licence: '' });
  const [whOpen, setWhOpen] = useState(false);
  const [whForm, setWhForm] = useState({ name: '', event: 'booking.created' as string, url: '', secret: '' });
  const [wfOpen, setWfOpen] = useState(false);
  const [wfForm, setWfForm] = useState({ name: '', engine: 'local' });
  const company = activeWorkspace();

  const probeEngine = () => {
    setChecking(true);
    fetch(`/api/borga/orchestrate?ws=${encodeURIComponent(activeWorkspaceId)}`)
      .then((r) => r.json())
      .then((d) => setEngine(d))
      .catch(() => setEngine({ engine: '', mode: 'unreachable', ok: false }))
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    probeEngine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  const addNewWorkflow = () => {
    if (!wfForm.name.trim()) return;
    addWorkflow({
      id: `wf-${Date.now().toString(36)}`,
      name: wfForm.name.trim(),
      status: 'idle',
      progress: 0,
      startedBy: userName,
      engine: company?.name ?? 'local',
    });
    log({
      agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task',
      message: `Workflow "${wfForm.name.trim()}" created for ${company?.name ?? 'workspace'}.`,
    });
    setWfForm({ name: '', engine: 'local' });
    setWfOpen(false);
  };

  const saveWebhook = () => {
    if (!whForm.name.trim() || !whForm.url.trim()) return;
    // Validate the URL: must be HTTPS and not an internal/private address.
    try {
      const parsed = new URL(whForm.url.trim());
      if (parsed.protocol !== 'https:') {
        setLogMsg((p) => ['[error] Webhook URL must use HTTPS.', ...p].slice(0, 8));
        return;
      }
      const host = parsed.hostname.toLowerCase();
      const isInternal =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('192.168.') ||
        host.startsWith('10.') ||
        host.startsWith('172.') ||
        host.endsWith('.local') ||
        host === '0.0.0.0' ||
        host === '::1';
      if (isInternal) {
        setLogMsg((p) => ['[error] Webhook URL must not target internal addresses.', ...p].slice(0, 8));
        return;
      }
    } catch {
      setLogMsg((p) => ['[error] Invalid webhook URL.', ...p].slice(0, 8));
      return;
    }
    const w: Webhook = {
      id: `wh-${Date.now()}`,
      name: whForm.name.trim(),
      event: whForm.event,
      url: whForm.url.trim(),
      secret: whForm.secret.trim() ? '———————…' : '…',
      active: true,
      lastDelivery: '…',
      deliveries: 0,
    };
    addWebhook(w);
    log({ agentId: 'a-integrations', agentName: 'Iris', actor: 'user', kind: 'sync', message: `Webhook configured: ${w.name} → ${w.event}.` });
    setWhForm({ name: '', event: 'booking.created', url: '', secret: '' });
    setWhOpen(false);
    
    // Test the webhook by dispatching a test event
    fetch('/api/borga/webhooks/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({
        ws: activeWorkspaceId,
        action: 'dispatch',
        webhookId: w.id,
        eventId: 'webhook.test',
        payload: {
          test: true,
          timestamp: new Date().toISOString(),
          message: 'Test webhook delivery',
        },
      }),
    }).catch(() => null);
  };

  useEffect(() => {
    fetch('/api/borga/orchestrate')
      .then((r) => r.json())
      .then((d) => setEngine(d))
      .catch(() => setEngine({ engine: '', mode: 'unreachable', ok: false }))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    fetch('/api/borga/config')
      .then((r) => r.json())
      .then((d: { keys: { envVar: string; source: string; masked: string | null }[] }) => {
        const entry = d.keys.find((k) => k.envVar === 'COMPANY_ENGINE_API_KEY');
        if (entry && entry.source === 'env') {
          setLogMsg((p) => ['[engine] Global COMPANY_ENGINE_API_KEY present in .env (fallback for workspaces without their own key).', ...p].slice(0, 8));
        }
      })
      .catch(() => null);
  }, []);

  const activeBookings = ops.bookings.filter((b) => b.status !== 'delivered' && b.status !== 'cancelled');
  const newDrivers = ops.drivers.filter((d) => d.status !== 'active').length;
  const onTimeSla = ops.sla.find((s) => s.label === 'On-time delivery')?.value ?? 96;
  const onTimeTarget = ops.sla.find((s) => s.label === 'On-time delivery')?.target ?? 98;
  const revenue = ops.analytics.revenue;
  const pieData = (Object.entries(ops.analytics.byStatus) as [BookingStatus, number][]).map(([name, value]) => ({ name, value }));

  const changeStatus = (id: string, status: BookingStatus) => {
    setBookingStatus(id, status);
    const b = ops.bookings.find((x) => x.id === id);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'sync', message: `Booking ${b?.ref ?? id} → ${status}.` });
    
    // Dispatch webhook for booking status change
    webhooks.filter(w => w.active && w.event === 'booking.updated').forEach(w => {
      fetch('/api/borga/webhooks/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          ws: activeWorkspaceId,
          action: 'dispatch',
          webhookId: w.id,
          eventId: `booking.updated.${id}`,
          payload: {
            bookingId: id,
            ref: b?.ref,
            status,
            timestamp: new Date().toISOString(),
          },
        }),
      }).catch(() => null);
    });
  };

  const onboardDriver = () => {
    if (!driverForm.name.trim()) return;
    const d: Driver = {
      id: `d-${Date.now()}`,
      name: driverForm.name.trim(),
      status: 'pending',
      vehicle: driverForm.vehicle.trim() || '…',
      licence: driverForm.licence.trim() || 'CDL-A pending',
      joined: 'Screening',
    };
    addDriver(d);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'sync', message: `New driver candidate onboarded: ${d.name}.` });
    setDriverForm({ name: '', vehicle: '', licence: '' });
    setDriverOpen(false);
  };

  const kpis = [
    { label: 'Active bookings', value: String(activeBookings.length), icon: Truck, color: 'text-sky-600' },
    { label: 'Active clients', value: String(ops.clients.filter((c) => c.active).length), icon: Users, color: 'text-violet-600' },
    { label: 'On-time SLA', value: `${onTimeSla}%`, sub: `target ${onTimeTarget}%`, icon: ShieldCheck, color: 'text-emerald-600' },
    { label: 'New drivers', value: String(newDrivers), icon: UserPlus, color: 'text-amber-600' },
    { label: 'Revenue', value: `$${Math.round(revenue / 1000)}K`, icon: Wallet, color: 'text-primary' },
    { label: 'Tracking events', value: String(ops.tracking.length), icon: Activity, color: 'text-rose-600' },
  ];

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Company Engine"
          sub="This company's API portal: connect your CRM, pull customers and deals, run workflows and webhooks. Isolated per company."
        />
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', engine?.ok === false ? 'bg-rose-500' : 'animate-pulse bg-emerald-500')} />
            {checking ? 'Probing…' : engine?.mode === 'unconfigured' ? 'Not configured' : engine?.ok === false ? 'Local fallback' : 'Engine online'}
          </Badge>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={probeEngine}>
            <RefreshCw className="h-3.5 w-3.5" /> Re-probe
          </Button>
        </div>
      </div>

      {/* Engine strip — company specific */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${company?.color ?? '#6366f1'}, ${company?.color ?? '#6366f1'}99)` }}
            >
              {company?.name.slice(0, 2).toUpperCase() ?? 'EN'}
            </span>
            <div>
              <p className="font-semibold">{company?.name ?? 'Company'} engine</p>
              <p className="font-mono text-xs text-muted-foreground">
                {engine?.engine || 'no connection saved yet — set it up below'}
                {engine?.mode === 'local-fallback' && ' — local fallback'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-center"><p className="text-lg font-semibold text-primary">{ops.analytics.activeFleet}</p><p className="text-[11px] text-muted-foreground">Fleet vehicles</p></div>
            <div className="text-center"><p className="text-lg font-semibold text-sky-600">{activeBookings.length}</p><p className="text-[11px] text-muted-foreground">In pipeline</p></div>
            <div className="text-center"><p className="text-lg font-semibold text-emerald-600">{ops.analytics.byStatus.delivered}</p><p className="text-[11px] text-muted-foreground">Delivered</p></div>
          </div>
        </div>

      </Card>

      <EngineCrmCard onConnectionChange={probeEngine} />

      {/* Webhooks & API configuration */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <WebhookIcon className="h-4 w-4 text-primary" />
            <SectionTitle title="Webhooks & API configuration" sub="Send engine events to your endpoints over HTTPS" />
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setWhOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add webhook
          </Button>
        </div>
        <div className="mt-3"><InboundEndpoint /></div>
        <div className="mt-3 space-y-2">
          {webhooks.length === 0 && <p className="text-sm text-muted-foreground">No webhooks configured yet. Add one to start receiving events.</p>}
          {webhooks.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/20 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{w.name}</p>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30">{w.event}</span>
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{w.url}</p>
                <p className="text-[10px] text-muted-foreground">{w.deliveries.toLocaleString()} deliveries — last {w.lastDelivery} — secret {w.secret}</p>
              </div>
              <Switch checked={w.active} onCheckedChange={() => toggleWebhook(w.id)} />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteWebhook(w.id)} title="Delete webhook">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">Operations dashboard <span className="font-normal text-muted-foreground">— sample logistics data for illustration; it is not pulled from your CRM</span></summary>
        <div className="mt-4 space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <div className="flex items-center gap-2">
              <k.icon className={cn('h-4 w-4', k.color)} />
              <p className="text-xs text-muted-foreground">{k.label}</p>
            </div>
            <p className="mt-2 text-2xl font-semibold">{k.value}</p>
            {k.sub && <p className="text-[11px] text-muted-foreground">{k.sub}</p>}
          </Card>
        ))}
      </div>

      {/* Analytics */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-primary" /> Booking analytics
          </div>
          <ResponsiveContainer width="100%" height={240} className="mt-3">
            <BarChart data={ops.analytics.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" fontSize={12} stroke="var(--muted-foreground)" />
              <YAxis fontSize={12} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              <Bar dataKey="bookings" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="revenue" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" /> Bookings by status
          </div>
          <div className="mt-2 flex items-center justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1.5 text-[11px]">
            {pieData.map((p, i) => (
              <span key={p.name} className="flex items-center gap-1.5 capitalize">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {p.name}: {p.value}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* SLA + Clients */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" /> Service level (SLA)
          </div>
          <div className="mt-4 space-y-4">
            {ops.sla.map((s) => (
              <div key={s.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full', SLA_TICK[s.label])} />
                    {s.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.value}{s.unit} / target {s.target}{s.unit}
                  </span>
                </div>
                <Progress value={Math.min(100, (s.value / s.target) * 100)} className="h-2" />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary" /> Clients
            </div>
            <span className="text-xs text-muted-foreground">{ops.clients.length} accounts</span>
          </div>
          <div className="mt-3 space-y-2">
            {ops.clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.city} — {c.segment} — {c.contact}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{c.bookingCount} bookings</span>
                  <span className={cn('h-2 w-2 rounded-full', c.active ? 'bg-emerald-500' : 'bg-muted-foreground/40')} title={c.active ? 'Active' : 'Paused'} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bookings + Tracking */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Truck className="h-4 w-4 text-primary" /> Bookings &amp; status
            </div>
            <span className="text-xs text-muted-foreground">Change status to advance a booking</span>
          </div>
          <div className="mt-3 space-y-2.5">
            {ops.bookings.map((b) => (
              <div key={b.id} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{b.ref}</span>
                    <p className="text-sm font-medium">{b.client}</p>
                  </div>
                  <select
                    value={b.status}
                    onChange={(e) => changeStatus(b.id, e.target.value as BookingStatus)}
                    className={cn('h-7 rounded-md px-1.5 text-xs font-medium ring-1 outline-none', BOOKING_STATUS_STYLE[b.status])}
                  >
                    {BOOKING_STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{b.origin} → {b.dest}</span>
                  <span>{b.date}</span>
                  <span>${b.value.toLocaleString()}</span>
                  <span>{b.vehicle}</span>
                  <span>driver: {b.driver ?? '…'}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Radio className="h-4 w-4 text-primary" /> Live tracking
          </div>
          <div className="mt-3 space-y-3">
            {ops.tracking.map((t) => (
              <div key={t.id} className="relative pl-4">
                <span className={cn('absolute left-0 top-1.5 h-2 w-2 rounded-full', t.state === 'delivered' ? 'bg-emerald-500' : 'animate-pulse bg-sky-500')} />
                <p className="text-sm font-medium">{t.ref} — {t.location}</p>
                <p className="text-[11px] text-muted-foreground">{t.time} — {t.note}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

        </div>
      </details>

      {/* New drivers + workflows */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UserPlus className="h-4 w-4 text-primary" /> Drivers &amp; new hires
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setDriverOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Onboard driver
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {ops.drivers.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{d.name}</p>
                  <p className="text-[11px] text-muted-foreground">{d.vehicle} — {d.licence} — joined {d.joined}</p>
                </div>
                <Badge className={cn('capitalize', DRIVER_STYLE[d.status])}>{d.status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Boxes className="h-4 w-4 text-primary" /> Workflows — {company?.name ?? 'company'}
            </div>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setWfOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </div>
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {workflows.map((w) => (
              <div key={w.id} className="rounded-lg border bg-muted/20 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">{w.name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {w.status !== 'running' ? (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => { runWorkflow(w.id); log({ agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'sync', message: `Workflow started on ${company?.name ?? 'company'} engine: ${w.name}.` }); }}>
                        Run
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setWorkflow(w.id, { status: 'idle', progress: 0 })}>Stop</Button>
                    )}
                    <button
                      onClick={() => { deleteWorkflow(w.id); log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Workflow "${w.name}" deleted from ${company?.name ?? 'company'}.` }); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Delete workflow"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <Progress value={w.progress} className="mt-1.5 h-1.5" />
              </div>
            ))}
            {workflows.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No workflows for this company yet.</p>
            )}
          </div>
          <div className="mt-3 rounded-lg bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {logMsg.length ? logMsg.join('\n') : 'Engine log idle.'}
          </div>
        </Card>
      </div>

      {/* Onboard driver dialog */}
      <Dialog open={driverOpen} onOpenChange={setDriverOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Onboard a new driver</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Full name</label>
              <Input value={driverForm.name} onChange={(e) => setDriverForm((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Ade Bello" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Vehicle</label>
                <Input value={driverForm.vehicle} onChange={(e) => setDriverForm((s) => ({ ...s, vehicle: e.target.value }))} placeholder="TLX-000" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Licence</label>
                <Input value={driverForm.licence} onChange={(e) => setDriverForm((s) => ({ ...s, licence: e.target.value }))} placeholder="CDL-A" className="mt-1" />
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={onboardDriver}>
              <UserPlus className="h-4 w-4" /> Add to onboarding
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New workflow dialog */}
      <Dialog open={wfOpen} onOpenChange={setWfOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New workflow — {company?.name ?? 'company'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Workflow name</label>
              <Input value={wfForm.name} onChange={(e) => setWfForm((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Morning dispatch brief" className="mt-1" onKeyDown={(e) => e.key === 'Enter' && addNewWorkflow()} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved to this company only. Running it dispatches to the engine endpoint above (local fallback when unreachable).
            </p>
            <Button className="w-full gap-1.5" onClick={addNewWorkflow}>
              <Plus className="h-4 w-4" /> Create workflow
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add webhook dialog */}
      <Dialog open={whOpen} onOpenChange={setWhOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configure a webhook</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={whForm.name} onChange={(e) => setWhForm((s) => ({ ...s, name: e.target.value }))} placeholder="e.g. Ops → CRM" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Event</label>
              <select value={whForm.event} onChange={(e) => setWhForm((s) => ({ ...s, event: e.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {WEBHOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Endpoint URL</label>
              <Input value={whForm.url} onChange={(e) => setWhForm((s) => ({ ...s, url: e.target.value }))} placeholder="https://your-app.com/hooks/booking" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Signing secret (optional)</label>
              <Input value={whForm.secret} onChange={(e) => setWhForm((s) => ({ ...s, secret: e.target.value }))} placeholder="Shared secret for HMAC verification" className="mt-1" />
            </div>
            <Button className="w-full gap-1.5" onClick={saveWebhook}>
              <Plus className="h-4 w-4" /> Save webhook
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
