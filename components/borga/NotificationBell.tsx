'use client';

import { Bell, BellRing, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { noticeTarget } from '@/lib/borga/push-core';
import type { ProactiveNotice } from '@/lib/borga/data';
import { cn } from '@/lib/utils';
import { usePush } from './use-push';

const DOT: Record<ProactiveNotice['severity'], string> = {
  urgent: 'bg-rose-500',
  noteworthy: 'bg-amber-500',
  info: 'bg-sky-500',
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

/**
 * The global notification center: every held notice (heartbeat, scheduler,
 * agents, SLA sweeps) with an unread count, per-item dismiss, clear-all, and
 * deep-links. Push subscription lives here too, so a device opts in once.
 */
export function NotificationBell() {
  const notices = useBorga((s) => s.notices);
  const dismissNotice = useBorga((s) => s.dismissNotice);
  const clearNotices = useBorga((s) => s.clearNotices);
  const { state, subscribe } = usePush();
  const unread = notices.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
          title="Notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button onClick={() => clearNotices()} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              Clear all
            </button>
          )}
        </div>
        {state.supported && !state.subscribed && (
          <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
            <p className="text-xs text-muted-foreground">
              {state.permission === 'denied'
                ? 'Browser notifications are blocked for this site — allow them in the address bar to get alerts with the dashboard closed.'
                : state.configured
                  ? 'Get urgent alerts even with the dashboard closed.'
                  : 'Server push is not configured yet (VAPID keys missing).'}
            </p>
            {state.permission !== 'denied' && state.configured && (
              <Button size="sm" className="h-7 shrink-0 gap-1.5" onClick={() => void subscribe()} disabled={state.busy}>
                <BellRing className="h-3.5 w-3.5" /> Notify me
              </Button>
            )}
          </div>
        )}
        <div className="max-h-96 overflow-y-auto">
          {notices.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">You are all caught up.</p>}
          {notices.map((n) => (
            <div key={n.id} className="group flex items-start gap-2.5 border-b px-4 py-3 last:border-0 hover:bg-accent/40">
              <button onClick={() => go(n)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[n.severity])} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  <span className="block text-xs text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{n.body}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/70">{ago(n.createdAt)}</span>
                </span>
              </button>
              <button
                aria-label="Dismiss"
                onClick={() => dismissNotice(n.id)}
                className="mt-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent group-hover:flex"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
