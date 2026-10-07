'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowRight, CheckCircle2, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBorga } from '@/lib/borga/store';
import { onboardingProgress, normalizeOnboarding } from '@/lib/borga/data';
import { useOptionalSetup } from './use-optional-setup';

const CHIP = 'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:border-primary/40 hover:bg-card/80';

/** Quiet companies can snooze the strip — it stays hidden for 7 days, per company. */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const snoozeKey = (wsId: string) => `borga:setup-strip-dismissed:${wsId}`;

function isSnoozed(wsId: string): boolean {
  try {
    const raw = localStorage.getItem(snoozeKey(wsId));
    if (!raw) return false;
    return Date.now() - Number(raw) < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * The strip under the header. While the essential steps are not done it shows progress and what is left. After that it stays, more
 * quietly, for as long as any optional item (website knowledge, AI model, email, voice) is not actually configured, and goes away
 * only when all of them are. "Configured" is read from the real settings, not from whether a step was clicked.
 */
export function OnboardingStatus() {
  const { activeWorkspace } = useBorga();
  const ws = activeWorkspace();
  const optional = useOptionalSetup();
  const [snoozedId, setSnoozedId] = useState<string | null>(null);
  if (!ws) return null;

  const ob = ws.onboarding;
  const essentialsDone = !ob || ob.completed;

  if (!essentialsDone) {
    const { done, total, pct } = onboardingProgress(ob);
    const pending = normalizeOnboarding(ob).steps.filter((s) => !s.completed && !s.optional);
    return (
      <div className="border-b border-primary/20 bg-primary/5 px-4 py-3 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary"><Sparkles className="h-4 w-4" /></span>
            <div>
              <p className="text-sm font-semibold">Finish setting up {ws.name}</p>
              <div className="mt-1 flex items-center gap-2">
                <Progress value={pct} className="h-1.5 w-32" />
                <span className="text-xs text-muted-foreground">{done}/{total} steps · {pct}%</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pending.slice(0, 3).map((s) => (
              <Link key={s.id} href={`/app/onboarding?step=${s.id}`} className={CHIP}>{s.title} <ArrowRight className="h-3 w-3" /></Link>
            ))}
            {pending.length > 3 && <span className="text-xs text-muted-foreground">+{pending.length - 3} more</span>}
            {optional.ready && optional.pending.length > 0 && <span className="text-xs text-muted-foreground">{optional.pending.length} optional</span>}
            <Link href="/app/onboarding">
              <Button size="sm" className="gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Resume onboarding</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // essentials are done: remind about what is still not configured, until it is.
  // Quiet companies can dismiss the strip — it stays hidden for a week, then
  // comes back only if something is still unconfigured.
  if (!optional.ready || optional.pending.length === 0) return null;
  if (snoozedId === ws.id || isSnoozed(ws.id)) return null;
  const snooze = () => {
    try {
      localStorage.setItem(snoozeKey(ws.id), String(Date.now()));
    } catch {
      // storage unavailable — hide for this session only
    }
    setSnoozedId(ws.id);
  };
  const done = optional.items.length - optional.pending.length;
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-2.5 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm">
            <span className="font-medium">Finish your setup</span>
            <span className="text-muted-foreground"> · {done} of {optional.items.length} optional items configured</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {optional.pending.map((i) => (
            <Link key={i.id} href={`/app/onboarding?step=${i.id}`} className={CHIP} title={i.hint}>{i.title} <ArrowRight className="h-3 w-3" /></Link>
          ))}
          <button
            type="button"
            onClick={snooze}
            title="Hide this reminder for a week"
            className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Dismiss for a week
          </button>
        </div>
      </div>
    </div>
  );
}
