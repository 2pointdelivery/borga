'use client';

import { useState } from 'react';
import { Bell, BellRing, CheckCheck, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import { noticeTarget } from '@/lib/borga/push-core';
import type { ProactiveNotice } from '@/lib/borga/data';
import { cn } from '@/lib/utils';
import { usePush } from './use-push';
import { ConfigDeepLinkButton } from './ConfigDeepLink';

const SEVERITY_META: Record<ProactiveNotice['severity'], { dot: string; badge: string; label: string }> = {
  urgent: { dot: 'bg-rose-500', badge: 'bg-rose-500/10 text-rose-600 ring-rose-500/25', label: 'Urgent' },
  noteworthy: { dot: 'bg-amber-500', badge: 'bg-amber-500/10 text-amber-600 ring-amber-500/25', label: 'Action' },
  info: { dot: 'bg-sky-500', badge: 'bg-sky-500/10 text-sky-600 ring-sky-500/25', label: 'Update' },
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function go(n: ProactiveNotice) {
  const t = noticeTarget(n);
  window.dispatchEvent(new CustomEvent('borga:nav', { detail: t.tab ? { page: t.page, tab: t.tab } : t.page }));
}

export function NotificationBell() {
  const notices = useBorga((s) => s.notices);
  const dismissNotice = useBorga((s) => s.dismissNotice);
  const clearNotices = useBorga((s) => s.clearNotices);
  const { state, subscribe } = usePush();
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');

  const unread = notices.length;
  const urgentCount = notices.filter((n) => n.severity === 'urgent').length;
  const filtered = filter === 'urgent' ? notices.filter((n) => n.severity === 'urgent') : notices;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
          title="Notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border/80 hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold tabular-nums text-white ring-2 ring-background',
                urgentCount > 0 ? 'bg-rose-500' : 'bg-primary',
              )}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] overflow-hidden rounded-xl border-border/85 p-0 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/75 bg-muted/20 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold tracking-tight text-foreground">Notifications</p>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {unread}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border/80 bg-background p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={cn(
                  'rounded px-2 py-0.5 font-medium transition',
                  filter === 'all' ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter('urgent')}
                className={cn(
                  'rounded px-2 py-0.5 font-medium transition',
                  filter === 'urgent' ? 'bg-rose-500/15 font-semibold text-rose-600' : 'text-muted-foreground',
                )}
              >
                Urgent ({urgentCount})
              </button>
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => clearNotices()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                title="Clear all notifications"
              >
                <CheckCheck className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Web Push Banner */}
        {state.supported && !state.subscribed && (
          <div className="flex items-center justify-between gap-3 border-b border-border/75 bg-muted/30 px-4 py-2.5">
            <p className="text-[11px] leading-snug text-muted-foreground">
              {state.permission === 'denied'
                ? 'Browser notifications are blocked — allow them in the address bar to receive background alerts.'
                : state.configured
                  ? 'Enable real-time Web Push alerts even when Borga is closed.'
                  : 'Server push is not configured yet (VAPID keys missing).'}
            </p>
            {state.permission !== 'denied' && state.configured ? (
              <Button size="sm" className="h-7 shrink-0 gap-1 text-[11px]" onClick={() => void subscribe()} disabled={state.busy}>
                <BellRing className="h-3 w-3" /> Enable Push
              </Button>
            ) : !state.configured ? (
              <ConfigDeepLinkButton target="push-settings" label="Push setup" className="shrink-0" />
            ) : null}
          </div>
        )}

        {/* Notice List */}
        <div className="max-h-96 divide-y divide-border/60 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-10 text-center">
              <p className="text-xs font-medium text-foreground">All caught up</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {filter === 'urgent' ? 'No urgent alerts right now.' : 'New approvals, SLA alerts, and scheduled updates appear here.'}
              </p>
            </div>
          )}
          {filtered.map((n) => {
            const meta = SEVERITY_META[n.severity] ?? SEVERITY_META.info;
            return (
              <div
                key={n.id}
                className="group flex items-start gap-2.5 px-4 py-3 transition-colors hover:bg-muted/30"
              >
                <button
                  type="button"
                  onClick={() => go(n)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', meta.dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-foreground">{n.title}</span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {ago(n.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                      {n.body}
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5">
                      <Badge className={cn('px-1.5 py-0 text-[9px] ring-1 ring-inset', meta.badge)}>
                        {meta.label}
                      </Badge>
                      {n.source && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/80">
                          {n.source}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismissNotice(n.id)}
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
