'use client';

import { useEffect, useState } from 'react';
import { toastBus, type ToastMsg, type ToastVariant } from '@/lib/toast-bus';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const META: Record<ToastVariant, { Icon: typeof Bell; ring: string; icon: string; accent: string }> = {
  default: { Icon: Bell, ring: 'ring-white/10', icon: 'text-slate-300', accent: 'bg-slate-400' },
  info: { Icon: Info, ring: 'ring-sky-500/25', icon: 'text-sky-400', accent: 'bg-sky-400' },
  success: { Icon: CheckCircle2, ring: 'ring-emerald-500/25', icon: 'text-emerald-400', accent: 'bg-emerald-400' },
  warning: { Icon: AlertTriangle, ring: 'ring-amber-500/25', icon: 'text-amber-400', accent: 'bg-amber-400' },
  error: { Icon: XCircle, ring: 'ring-rose-500/25', icon: 'text-rose-400', accent: 'bg-rose-400' },
};

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    return toastBus.subscribe((t) => {
      setItems((prev) => [...prev, t].slice(-4));
      const dur = t.duration ?? 4200;
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, dur);
    });
  }, []);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((t) => {
        const m = META[t.variant ?? 'default'];
        const { Icon } = m;
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-white/10 ${m.ring} bg-slate-900/95 p-3 shadow-2xl shadow-black/40 backdrop-blur`}
            role="status"
          >
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${m.accent}`} />
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${m.icon}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="shrink-0 rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
