'use client';

import { useState } from 'react';
import { Save, Bell, Palette, User, Mic, Server, Globe, ShieldCheck, Phone, BrainCircuit, Cookie } from 'lucide-react';
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
import { SearchSelect } from '../SearchSelect';
import { ValuationConfigEditor } from './ValuationConfigEditor';
import { FeaturesCard } from './FeaturesCard';
import { EmailUpdatesCard } from './EmailUpdatesCard';
import { InvitesCard } from './InvitesCard';
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
  const { userName, setUserName, log, elevenlabs, setElevenlabs, settings, setSettings, dbAvailable } = useBorga();
  const { mode, setMode } = useTheme();
  const [name, setName] = useState(userName);

  const setNotif = (key: keyof typeof settings.notifications, v: boolean) => {
    setSettings({ notifications: { ...settings.notifications, [key]: v } });
  };

  const save = () => {
    const next = name.trim();
    if (!next) return; // an empty name never resets the identity
    setUserName(next);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Preferences saved. Welcome back, ${next}.` });
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
                  : 'Browser voice — rate 0.98 — pitch 0.85'}
              </code>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Always listening</p>
                <p className="text-xs text-muted-foreground">Mic stays on app-wide; Borga only acts once you say &ldquo;Borga&rdquo; first. Separate from voice replies in notifications.</p>
              </div>
              <Switch
                checked={settings.alwaysListening ?? settings.notifications.voice}
                onCheckedChange={(v) => setSettings({ ...settings, alwaysListening: v })}
              />
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Phone className="h-4 w-4 shrink-0 text-primary" /> Agent voice
            <Badge variant={elevenlabs.connected ? 'secondary' : 'outline'} className="text-[10px]">{elevenlabs.connected ? 'ElevenLabs key saved' : 'Browser voice'}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The voice agents speak with. The ElevenLabs API key lives in <strong>Integrations → AI &amp; Voice</strong>; without it the browser&apos;s built-in voice is used. Phone calls are configured under Integrations → Connections (Twilio).
          </p>
          <div className="mt-3 max-w-sm">
            <label className="text-xs font-medium text-muted-foreground">Agent voice</label>
            <SearchSelect
              options={ELEVENLABS_VOICES.map((v) => ({ value: v.id, label: v.label, detail: v.tag }))}
              value={elevenlabs.voice}
              onChange={(v) => { if (v) setElevenlabs({ voice: v }); }}
              placeholder="Select a voice"
              searchPlaceholder="Search voices"
              clearable={false}
              className="mt-1"
            />
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
                <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> Served from</span>
              </div>
              <p className="mt-1 break-all text-sm font-semibold">{typeof window !== 'undefined' ? window.location.host : ''}</p>
              <p className="text-[11px] text-muted-foreground">Node server (see docs/HOSTING.md)</p>
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
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Secrets</span>
              </div>
              <p className="mt-1 text-sm font-semibold">Encrypted at rest</p>
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
      </div>

      <EmailUpdatesCard />
      <InvitesCard />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Cookie className="h-4 w-4 text-primary" /> Cookie settings
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Review, change or withdraw your cookie choice at any time — the banner opens with your saved preferences pre-selected. The choice is stored as a signed cookie and recorded server-side.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => window.dispatchEvent(new CustomEvent('borga:consent-reopen'))}
          >
            <Cookie className="h-3.5 w-3.5" /> Manage cookies
          </Button>
        </div>
      </Card>

      <FeaturesCard />

      <Card className="p-5">
        <ValuationConfigEditor />
      </Card>
    </div>
  );
}
