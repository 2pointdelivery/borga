'use client';

import { useState } from 'react';
import { Save, Bell, Palette, User, Link2, Mic, Server, Globe, ShieldCheck, Phone, Download, BrainCircuit } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { useTheme } from '../theme-provider';
import type { ThemeMode } from '@/lib/borga/store';
import { ELEVENLABS_VOICES, AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { ModelCatalogEditor } from './ModelCatalogEditor';
import { ValuationConfigEditor } from './ValuationConfigEditor';
import { cn } from '@/lib/utils';

const THEMES: { id: ThemeMode; label: string; swatch: string[] }[] = [
  { id: 'system', label: 'System', swatch: ['#0b0b0f', '#fafafa'] },
  { id: 'light', label: 'Light', swatch: ['#ffffff', '#e5e5e5'] },
  { id: 'dark', label: 'Dark', swatch: ['#0b0b0f', '#18181b'] },
  { id: 'midnight', label: 'Midnight', swatch: ['#0e1024', '#3b4bd6'] },
  { id: 'sunset', label: 'Sunset', swatch: ['#24100f', '#f97316'] },
  { id: 'forest', label: 'Forest', swatch: ['#0c1a12', '#16a34a'] },
];


export function SettingsTab() {
  const { userName, setUserName, log, elevenlabs, setElevenlabs, calls, settings, setSettings, dbAvailable } = useBorga();
  const { mode, setMode } = useTheme();
  const [name, setName] = useState(userName);

  const setNotif = (key: keyof typeof settings.notifications, v: boolean) => {
    setSettings({ notifications: { ...settings.notifications, [key]: v } });
  };

  const save = () => {
    setUserName(name.trim() || 'Lawrence');
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'system', message: `Preferences saved. Welcome back, ${name.trim() || 'Lawrence'}.` });
  };

  return (
    <div className="borga-fade-up space-y-5">
      <SectionTitle title="Settings" sub="Personalise Borga and your command center" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <User className="h-4 w-4 text-primary" /> Identity
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Borga greets you by this name whenever the dashboard is awakened.</p>
          <div className="mt-3 flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="flex-1" />
            <Button onClick={save} className="shrink-0 gap-1.5">
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Palette className="h-4 w-4 text-primary" /> System theme
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Pick a palette. Borga applies it instantly across every tab.</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setMode(t.id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl border p-3 text-sm transition-colors',
                  mode === t.id ? 'border-primary ring-2 ring-ring' : 'hover:border-muted-foreground/40',
                )}
              >
                <span className="flex h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
                  <span className="w-1/2" style={{ background: t.swatch[0] }} />
                  <span className="w-1/2" style={{ background: t.swatch[1] }} />
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-primary" /> Notifications
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Choose what Borga alerts you about.</p>
          <div className="mt-3 divide-y">
            {(
              [
                ['tasks', 'Task updates', 'When tasks are created, moved or completed'],
                ['handoffs', 'Agent handoffs', 'When agents delegate work between departments'],
                ['sync', 'CRM sync events', 'When data synchronises across platforms'],
                ['voice', 'Voice replies', 'When Borga speaks or needs confirmation'],
                ['kpi', 'KPI milestones', 'When a department hits a target'],
              ] as const
            ).map(([key, label, desc]) => (
              <div key={key} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={settings.notifications[key as keyof typeof settings.notifications]}
                  onCheckedChange={(v) => setNotif(key, v)}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <BrainCircuit className="h-4 w-4 text-primary" /> Autonomous mode
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Let agents act on the company&apos;s behalf. Outbound vendor payments of {AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD.toLocaleString()}+ and every outbound email to a customer or vendor are held in Approvals for your sign-off instead of executing immediately.
              </p>
            </div>
            <Switch checked={!!settings.autonomousMode} onCheckedChange={(v) => setSettings({ autonomousMode: v })} />
          </div>
          {settings.autonomousMode && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600">
              Autonomous mode is on — check Overview → Approvals regularly, held payments and sends don&apos;t go out on their own.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Mic className="h-4 w-4 text-primary" /> Voice assistant
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {elevenlabs.connected
              ? 'Speaks with your configured ElevenLabs voice; falls back to the browser voice below if ElevenLabs is unreachable.'
              : 'Speaks with the browser’s built-in voice — connect ElevenLabs (below) for a higher-quality agent voice.'}
          </p>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">Active voice profile</span>
              <code className="text-xs font-mono">
                {elevenlabs.connected
                  ? `${ELEVENLABS_VOICES.find((v) => v.id === elevenlabs.voice)?.label ?? elevenlabs.voice} — ${ELEVENLABS_VOICES.find((v) => v.id === elevenlabs.voice)?.tag ?? 'ElevenLabs'}`
                  : 'Browser voice — rate 1.02 — pitch 0.72'}
              </code>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Always listening</p>
                <p className="text-xs text-muted-foreground">Mic stays on app-wide; Borga only acts once you say &quot;Borga&quot; first</p>
              </div>
              <Switch checked={settings.notifications.voice} onCheckedChange={(v) => setNotif('voice', v)} />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-primary" /> Connections
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Configure how Borga reaches your stack. Saved automatically as you type — secrets stay server-side.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Company CRM base URL</label>
              <Input value={settings.crmUrl} onChange={(e) => setSettings({ crmUrl: e.target.value })} className="mt-1 font-mono text-xs" placeholder="https://crm.yourcompany.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">LLM provider</label>
              <Input value={settings.llmProvider} onChange={(e) => setSettings({ llmProvider: e.target.value })} className="mt-1 text-xs" placeholder="e.g. Groq / Claude / OpenAI" />
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
              <Phone className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">ElevenLabs — voice &amp; outbound calls</span>
            </div>
            <Switch
              checked={elevenlabs.connected}
              onCheckedChange={(v) => setElevenlabs({ connected: v, lastSync: v ? 'Just now' : '…' })}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Agents place outbound calls with ElevenLabs voices. Save your ElevenLabs API key in the <strong>Tools &amp; Integrations</strong> tab → Voice agents — keys are encrypted server-side.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Agent voice</label>
              <select
                value={elevenlabs.voice}
                onChange={(e) => setElevenlabs({ voice: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ELEVENLABS_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label} — {v.tag}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Outbound caller ID</label>
              <Input
                value={elevenlabs.outboundNumber}
                onChange={(e) => setElevenlabs({ outboundNumber: e.target.value })}
                placeholder="+1 555 0100"
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>
          <label className="mt-3 flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-xs">
            <span>Agents may auto-call a lead when it&apos;s approved</span>
            <Switch checked={elevenlabs.autoCallOnApprove} onCheckedChange={(v) => setElevenlabs({ autoCallOnApprove: v })} />
          </label>
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground">Recent calls</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {calls.slice(0, 4).map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium">{c.agentName} → {c.leadName} <span className="text-muted-foreground">({c.contact})</span></p>
                    <p className="truncate text-muted-foreground">{c.note}</p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 text-[10px]', c.status === 'completed' && 'bg-emerald-500/10 text-emerald-600')}>
                    {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Server className="h-4 w-4 text-primary" /> System status
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Live signals only — nothing here is a placeholder metric.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Deploy target</span>
                <Badge variant="outline" className="text-[10px]">Configured</Badge>
              </div>
              <p className="mt-1 text-sm font-semibold">Cloudflare Workers</p>
              <p className="text-[11px] text-muted-foreground">Edge-runtime isolates, per wrangler.toml — auto-scaled when deployed</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Database</span>
                <Badge className={cn('gap-1', dbAvailable ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', dbAvailable ? 'bg-emerald-500' : 'bg-amber-500')} /> {dbAvailable ? 'Connected' : 'Local mode'}
                </Badge>
              </div>
              <p className="mt-1 text-sm font-semibold">Borga state store</p>
              <p className="text-[11px] text-muted-foreground">{dbAvailable ? 'Changes are syncing to the cloud database.' : 'Cloud database unreachable — changes stay local until it reconnects.'}</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Security</span>
                <span className="text-[10px]">Enabled</span>
              </div>
              <p className="mt-1 text-sm font-semibold">HSTS — TLS 1.3</p>
              <p className="text-[11px] text-muted-foreground">Secrets server-side only — AES-256-GCM encrypted</p>
            </div>
            <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Data stored</span>
                <Badge variant="outline" className="text-[10px]">Per workspace</Badge>
              </div>
              <p className="mt-1 text-sm font-semibold">Every module</p>
              <p className="text-[11px] text-muted-foreground">Goals — approvals — comms — webhooks — KPIs — LLM — secrets</p>
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Download className="h-4 w-4 text-primary" /> Product files
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Download the full Borga product source as a zip (source, components, panels, API routes). Build artifacts and secrets are excluded.
          </p>
          <a href="/borga-product.zip" download className="mt-3 inline-block">
            <Button className="gap-2">
              <Download className="h-4 w-4" /> Download product.zip
            </Button>
          </a>
        </Card>
      </div>

      <Card className="p-5">
        <ModelCatalogEditor />
      </Card>

      <Card className="p-5">
        <ValuationConfigEditor />
      </Card>
    </div>
  );
}
