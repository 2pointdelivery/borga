'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarDays, ChevronLeft, ChevronRight, CreditCard, FolderKanban, LifeBuoy, Loader2, PanelRightClose, PanelRightOpen, Send, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useBorga } from '@/lib/borga/store';
import { formatUsd } from '@/lib/borga/billing';
import { ticketsApi } from '@/lib/borga/tickets-client';
import { useFeatures } from '@/lib/borga/features-client';
import type { TicketSummary } from '@/lib/borga/tickets';

const go = (page: string, tab?: string) =>
  window.dispatchEvent(new CustomEvent('borga:nav', { detail: tab ? { page, tab } : page }));

/** Where the public site (privacy, terms) lives; the links are left out when it is not configured. */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

const WIDGET = 'rounded-xl border bg-card p-3.5 text-card-foreground shadow-xs';
const TITLE = 'flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

/** YYYY-MM-DD in local time, which is how the app stores due dates. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

/* ------------------------------------------------------------------ Projects */

/** Task progress across the company's projects: how much is done, what is moving, and the active projects with their own progress. */
export function ProjectsWidget() {
  const { tasks, projects } = useBorga();
  const stats = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done').length;
    const moving = tasks.filter((t) => t.status === 'in-progress').length;
    const todo = tasks.length - done - moving;
    const active = projects
      .filter((p) => p.status === 'active' || p.status === 'planning')
      .map((p) => {
        const own = tasks.filter((t) => t.projectId === p.id);
        const pct = own.length ? Math.round(own.reduce((sum, t) => sum + (t.status === 'done' ? 100 : Math.max(0, Math.min(100, t.progress || 0))), 0) / own.length) : 0;
        return { id: p.id, name: p.name, pct, tasks: own.length };
      })
      .slice(0, 3);
    return { done, moving, todo, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, active };
  }, [tasks, projects]);

  return (
    <section className={WIDGET} aria-label="Project tasks">
      <div className="flex items-center justify-between">
        <h3 className={TITLE}><FolderKanban className="h-3.5 w-3.5" />Projects</h3>
        <button onClick={() => go('projects')} className="text-[11px] text-primary hover:underline">Open</button>
      </div>
      {tasks.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No tasks yet. Add one under Projects and its progress shows here.</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between">
            <p className="text-2xl font-semibold leading-none">{stats.pct}%</p>
            <p className="text-xs text-muted-foreground">{stats.done} of {tasks.length} tasks done</p>
          </div>
          <Progress value={stats.pct} className="mt-2 h-1.5" />
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
            <div className="rounded-md bg-muted/50 py-1"><p className="font-semibold">{stats.todo}</p><p className="text-muted-foreground">To do</p></div>
            <div className="rounded-md bg-sky-500/10 py-1"><p className="font-semibold">{stats.moving}</p><p className="text-muted-foreground">In progress</p></div>
            <div className="rounded-md bg-emerald-500/10 py-1"><p className="font-semibold">{stats.done}</p><p className="text-muted-foreground">Done</p></div>
          </div>
          {stats.active.length > 0 && (
            <ul className="mt-3 space-y-2">
              {stats.active.map((p) => (
                <li key={p.id}>
                  <button onClick={() => go('projects', p.id)} className="block w-full text-left">
                    <div className="flex items-center justify-between text-xs"><span className="truncate pr-2">{p.name}</span><span className="text-muted-foreground">{p.tasks ? `${p.pct}%` : 'no tasks'}</span></div>
                    <Progress value={p.pct} className="mt-1 h-1" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ Support tickets */

const TICKET_ROWS: Array<{ key: TicketSummary['status']; label: string; dot: string }> = [
  { key: 'open', label: 'Open', dot: 'bg-rose-500' },
  { key: 'in-progress', label: 'In progress', dot: 'bg-sky-500' },
  { key: 'pending', label: 'Waiting on customer', dot: 'bg-amber-500' },
  { key: 'resolved', label: 'Resolved', dot: 'bg-emerald-500' },
];

/** Where the Support Desk stands: tickets by status and how many urgent ones are still unresolved. Hidden when the Support Desk is off. */
export function TicketsWidget() {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const loaded = useBorga((s) => s.loadedWorkspaceId);
  const enabled = useFeatures((s) => s.flags.tickets);
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !ws || loaded !== ws) return;
    let alive = true;
    const load = () => {
      void ticketsApi.list(ws).then((r) => {
        if (!alive) return;
        if (r.ok) { setTickets(r.tickets); setFailed(false); } else setFailed(true);
      });
    };
    load();
    const t = setInterval(load, 120_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, ws, loaded]);

  if (!enabled) return null;
  const counts = (st: TicketSummary['status']) => (tickets ?? []).filter((t) => t.status === st).length;
  const urgent = (tickets ?? []).filter((t) => (t.priority === 'critical' || t.priority === 'high') && t.status !== 'resolved' && t.status !== 'closed').length;
  const unresolved = (tickets ?? []).filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;

  return (
    <section className={WIDGET} aria-label="Support tickets">
      <div className="flex items-center justify-between">
        <h3 className={TITLE}><LifeBuoy className="h-3.5 w-3.5" />Support tickets</h3>
        <button onClick={() => go('support')} className="text-[11px] text-primary hover:underline">Open</button>
      </div>
      {tickets === null ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {failed ? 'Could not load tickets.' : <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>}
        </p>
      ) : tickets.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No tickets yet. Customer emails and new tickets appear here.</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between">
            <p className="text-2xl font-semibold leading-none">{unresolved}</p>
            <p className="text-xs text-muted-foreground">unresolved{urgent > 0 ? ` · ${urgent} urgent` : ''}</p>
          </div>
          <ul className="mt-2 space-y-1">
            {TICKET_ROWS.map((r) => (
              <li key={r.key}>
                <button onClick={() => go('support', 'tickets')} className="flex w-full items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-accent">
                  <span className="flex items-center gap-2"><span className={cn('h-1.5 w-1.5 rounded-full', r.dot)} />{r.label}</span>
                  <span className="font-medium">{counts(r.key)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ Right rail */

const RAIL_KEY = 'borga:right-rail-collapsed';

/** The right-hand column on wide screens. It folds away to a thin handle, and remembers that on this device. */
export function RightRail() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(RAIL_KEY) === '1'); } catch { /* private mode: stay open */ }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(RAIL_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  };

  if (collapsed) {
    return (
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem-2rem)] w-10 shrink-0 pt-6 pr-2 2xl:block" aria-label="Widgets (hidden)">
        <button onClick={toggle} aria-label="Show widgets" title="Show widgets" className="flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-xs hover:text-foreground">
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem-2rem)] w-72 shrink-0 space-y-3 overflow-y-auto pb-24 pt-6 pr-4 2xl:block" aria-label="Widgets">
      <div className="flex justify-end">
        <button onClick={toggle} aria-label="Hide widgets" title="Hide widgets" className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <ProjectsWidget />
      <TicketsWidget />
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
