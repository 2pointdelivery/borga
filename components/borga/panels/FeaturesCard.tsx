'use client';

import { ToggleRight, Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { FEATURES, type FeatureStatus } from '@/lib/borga/features';
import { useFeatures } from '@/lib/borga/features-client';
import { toast } from '@/lib/toast-bus';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<FeatureStatus, string> = {
  stable: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  beta: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  experimental: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  simulated: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

/** Workspace feature switches: turn off anything that is not running well until it is finished. */
export function FeaturesCard() {
  const flags = useFeatures((s) => s.flags);
  const locked = useFeatures((s) => s.locked);
  const toggle = useFeatures((s) => s.toggle);

  const onToggle = async (id: (typeof FEATURES)[number]['id'], enabled: boolean) => {
    const err = await toggle(id, enabled);
    if (err) toast({ title: 'Could not change feature', description: err, variant: 'error' });
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ToggleRight className="h-4 w-4 text-primary" /> Features
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Switch off anything that is not running well. A disabled feature disappears from navigation and its API answers 404; your data is kept.
        Operators can also force features off for the whole deployment with <code>BORGA_FEATURES_OFF=voice,calls</code>.
      </p>
      <div className="mt-3 divide-y">
        {FEATURES.map((f) => {
          const isLocked = locked.includes(f.id);
          return (
            <div key={f.id} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {f.label}
                  <span className={cn('rounded-full px-2 py-0 text-[10px] font-medium capitalize ring-1', STATUS_STYLE[f.status])}>{f.status}</span>
                </p>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isLocked && <span title="Disabled by the deployment (BORGA_FEATURES_OFF)"><Lock className="h-3.5 w-3.5 text-muted-foreground" /></span>}
                <Switch checked={flags[f.id]} disabled={isLocked} onCheckedChange={(v) => onToggle(f.id, v)} aria-label={`Toggle ${f.label}`} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
