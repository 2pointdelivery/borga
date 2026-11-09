'use client';

import { useEffect, useState } from 'react';
import { toastBus, type ToastMsg, type ToastVariant } from '@/lib/toast-bus';
import {
  CONFIG_DEEP_LINKS,
  detectConfigTargetFromText,
  openConfigDeepLink,
} from '@/lib/borga/config-deeplink';
import { AlertTriangle, ArrowUpRight, Bell, CheckCircle2, Info, Settings2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const META: Record<ToastVariant, { Icon: typeof Bell; bar: string; icon: string; badge: string }> = {
  default: { Icon: Bell, bar: 'bg-foreground/60', icon: 'text-foreground', badge: 'Notice' },
  info: { Icon: Info, bar: 'bg-sky-500', icon: 'text-sky-600 dark:text-sky-400', badge: 'Info' },
  success: { Icon: CheckCircle2, bar: 'bg-emerald-500', icon: 'text-emerald-600 dark:text-emerald-400', badge: 'Success' },
  warning: { Icon: AlertTriangle, bar: 'bg-amber-500', icon: 'text-amber-600 dark:text-amber-400', badge: 'Attention' },
  error: { Icon: XCircle, bar: 'bg-rose-500', icon: 'text-rose-600 dark:text-rose-400', badge: 'Error' },
};

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    return toastBus.subscribe((t) => {
      setItems((prev) => [...prev, t].slice(-4));
      const hasConfigLink =
        !!t.configTarget || !!t.action || !!detectConfigTargetFromText(`${t.title} ${t.description ?? ''}`);
      const dur = t.duration ?? (hasConfigLink ? 6500 : 4200);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, dur);
    });
  }, []);

  const dismiss = (id: string) => setItems((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => {
        const m = META[t.variant ?? 'default'];
        const { Icon } = m;
        const deepLink = t.configTarget
          ? CONFIG_DEEP_LINKS[t.configTarget]
          : detectConfigTargetFromText(`${t.title} ${t.description ?? ''}`);

        return (
          <div
            key={t.id}
            className="pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-xl border border-border/90 bg-card/98 p-3 pl-4 text-card-foreground shadow-lg backdrop-blur"
            role="status"
          >
            <span className={cn('absolute inset-y-0 left-0 w-1', m.bar)} />
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', m.icon)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold tracking-tight text-foreground">{t.title}</p>
              </div>
              {t.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.description}</p>
              ) : null}
              {(deepLink || t.action) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {deepLink && (
                    <button
                      type="button"
                      onClick={() => {
                        openConfigDeepLink(deepLink);
                        dismiss(t.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition hover:bg-primary/15"
                    >
                      <Settings2 className="h-3 w-3" />
                      <span>{deepLink.label}</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  )}
                  {t.action && (
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.onClick();
                        dismiss(t.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground transition hover:bg-muted"
                    >
                      <span>{t.action.label}</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
