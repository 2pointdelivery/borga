'use client';

import Link from 'next/link';
import { Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBorga } from '@/lib/borga/store';
import { onboardingProgress, normalizeOnboarding, pendingOptionalSteps } from '@/lib/borga/data';

export function OnboardingStatus() {
  const { activeWorkspace } = useBorga();
  const ws = activeWorkspace();
  const ob = ws?.onboarding;
  if (!ob || ob.completed) return null;

  const { done, total, pct } = onboardingProgress(ob);
  const pending = normalizeOnboarding(ob).steps.filter((s) => !s.completed && !s.optional);
  const optionalLeft = pendingOptionalSteps(ob).length;

  return (
    <div className="border-b border-primary/20 bg-primary/5 px-4 py-3 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Finish setting up {ws?.name}</p>
            <div className="mt-1 flex items-center gap-2">
              <Progress value={pct} className="h-1.5 w-32" />
              <span className="text-xs text-muted-foreground">{done}/{total} steps · {pct}%</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pending.slice(0, 3).map((s) => (
            <Link
              key={s.id}
              href={`/app/onboarding?step=${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:border-primary/40 hover:bg-card/80"
            >
              {s.title} <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
          {pending.length > 3 && (
            <span className="text-xs text-muted-foreground">+{pending.length - 3} more</span>
          )}
          {optionalLeft > 0 && <span className="text-xs text-muted-foreground">{optionalLeft} optional</span>}
          <Link href="/app/onboarding">
            <Button size="sm" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Resume onboarding
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
