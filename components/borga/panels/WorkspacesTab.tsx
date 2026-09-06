'use client';

import { useState } from 'react';
import {
  Building2,
  Plus,
  Pencil,
  Check,
  Trash2,
  Globe,
} from 'lucide-react';
import { MONTH_NAMES } from '@/lib/borga/data';
import { CURRENCY_SYMBOL } from '@/lib/borga/data';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PLAN_LABEL, type Workspace } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { NewWorkspaceDialog, EditWorkspaceDialog } from '../WorkspaceDialogs';
import { cn } from '@/lib/utils';

export function WorkspacesTab() {
  const {
    workspaces, activeWorkspaceId, setActiveWorkspace, deleteWorkspace,
    leads, finance, employees, log,
  } = useBorga();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Workspace | null>(null);

  // Per-workspace rollups are only exact for the active tenant (its data is
  // hydrated); others show structural info.
  const statsFor = (w: Workspace) => {
    if (w.id !== activeWorkspaceId) return null;
    return {
      leads: leads.length,
      pipeline: leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').reduce((s, l) => s + l.value, 0),
      revenue: finance.filter((f) => f.kind === 'revenue' && !f.voidedAt).reduce((s, f) => s + f.amount, 0),
      headcount: employees.filter((e) => e.status !== 'offboarded').length,
    };
  };

  const fmt = (n: number, cur: Workspace['currency']) =>
    `${CURRENCY_SYMBOL[cur]}${n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n}`;

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Companies" sub="Every workspace is an isolated tenant — its own CRM, campaigns, ledger, people and agents" />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New company
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((w) => {
          const isActive = w.id === activeWorkspaceId;
          const stats = statsFor(w);
          return (
            <Card key={w.id} className={cn('flex flex-col p-5', isActive && 'ring-1 ring-primary/40')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${w.color}, ${w.color}99)` }}
                  >
                    {w.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{w.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{w.industry}</p>
                  </div>
                </div>
                {isActive ? (
                  <Badge className="shrink-0 bg-emerald-500/10 text-emerald-600 text-[10px]">
                    <Check className="mr-0.5 h-2.5 w-2.5" /> active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 text-[10px]">{PLAN_LABEL[w.plan]}</Badge>
                )}
              </div>

              <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                <p className="flex items-center gap-1.5">
                  <Globe className="h-3 w-3" /> {[w.city, w.state, w.country].filter(Boolean).join(', ') || '…'} — {w.currency}
                </p>
                {(w.legalName || w.businessNumber || w.taxNumber) && (
                  <p className="truncate">
                    {w.legalName ?? w.name}{w.businessNumber ? ` — BN ${w.businessNumber}` : ''}{w.taxNumber ? ` — Tax ${w.taxNumber}` : ''}
                  </p>
                )}
                <p>
                  since {w.createdAt}{w.timezone ? ` — ${w.timezone}` : ''}
                  {w.fiscalYearEndMonth ? ` — FY ends ${MONTH_NAMES[w.fiscalYearEndMonth - 1]} ${w.fiscalYearEndDay}` : ''}
                  {isActive ? ' — full suite loaded' : ''}
                </p>
              </div>

              {stats && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/20 p-2">
                    <p className="text-[10px] text-muted-foreground">Pipeline</p>
                    <p className="text-sm font-semibold">{fmt(stats.pipeline, w.currency)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2">
                    <p className="text-[10px] text-muted-foreground">Revenue</p>
                    <p className="text-sm font-semibold">{fmt(stats.revenue, w.currency)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2">
                    <p className="text-[10px] text-muted-foreground">Leads</p>
                    <p className="text-sm font-semibold">{stats.leads}</p>
                  </div>
                  <div className="rounded-lg bg-muted/20 p-2">
                    <p className="text-[10px] text-muted-foreground">Headcount</p>
                    <p className="text-sm font-semibold">{stats.headcount}</p>
                  </div>
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 pt-4">
                {!isActive && (
                  <Button size="sm" className="h-7 flex-1 gap-1" onClick={() => setActiveWorkspace(w.id)}>
                    <Building2 className="h-3 w-3" /> Switch to
                  </Button>
                )}
                <Button size="sm" variant="outline" className="h-7 flex-1 gap-1" onClick={() => setEditing(w)}>
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
                {workspaces.length > 1 && !isActive && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(w)} title="Delete company">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </Card>
          );
        })}

        {/* Create tile */}
        <button
          onClick={() => setCreateOpen(true)}
          className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Plus className="h-6 w-6" />
          Add another company
        </button>
      </div>

      <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditWorkspaceDialog workspace={editing} open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }} />

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              The workspace entry is removed from the registry. Its scoped data stays in the database until purged by an administrator.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete) {
                  deleteWorkspace(confirmDelete.id);
                  log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Workspace "${confirmDelete.name}" deleted.` });
                }
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

