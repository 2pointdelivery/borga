'use client';

import { Badge } from '@/components/ui/badge';
import {
  STATUS_LABEL,
  computeSla,
  fmtDuration,
  policyFor,
  ticketInsights,
  type SlaClock,
  type SlaState,
  type Ticket,
  type TicketPriority,
  type TicketSettings,
  type TicketStatus,
  type TicketSummary,
} from '@/lib/borga/tickets';
import { cn } from '@/lib/utils';

export const PRIORITY_STYLE: Record<TicketPriority, string> = {
  critical: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  high: 'bg-orange-500/10 text-orange-600 ring-orange-500/30',
  medium: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  low: 'bg-slate-500/10 text-slate-600 ring-slate-500/30',
};

export const STATUS_STYLE: Record<TicketStatus, string> = {
  open: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  'in-progress': 'bg-indigo-500/10 text-indigo-600 ring-indigo-500/30',
  pending: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  resolved: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  closed: 'bg-muted text-muted-foreground ring-border',
};

const SLA_STYLE: Record<SlaState, string> = {
  running: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  'at-risk': 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  breached: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  met: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  'met-late': 'bg-orange-500/10 text-orange-600 ring-orange-500/30',
  paused: 'bg-muted text-muted-foreground ring-border',
};

const SLA_LABEL: Record<SlaState, string> = {
  running: 'On track',
  'at-risk': 'At risk',
  breached: 'Breached',
  met: 'Met',
  'met-late': 'Met late',
  paused: 'Paused',
};

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className={cn('rounded-full px-2 py-0 text-[10px] font-medium capitalize ring-1 border-transparent', className)}>
      {children}
    </Badge>
  );
}

export const PriorityPill = ({ p }: { p: TicketPriority }) => <Pill className={PRIORITY_STYLE[p]}>{p}</Pill>;
export const StatusPill = ({ s }: { s: TicketStatus }) => <Pill className={STATUS_STYLE[s]}>{STATUS_LABEL[s]}</Pill>;

export function slaFor(t: Pick<Ticket, 'createdAt' | 'firstResponseAt' | 'resolvedAt' | 'status' | 'pauses' | 'priority' | 'slaPolicyId'>, settings: TicketSettings, nowMs: number) {
  return computeSla(t, policyFor(t, settings), settings.businessHours, nowMs);
}

function clockText(c: SlaClock, nowMs: number): string {
  if (c.state === 'met' || c.state === 'met-late') return `${fmtDuration(c.elapsedMin)} / ${fmtDuration(c.targetMin)}`;
  if (c.state === 'paused') return 'Clock paused';
  if (c.state === 'breached') return `${fmtDuration(c.elapsedMin - c.targetMin)} over`;
  if (c.dueAt) return `${fmtDuration(Math.max(0, (new Date(c.dueAt).getTime() - nowMs) / 60_000))} left`;
  return `${fmtDuration(c.targetMin - c.elapsedMin)} left`;
}

/** Compact SLA indicator for list rows and board cards: worst live clock + its remaining time. */
export function SlaBadge({ t, settings, nowMs }: { t: TicketSummary | Ticket; settings: TicketSettings; nowMs: number }) {
  const sla = slaFor(t, settings, nowMs);
  const active = sla.response.state === sla.worst ? sla.response : sla.resolution;
  const clock = sla.worst === 'met' || sla.worst === 'met-late' ? sla.resolution : active;
  return (
    <Pill className={cn('normal-case', SLA_STYLE[sla.worst])}>
      {SLA_LABEL[sla.worst]} · {clockText(clock, nowMs)}
    </Pill>
  );
}

/** Rule-based readout for one ticket: risks and next actions, derived only from its own fields and live SLA clocks. */
export function TicketInsightBox({ t, settings, nowMs }: { t: Ticket; settings: TicketSettings; nowMs: number }) {
  const insights = ticketInsights(t, slaFor(t, settings, nowMs), nowMs);
  if (!insights.length) return null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="mb-2 text-xs font-medium">Ticket insight</p>
      <ul className="space-y-1.5">
        {insights.map((i, n) => (
          <li key={n} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <span className={cn(
              'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
              i.tone === 'danger' ? 'bg-rose-500' : i.tone === 'warn' ? 'bg-amber-500' : 'bg-sky-500',
            )} />
            <span className="text-foreground/90">{i.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Full two-clock panel for the ticket detail sheet. */
export function SlaPanel({ t, settings, nowMs }: { t: Ticket; settings: TicketSettings; nowMs: number }) {
  const sla = slaFor(t, settings, nowMs);
  const policy = policyFor(t, settings);
  const rows: Array<[string, SlaClock]> = [['First response', sla.response], ['Resolution', sla.resolution]];
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {policy.name} · {policy.businessHoursOnly ? 'business hours only' : '24×7'}
      </p>
      {rows.map(([label, c]) => (
        <div key={label}>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{label}</span>
            <Pill className={cn('normal-case', SLA_STYLE[c.state])}>{SLA_LABEL[c.state]}</Pill>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full', c.state === 'breached' || c.state === 'met-late' ? 'bg-rose-500' : c.state === 'at-risk' ? 'bg-amber-500' : 'bg-emerald-500')}
              style={{ width: `${Math.min(100, Math.round(c.pct * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {fmtDuration(c.elapsedMin)} of {fmtDuration(c.targetMin)} · {clockText(c, nowMs)}
            {c.dueAt && c.state !== 'met' && c.state !== 'met-late' ? ` · due ${new Date(c.dueAt).toLocaleString()}` : ''}
          </p>
        </div>
      ))}
    </div>
  );
}
