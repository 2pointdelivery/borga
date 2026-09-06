'use client';

import { useState } from 'react';
import { Radio, Bot, GitBranch, BrainCircuit, RefreshCw, Mic } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import type { ActivityEvent } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<ActivityEvent['kind'], typeof Radio> = {
  task: Bot,
  handoff: GitBranch,
  learn: BrainCircuit,
  sync: RefreshCw,
  voice: Mic,
  system: Radio,
};

const FILTERS: (ActivityEvent['kind'] | 'all')[] = ['all', 'task', 'handoff', 'learn', 'sync', 'voice'];

export function ActivityTab() {
  const { activity, agents } = useBorga();
  const [filter, setFilter] = useState<ActivityEvent['kind'] | 'all'>('all');

  const shown = activity.filter((e) => (filter === 'all' ? true : e.kind === filter));

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Real-time activity" sub="A live timeline of everything the fleet is doing" />
        <div className="flex items-center gap-1.5 text-xs text-emerald-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const Icon = f === 'all' ? Radio : KIND_ICON[f as ActivityEvent['kind']];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs capitalize transition-colors',
                filter === f ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary hover:text-primary',
              )}
            >
              <Icon className="h-3 w-3" /> {f}
            </button>
          );
        })}
      </div>

      <Card className="divide-y p-2">
        {shown.map((e) => {
          const agent = agents.find((a) => a.id === e.agentId);
          const Icon = KIND_ICON[e.kind];
          return (
            <div key={e.id} className="flex items-start gap-3 p-3">
              <div className="mt-0.5">
                {agent ? (
                  <AgentAvatar name={e.agentName} color={agent.avatarColor} size={32} />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{e.agentName}</p>
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {e.kind}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{e.message}</p>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{e.time}</span>
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">No events in this filter yet.</div>
        )}
      </Card>
    </div>
  );
}
