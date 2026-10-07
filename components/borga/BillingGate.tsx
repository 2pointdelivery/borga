'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast-bus';
import { formatUsd, type BillingInfo } from '@/lib/borga/billing';
import { useBorga } from '@/lib/borga/store';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

async function post(ws: string, action: 'checkout' | 'portal' | 'refresh') {
  const r = await fetch('/api/borga/billing', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ws, action }) });
  const j = (await r.json()) as { ok: boolean; error?: string; url?: string; billing?: BillingInfo };
  if (!j.ok) throw new Error(j.error ?? 'The billing request failed.');
  return j;
}

/** What the company pays: users and the monthly total, in one line. */
export const priceLine = (b: BillingInfo) => `${b.seats} user${b.seats === 1 ? '' : 's'} × ${formatUsd(b.pricePerUserCents)} = ${formatUsd(b.monthlyCents)} per month`;

/** Shown instead of the app while a workspace has not paid: nothing of the company can be set up until it does. */
export function BillingPaywall() {
  const { billing, activeWorkspace, activeWorkspaceId: ws, setBilling } = useBorga();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!billing) return null;
  const name = activeWorkspace()?.legalName || activeWorkspace()?.name || 'this company';

  const run = async (kind: 'checkout' | 'portal' | 'refresh') => {
    setBusy(kind); setError('');
    try {
      const j = await post(ws, kind);
      if (j.url) { window.location.href = j.url; return; }
      if (j.billing) {
        setBilling(j.billing);
        if (j.billing.access === 'blocked') setError('The payment has not come through yet. If you just paid, wait a few seconds and check again.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CreditCard className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-semibold">Activate {name}</h2>
            <p className="text-xs text-muted-foreground">{billing.message}</p>
          </div>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="text-2xl font-semibold">{formatUsd(billing.monthlyCents)}<span className="ml-1 text-sm font-normal text-muted-foreground">per month</span></p>
          <p className="text-xs text-muted-foreground">{priceLine(billing)}. Add people later and the price follows the team.</p>
        </div>
        {!billing.configured ? (
          <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Billing is switched on, but this server has no payment keys yet, so nobody can pay. Ask the administrator to finish the setup.</p>
        ) : (
          <div className="space-y-2">
            <Button className="w-full" disabled={busy !== null} onClick={() => void run('checkout')}>
              {busy === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pay {formatUsd(billing.monthlyCents)} per month
            </Button>
            <Button className="w-full" variant="outline" disabled={busy !== null} onClick={() => void run('refresh')}>
              {busy === 'refresh' && <Loader2 className="h-4 w-4 animate-spin" />} I have already paid, check again
            </Button>
            {billing.canManage && <Button className="w-full" variant="ghost" disabled={busy !== null} onClick={() => void run('portal')}>Manage payment method or subscription</Button>}
          </div>
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> You pay on Stripe&apos;s secure page. Borga never sees or stores your card. You can cancel any time from there.</p>
      </Card>
    </div>
  );
}

/** A strip above the app while a company is allowed in but needs to act: subscribe before the grace period ends, or fix a failed payment. */
export function BillingBanner() {
  const { billing, activeWorkspaceId: ws } = useBorga();
  const [busy, setBusy] = useState(false);
  if (!billing || billing.access !== 'allowed' || (billing.reason !== 'legacy-grace' && billing.reason !== 'past-due')) return null;
  const pastDue = billing.reason === 'past-due';
  const go = async () => {
    setBusy(true);
    try {
      const j = await post(ws, pastDue ? 'portal' : 'checkout');
      if (j.url) window.location.href = j.url;
    } catch (e) {
      toast({ title: 'Billing', description: (e as Error).message, variant: 'error' });
      setBusy(false);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <span>
        {pastDue ? 'The last payment failed. ' : 'This company needs a subscription. '}
        {billing.graceEndsOn ? `It stays open until ${billing.graceEndsOn}. ` : ''}
        {pastDue ? '' : `${priceLine(billing)}.`}
      </span>
      {billing.configured && <Button size="sm" variant="outline" disabled={busy} onClick={() => void go()}>{pastDue ? 'Update payment' : 'Subscribe'}</Button>}
    </div>
  );
}

/** Back from Stripe Checkout (/app?billing=success): ask the server what Stripe says, so the paywall lifts without waiting for the webhook. */
export function useBillingReturn() {
  const { loadedWorkspaceId, activeWorkspaceId: ws, setBilling } = useBorga();
  const done = useRef(false);
  useEffect(() => {
    if (!loadedWorkspaceId || loadedWorkspaceId !== ws || done.current || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const result = url.searchParams.get('billing');
    if (result !== 'success' && result !== 'cancel') return;
    done.current = true;
    url.searchParams.delete('billing');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
    if (result === 'cancel') { toast({ title: 'Payment cancelled', description: 'Nothing was charged.', variant: 'error' }); return; }
    void (async () => {
      try {
        // the webhook may be a moment behind: look a few times
        for (let i = 0; i < 4; i++) {
          const j = await post(ws, 'refresh');
          if (j.billing) setBilling(j.billing);
          if (j.billing?.access === 'allowed') { toast({ title: 'Payment received', description: 'The company is active.', variant: 'success' }); return; }
          await new Promise((r) => setTimeout(r, 2500));
        }
        toast({ title: 'Waiting for the payment', description: 'It has not been confirmed yet. Press "I have already paid" in a moment.', variant: 'error' });
      } catch (e) {
        toast({ title: 'Could not confirm the payment', description: (e as Error).message, variant: 'error' });
      }
    })();
  }, [loadedWorkspaceId, ws, setBilling]);
}

/** Holds back a page (the onboarding wizard) until the company's billing is known and settled. */
export function BillingGuard({ children }: { children: ReactNode }) {
  const { synced, hydrate, loadedWorkspaceId, billing } = useBorga();
  useBillingReturn();
  const started = useRef(false);
  const load = useCallback(() => { if (!synced && !started.current) { started.current = true; void hydrate(); } }, [synced, hydrate]);
  useEffect(() => { load(); }, [load]);
  if (!loadedWorkspaceId) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (billing?.access === 'blocked') return <BillingPaywall />;
  return <>{children}</>;
}
