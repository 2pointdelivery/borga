'use client';

import { useMemo, useState } from 'react';
import { Lock, Search, ToggleRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FEATURES, FEATURE_GROUPS, type FeatureDef, type FeatureGroup, type FeatureId, type FeatureStatus } from '@/lib/borga/features';
import { useFeatures } from '@/lib/borga/features-client';
import { toast } from '@/lib/toast-bus';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<FeatureStatus, string> = {
  stable: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  beta: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  experimental: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  simulated: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

/** Workspace feature switches, grouped, as a grid of cards so the list stays short. */
export function FeaturesCard() {
  const flags = useFeatures((s) => s.flags);
  const locked = useFeatures((s) => s.locked);
  const toggle = useFeatures((s) => s.toggle);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<FeatureGroup | 'All'>('All');

  const onToggle = async (id: FeatureId, enabled: boolean) => {
    const err = await toggle(id, enabled);
    if (err) toast({ title: 'Could not change feature', description: err, variant: 'error' });
  };

  const list = FEATURES as readonly FeatureDef[];
  const q = query.trim().toLowerCase();
  const items = useMemo(
    () => FEATURE_GROUPS.flatMap((g) => list.filter((f) => f.group === g)).filter((f) => (group === 'All' || f.group === group) && (!q || `${f.label} ${f.description} ${f.status} ${f.group}`.toLowerCase().includes(q))),
    [list, q, group],
  );
  const on = list.filter((f) => flags[f.id as FeatureId]).length;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ToggleRight className="h-4 w-4 text-primary" /> Features
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{on} of {list.length} on</span>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search features" className="h-9 pl-8 text-xs" aria-label="Search features" />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Switch off anything that is not running well. A disabled feature disappears from navigation and its API answers 404; your data is kept.
        Operators can also force features off for the whole deployment with <code>BORGA_FEATURES_OFF=voice,calls</code>.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(['All', ...FEATURE_GROUPS] as const).map((g) => (
          <button
            key={g} type="button" onClick={() => setGroup(g)}
            className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors', group === g ? 'bg-primary text-primary-foreground ring-primary' : 'text-muted-foreground ring-border hover:bg-muted')}
          >
            {g}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="mt-6 text-center text-sm text-muted-foreground">No feature matches.</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((f) => {
          const id = f.id as FeatureId;
          const isLocked = locked.includes(id);
          const isOn = flags[id];
          return (
            <div key={f.id} className={cn('flex flex-col justify-between gap-3 rounded-lg border p-3 transition-colors', isOn ? 'bg-card' : 'bg-muted/30')}>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug">{f.label}</p>
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {isLocked && <span title="Disabled by the deployment (BORGA_FEATURES_OFF)"><Lock className="h-3.5 w-3.5 text-muted-foreground" /></span>}
                    <Switch checked={isOn} disabled={isLocked} onCheckedChange={(v) => void onToggle(id, v)} aria-label={`Toggle ${f.label}`} />
                  </div>
                </div>
                <p className="mt-1 line-clamp-3 text-xs text-muted-foreground" title={f.description}>{f.description}</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={cn('w-fit rounded-full px-2 py-0 text-[10px] font-medium capitalize ring-1', STATUS_STYLE[f.status])}>{f.status}</span>
                <span className="text-[10px] text-muted-foreground">{f.group}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
