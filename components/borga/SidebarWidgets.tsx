'use client';

import { useMemo, useState } from 'react';
import { Bot, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle, CreditCard, Loader2, Send, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useBorga } from '@/lib/borga/store';
import { normalizeOnboarding, onboardingProgress } from '@/lib/borga/data';
import { formatUsd } from '@/lib/borga/billing';
import { useOptionalSetup } from './use-optional-setup';

const go = (page: string, tab?: string) =>
  window.dispatchEvent(new CustomEvent('borga:nav', { detail: tab ? { page, tab } : page }));

/** Where the public site (privacy, terms) lives; the links are left out when it is not configured. */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

const WIDGET = 'rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs';
const TITLE = 'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

/** YYYY-MM-DD in local time, which is how the app stores due dates. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ------------------------------------------------------------------ Get started */

/** The setup checklist. Essentials come from onboarding, optional items from the real settings. Hides itself when everything is done. */
export function GetStartedWidget() {
  const { activeWorkspace } = useBorga();
  const optional = useOptionalSetup();
  const ws = activeWorkspace();
  const ob = ws?.onboarding;
  if (!ws) return null;

  const essentials = normalizeOnboarding(ob).steps.filter((s) => !s.optional);
  const { done, total, pct } = onboardingProgress(ob);
  const optItems = optional.ready ? optional.items : [];
  const allDone = (!ob || ob.completed) && optional.ready && optional.pending.length === 0;
  if (allDone) return null;

  const rows = [
    ...(ob && !ob.completed ? essentials.map((s) => ({ key: s.id, title: s.title, done: s.completed, run: () => { window.location.href = `/app/onboarding?step=${s.id}`; } })) : []),
    ...optItems.map((o) => ({ key: `o-${o.id}`, title: o.title, done: o.configured, run: () => go('integrations') })),
  ];
  const doneN = rows.filter((r) => r.done).length;
  const value = rows.length ? Math.round((doneN / rows.length) * 100) : pct;

  return (
    <section className={WIDGET} aria-label="Get started">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Get started</h3>
        <span className="text-xs text-muted-foreground">{rows.length ? `${doneN} of ${rows.length}` : `${done}/${total}`}</span>
      </div>
      <Progress value={value} className="mt-2 h-1.5" />
      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              onClick={r.run}
              disabled={r.done}
              className={cn('flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors', r.done ? 'text-muted-foreground' : 'hover:bg-accent')}
            >
              {r.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
              <span className={cn(r.done && 'line-through')}>{r.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ Calendar */

interface DayItem { label: string; kind: 'task' | 'invoice' | 'bill' | 'leave'; page: string; tab?: string }

const KIND_DOT: Record<DayItem['kind'], string> = {
  task: 'bg-sky-500', invoice: 'bg-emerald-500', bill: 'bg-amber-500', leave: 'bg-violet-500',
};

/** A month grid that marks the days something is due: tasks, invoices, bills and approved leave. Click a day to see what falls on it. */
export function CalendarWidget() {
  const { tasks, invoices, bills, leaveRequests } = useBorga();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState<string | null>(null);
  const todayKey = ymd(new Date());

  const byDay = useMemo(() => {
    const m = new Map<string, DayItem[]>();
    const add = (day: string | undefined, item: DayItem) => {
      const k = (day ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      m.set(k, [...(m.get(k) ?? []), item]);
    };
    tasks.filter((t) => t.status !== 'done').forEach((t) => add(t.due, { label: t.title, kind: 'task', page: 'projects' }));
    invoices.filter((i) => i.status !== 'paid').forEach((i) => add(i.due, { label: `Invoice ${i.number} · ${i.client}`, kind: 'invoice', page: 'sales', tab: 'invoicing' }));
    bills.filter((b) => b.status !== 'paid').forEach((b) => add(b.due, { label: `Bill ${b.number} · ${b.vendorName}`, kind: 'bill', page: 'finance', tab: 'vendors' }));
    leaveRequests.filter((l) => l.status === 'approved').forEach((l) => add(l.from, { label: `${l.employeeName} on leave`, kind: 'leave', page: 'hr' }));
    return m;
  }, [tasks, invoices, bills, leaveRequests]);

  const first = cursor.getDay();
  const daysIn = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const key = (day: number) => ymd(new Date(cursor.getFullYear(), cursor.getMonth(), day));
  const shown = picked ?? todayKey;
  const items = byDay.get(shown) ?? [];

  return (
    <section className={WIDGET} aria-label="Calendar">
      <div className="flex items-center justify-between">
        <h3 className={TITLE}><CalendarDays className="h-3.5 w-3.5" />{cursor.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</h3>
        <div className="flex items-center">
          <button aria-label="Previous month" className="rounded p-1 hover:bg-accent" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button aria-label="Next month" className="rounded p-1 hover:bg-accent" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} className="py-0.5">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-xs">
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />;
          const k = key(day);
          const has = byDay.get(k);
          return (
            <button
              key={k}
              onClick={() => setPicked(k)}
              aria-label={k}
              className={cn(
                'relative mx-auto flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-accent',
                k === todayKey && 'bg-primary font-semibold text-primary-foreground hover:bg-primary/90',
                k === shown && k !== todayKey && 'ring-1 ring-primary',
              )}
            >
              {day}
              {has && <span className={cn('absolute bottom-0.5 h-1 w-1 rounded-full', k === todayKey ? 'bg-primary-foreground' : KIND_DOT[has[0].kind])} />}
            </button>
          );
        })}
      </div>
      <div className="mt-2 border-t pt-2">
        <p className="text-[11px] font-medium text-muted-foreground">{shown === todayKey ? 'Today' : new Date(`${shown}T12:00:00`).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
        {items.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">Nothing due.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {items.slice(0, 4).map((it, i) => (
              <li key={i}>
                <button onClick={() => go(it.page, it.tab)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', KIND_DOT[it.kind])} />
                  <span className="truncate">{it.label}</span>
                </button>
              </li>
            ))}
            {items.length > 4 && <li className="px-1 text-[11px] text-muted-foreground">+{items.length - 4} more</li>}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ AI assistant */

const PROMPTS = [
  'Summarize where the business stands',
  'What needs my attention today?',
  'Draft a status update for the team',
];

/** A small chat with the Borga orchestrator, using the company's chosen AI model. Works without voice. */
export function AssistantWidget() {
  const { llm, activeWorkspaceId, activeWorkspace } = useBorga();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');

  const ask = async (q: string) => {
    const prompt = q.trim();
    if (!prompt || busy) return;
    setBusy(true); setReply('');
    try {
      const res = await fetch('/api/borga/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          providerId: llm.providerId, model: llm.model,
          messages: [{ role: 'user', content: prompt }],
          ws: activeWorkspaceId, companyName: activeWorkspace()?.name,
        }),
      });
      const j = (await res.json()) as { reply?: string; error?: string };
      setReply(j.reply ?? j.error ?? 'No answer came back. Check the AI model under AI Platform.');
      setText('');
    } catch {
      setReply('Could not reach the AI service. Try again in a moment.');
    } finally { setBusy(false); }
  };

  return (
    <section className={WIDGET} aria-label="AI assistant">
      <h3 className={TITLE}><Sparkles className="h-3.5 w-3.5" />AI assistant</h3>
      <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Ask Borga anything…"
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </form>
      {reply ? (
        <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs leading-relaxed">{reply}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROMPTS.map((p) => (
            <button key={p} disabled={busy} onClick={() => void ask(p)} className="rounded-full border px-2.5 py-1 text-left text-[11px] transition-colors hover:bg-accent disabled:opacity-50">{p}</button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ Plan */

/** What the company pays and until when. Only shown where billing is switched on. */
export function PlanWidget() {
  const billing = useBorga((s) => s.billing);
  const ws = useBorga((s) => s.activeWorkspaceId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!billing || billing.mode !== 'enforce') return null;
  const active = billing.status === 'active';
  const open = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/borga/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws, action: active ? 'portal' : 'checkout' }),
      });
      const j = (await r.json()) as { ok: boolean; url?: string; error?: string };
      if (!j.ok || !j.url) throw new Error(j.error ?? 'The billing page could not be opened.');
      window.location.href = j.url;
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <section className={cn(WIDGET, active ? '' : 'border-primary/30 bg-primary/5')} aria-label="Plan">
      <h3 className={TITLE}><CreditCard className="h-3.5 w-3.5" />Plan</h3>
      <p className="mt-1.5 text-sm font-semibold">
        {formatUsd(billing.monthlyCents)}<span className="text-xs font-normal text-muted-foreground"> / month</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {billing.seats} user{billing.seats === 1 ? '' : 's'} at {formatUsd(billing.pricePerUserCents)} each
        {billing.currentPeriodEnd ? ` · renews ${new Date(billing.currentPeriodEnd).toLocaleDateString('en', { month: 'short', day: 'numeric' })}` : ''}
      </p>
      {!active && <p className="mt-1 text-xs">{billing.message}</p>}
      {(billing.configured && (active ? billing.canManage : true)) && (
        <button onClick={() => void open()} disabled={busy} className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {busy ? 'Opening…' : active ? 'Manage subscription' : 'Subscribe'}
        </button>
      )}
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ Right rail */

/** The right-hand column on wide screens. */
export function RightRail() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem-2rem)] w-72 shrink-0 space-y-3 overflow-y-auto pb-24 pt-6 pr-4 2xl:block" aria-label="Widgets">
      <GetStartedWidget />
      <CalendarWidget />
      <AssistantWidget />
      <PlanWidget />
    </aside>
  );
}

