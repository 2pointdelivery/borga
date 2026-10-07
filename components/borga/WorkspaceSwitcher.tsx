'use client';

import { useState } from 'react';
import { Building2, Check, ChevronsUpDown, Plus, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PLAN_LABEL, type WorkspacePlan } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { cn } from '@/lib/utils';
import { NewWorkspaceDialog } from './WorkspaceDialogs';

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, setActiveWorkspace } = useBorga();
  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  const [createOpen, setCreateOpen] = useState(false);

  const goWorkspaces = () =>
    window.dispatchEvent(new CustomEvent('borga:nav', { detail: 'workspaces' }));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex max-w-[220px] items-center gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            title="Switch company workspace"
          >
            {active?.logoDataUrl ? (
              <img
                src={active.logoDataUrl}
                alt={`${active.name} logo`}
                className="h-6 w-6 shrink-0 rounded-md border object-contain bg-white"
              />
            ) : (
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                style={{ background: `linear-gradient(135deg, ${active?.color ?? '#6366f1'}, ${(active?.color ?? '#6366f1')}99)` }}
              >
                {active?.name.slice(0, 2).toUpperCase() ?? 'WS'}
              </span>
            )}
            <span className="truncate">{active?.name ?? 'Workspace'}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Company workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() => setActiveWorkspace(w.id)}
              className="gap-2"
            >
              {w.logoDataUrl ? (
                <img
                  src={w.logoDataUrl}
                  alt={`${w.name} logo`}
                  className="h-5 w-5 shrink-0 rounded border object-contain bg-white"
                />
              ) : (
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                  style={{ background: w.color }}
                >
                  {w.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {PLAN_LABEL[w.plan as WorkspacePlan]}
              </span>
              {w.id === activeWorkspaceId && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" /> New company
          </DropdownMenuItem>
          <DropdownMenuItem onClick={goWorkspaces} className="gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" /> Manage companies
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

export function WorkspaceAvatar({ name, color, size = 8, logoDataUrl }: { name: string; color: string; size?: number; logoDataUrl?: string }) {
  if (logoDataUrl) {
    return (
      <img
        src={logoDataUrl}
        alt={`${name} logo`}
        className="shrink-0 rounded-lg border object-contain bg-white"
        style={{ width: size * 4, height: size * 4 }}
      />
    );
  }
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-lg font-semibold text-white')}
      style={{ width: size * 4, height: size * 4, background: color, fontSize: size * 1.6 }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function BuildingIcon() {
  return <Building2 className="h-4 w-4" />;
}