/* ------------------------------------------------------------------ Status bar */

/** The strip along the bottom: whether data is being saved, what the agents are doing, and the legal links. */
export function StatusBar() {
  const { dbAvailable, agentRuns, scheduledTasks } = useBorga();
  const running = agentRuns.filter((r) => r.status === 'running').length;
  const scheduled = scheduledTasks.filter((t) => t.enabled).length;
  return (
    <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t bg-background/80 px-4 py-1.5 text-[11px] text-muted-foreground lg:px-6">
      <span className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', dbAvailable ? 'bg-emerald-500' : 'bg-amber-500')} />
        {dbAvailable ? 'All systems operational' : 'Offline: changes saved on this device only'}
      </span>
      <button onClick={() => go('ai', 'runs')} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 hover:bg-accent" title="Open the AI platform">
        {running > 0 ? <Zap className="h-3 w-3 text-amber-500" /> : <Bot className="h-3 w-3" />}
        {running > 0 ? `${running} agent run${running === 1 ? '' : 's'} in progress` : `${scheduled} automation${scheduled === 1 ? '' : 's'} scheduled`}
      </button>
      <nav className="flex items-center gap-3">
        <a href="/developers" className="hover:text-foreground">API</a>
        {SITE_URL && <a href={`${SITE_URL}/privacy`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Privacy</a>}
        {SITE_URL && <a href={`${SITE_URL}/terms`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Terms</a>}
      </nav>
    </footer>
  );
}
