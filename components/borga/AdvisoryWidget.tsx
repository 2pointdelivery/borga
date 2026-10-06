'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, RefreshCw, ArrowUpRight, Send, MessageCircle, EyeOff, PartyPopper, BellRing, MessageCircleQuestion, Ear } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useBorga } from '@/lib/borga/store';
import { fmtMoney } from '@/lib/borga/currencies';
import { ticketsApi, type ClientSettings } from '@/lib/borga/tickets-client';
import { deriveBusinessInsights, type BusinessInsight } from '@/lib/borga/insights';
import { ADVISOR_SUGGESTIONS, ADVISOR_TOPIC_META, answerAdvisorQuestion, detectAdvisorTopics, routeAdvisorTopic, type AdvisorAnswer, type AdvisorContext, type AdvisorMemory } from '@/lib/borga/advisor';
import { AdvisorAvatar, type AdvisorMood } from './AdvisorAvatar';
import { isDoneStatus, type TicketSummary } from '@/lib/borga/tickets';
import { slaFor } from './ticket-bits';
import { cn } from '@/lib/utils';

const SEVERITY_DOT: Record<BusinessInsight['severity'], string> = {
  critical: 'bg-rose-500',
  watch: 'bg-amber-500',
  info: 'bg-sky-500',
  positive: 'bg-emerald-500',
};

const SEVERITY_TEXT: Record<BusinessInsight['severity'], string> = {
  critical: 'text-rose-600',
  watch: 'text-amber-600',
  info: 'text-sky-600',
  positive: 'text-emerald-600',
};

function supportSummary(tickets: TicketSummary[], settings: ClientSettings, nowMs: number) {
  const done = tickets.filter((t) => isDoneStatus(t.status));
  const states = tickets.map((t) => slaFor(t, settings, nowMs).worst);
  const met = done.filter((t) => ['met', 'running'].includes(slaFor(t, settings, nowMs).worst)).length;
  return {
    active: tickets.filter((t) => !isDoneStatus(t.status)).length,
    breached: states.filter((s) => s === 'breached').length,
    atRisk: states.filter((s) => s === 'at-risk').length,
    unassigned: tickets.filter((t) => !isDoneStatus(t.status) && !t.assignee).length,
    compliance: done.length ? Math.round((met / done.length) * 100) : null,
  };
}

// Thought-process questions per menu page — the nudge shown when the page opens.
const PAGE_NUDGES: Record<string, { question: string; blurb: string; cta: string }> = {
  overview: { question: 'Morning brief', blurb: 'What needs your attention first today?', cta: 'Brief me' },
  sales: { question: 'How is the pipeline?', blurb: 'Which deals are stalling at proposal?', cta: 'Check pipeline' },
  marketing: { question: 'Any dry ad spend?', blurb: 'Are your campaigns converting or just spending?', cta: 'Review ads' },
  communications: { question: 'Comms backlog?', blurb: 'Anyone waiting on a reply right now?', cta: 'See comms' },
  support: { question: 'Any SLA risk?', blurb: 'Which tickets need attention before they breach?', cta: 'Check SLA' },
  finance: { question: 'Cash runway?', blurb: 'How many months of runway do you have left?', cta: 'Check cash' },
  inventory: { question: 'Anything out of stock?', blurb: 'What will stock out if sales continue?', cta: 'Check stock' },
  projects: { question: 'Projects over budget?', blurb: 'Which deliveries are over budget or stalled?', cta: 'Review projects' },
  hr: { question: 'Any pending leave?', blurb: 'Leave requests waiting, anyone stuck onboarding?', cta: 'People ops' },
  company: { question: 'Funding deadlines?', blurb: 'Any grant deadlines or knowledge gaps?', cta: 'Check company' },
  ai: { question: 'Queue healthy?', blurb: 'Failed runs, backlog, idle scheduler — all clear?', cta: 'Open queue' },
  integrations: { question: 'Integrations healthy?', blurb: 'Webhooks off or connectors in error?', cta: 'Check links' },
  developers: { question: 'Integrations healthy?', blurb: 'Webhooks off or connectors in error?', cta: 'Check links' },
  settings: { question: 'Morning brief', blurb: 'While you are here — anything need action?', cta: 'Brief me' },
};

const IDLE_MS = 45_000;
const TEASER_LIFE_MS = 16_000;

interface TeaserAction {
  label: string;
  run: () => void;
}

interface Teaser {
  id: string;
  kind: 'greeting' | 'attention' | 'nudge' | 'reminder' | 'celebration' | 'idle';
  title: string;
  body: string;
  actions: TeaserAction[];
}

const KIND_ICON = {
  greeting: Sparkles,
  attention: BellRing,
  nudge: MessageCircleQuestion,
  reminder: BellRing,
  celebration: PartyPopper,
  idle: MessageCircleQuestion,
} as const;

export function AdvisoryWidget({ page = 'overview', tab }: { page?: string; tab?: string }) {
  const {
    finance, invoices, bills, vendors, customers, leads, goals, journals,
    bankTxns, bankAccounts, employees, projects, tasks, ads,
    inventoryItems, stockMovements, chats, calls, leaveRequests, fundraising,
    knowledge, kbQuestions, revenueTracks, budgets, filings, posts,
    webhooks, mcpServers, kpiGroups, scheduledTasks, agentRuns,
    activeWorkspaceId: ws, activeWorkspace, userName,
  } = useBorga();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [queue, setQueue] = useState({ queued: 0, running: 0, failed: 0 });
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [qa, setQa] = useState<Array<{ q: string; a: AdvisorAnswer }>>([]);
  const [draft, setDraft] = useState('');
  const [teaser, setTeaser] = useState<Teaser | null>(null);
  const [wiggleKey, setWiggleKey] = useState(0);

  const lastActiveRef = useRef(Date.now());
  const lastTeaserAtRef = useRef(0);
  const seenAttentionRef = useRef<Set<string>>(new Set());
  const celebratedRef = useRef(false);
  const idleCountRef = useRef(0);
  const lastIdleAtRef = useRef(0);
  const teaserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const r = await ticketsApi.list(ws).catch(() => null);
    if (r && r.ok) {
      setTickets(r.tickets);
      setSettings(r.settings);
    }
    try {
      const q = await fetch(`/api/borga/agent/queue?ws=${encodeURIComponent(ws)}`, {
        headers: { 'X-Borga-Client': 'borga-dashboard' },
      });
      const qd = await q.json() as { ok?: boolean; jobs?: { status?: string }[] };
      if (qd.ok && qd.jobs) {
        setQueue({
          queued: qd.jobs.filter((j) => j.status === 'queued').length,
          running: qd.jobs.filter((j) => j.status === 'running').length,
          failed: qd.jobs.filter((j) => j.status === 'error').length,
        });
      }
    } catch {
      // Queue snapshot is best-effort
    }
    setNowMs(Date.now());
  }, [ws]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Idle tracking: any interaction resets the 45s clock.
  useEffect(() => {
    const poke = () => { lastActiveRef.current = Date.now(); };
    window.addEventListener('pointerdown', poke);
    window.addEventListener('keydown', poke);
    window.addEventListener('scroll', poke, true);
    return () => {
      window.removeEventListener('pointerdown', poke);
      window.removeEventListener('keydown', poke);
      window.removeEventListener('scroll', poke, true);
    };
  }, []);

  const runsSummary = useMemo(() => ({
    queued: queue.queued,
    running: queue.running,
    failed: queue.failed + agentRuns.filter((r) => r.status === 'error').length,
    scheduledActive: scheduledTasks.filter((t) => t.enabled).length,
  }), [queue, agentRuns, scheduledTasks]);

  const insights = useMemo(
    () =>
      deriveBusinessInsights({
        finance, invoices, bills, vendors, customers, leads, goals,
        journals, bankTxns, bankAccounts, employees, projects, tasks, ads,
        inventoryItems, stockMovements, chats, calls, leaveRequests, fundraising,
        knowledge, kbOpenQuestions: kbQuestions.length, runsSummary,
        revenueTracks, budgets, filings, posts, webhooks, mcpServers, kpiGroups,
        support: settings ? supportSummary(tickets, settings, nowMs) : undefined,
      }),
    [finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees, projects, tasks, ads, inventoryItems, stockMovements, chats, calls, leaveRequests, fundraising, knowledge, kbQuestions, runsSummary, revenueTracks, budgets, filings, posts, webhooks, mcpServers, kpiGroups, tickets, settings, nowMs],
  );

  const visible = insights.filter((i) => !dismissed.has(i.id));
  const urgent = visible.filter((i) => i.severity === 'critical' || i.severity === 'watch').length;

  const advisorCtx: AdvisorContext = useMemo(
    () => ({
      finance, invoices, bills, vendors, customers, leads, goals, journals,
      bankTxns, bankAccounts, employees, projects, tasks, ads,
      inventoryItems, stockMovements, chats, calls, leaveRequests, fundraising,
      knowledge, kbOpenQuestions: kbQuestions.length, runsSummary,
      revenueTracks, budgets, filings, posts, webhooks, mcpServers, kpiGroups,
      support: settings ? supportSummary(tickets, settings, nowMs) : undefined,
      workspaceName: activeWorkspace()?.name ?? 'the company',
      money: (n: number) => fmtMoney(n, activeWorkspace()?.currency ?? 'USD'),
      nowMs,
    }),
    [finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees, projects, tasks, ads, inventoryItems, stockMovements, chats, calls, leaveRequests, fundraising, knowledge, kbQuestions, runsSummary, revenueTracks, budgets, filings, posts, webhooks, mcpServers, kpiGroups, tickets, settings, nowMs, activeWorkspace],
  );

  // Conversational memory: follow-ups ("tell me more", "what should I do",
  // "thanks") resolve against the last topic we talked about.
  const [memory, setMemory] = useState<AdvisorMemory>({ topic: null });

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    setQa((prev) => [...prev.slice(-5), { q, a: answerAdvisorQuestion(q, advisorCtx, memory) }]);
    // A fresh topic takes over; a bare follow-up keeps the previous one.
    const topic = routeAdvisorTopic(q);
    if (topic) setMemory({ topic });
    setDraft('');
  };

  // Live keyword hints: as the owner types, surface the topics they are
  // describing so one tap asks the right question.
  const hints = useMemo(() => {
    const t = draft.trim();
    if (t.length < 3) return [];
    if (ADVISOR_SUGGESTIONS.some((s) => s.toLowerCase() === t.toLowerCase())) return [];
    return detectAdvisorTopics(t)
      .slice(0, 3)
      .map((id) => ({ id, ...ADVISOR_TOPIC_META[id] }));
  }, [draft]);

  const go = (link: NonNullable<BusinessInsight['link']>) => {
    setOpen(false);
    setTeaser(null);
    window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: link.page, tab: link.tab } }));
  };

  const showTeaser = useCallback((t: Teaser) => {
    lastTeaserAtRef.current = Date.now();
    setTeaser(t);
    setWiggleKey((k) => k + 1); // wiggle the avatar on every popup
    if (teaserTimerRef.current) clearTimeout(teaserTimerRef.current);
    teaserTimerRef.current = setTimeout(() => setTeaser(null), TEASER_LIFE_MS);
  }, []);

  useEffect(() => () => { if (teaserTimerRef.current) clearTimeout(teaserTimerRef.current); }, []);

  const openWith = (question?: string) => {
    setTeaser(null);
    setOpen(true);
    if (question) ask(question);
  };

  const nudgeFor = (p: string): Teaser => {
    const n = PAGE_NUDGES[p] ?? PAGE_NUDGES.overview;
    return {
      id: `nudge-${p}-${tab ?? 'main'}`,
      kind: 'nudge',
      title: n.blurb,
      body: `Ask me: "${n.question}" — or anything else about this page.`,
      actions: [
        { label: n.cta, run: () => openWith(n.question) },
        { label: 'Just browsing', run: () => setTeaser(null) },
      ],
    };
  };

  // Greeting on first visit + on every page open.
  const pageKey = `${page}:${tab ?? ''}`;
  const firstPageRef = useRef(true);
  useEffect(() => {
    if (open) return;
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    let greeted = false;
    try { greeted = localStorage.getItem(`borga:advisor:greeted:${ws}`) === '1'; } catch { /* private mode */ }
    if (!greeted && firstPageRef.current) {
      firstPageRef.current = false;
      try { localStorage.setItem(`borga:advisor:greeted:${ws}`, '1'); } catch { /* private mode */ }
      const t = setTimeout(() => {
        if (open) return;
        showTeaser({
          id: 'greeting-first',
          kind: 'greeting',
          title: `${part}, ${userName}! I watch every menu for you.`,
          body: urgent > 0
            ? `${urgent} thing${urgent === 1 ? '' : 's'} need${urgent === 1 ? 's' : ''} your attention — want the rundown?`
            : 'Everything looks calm — ask me anything, or take the morning brief.',
          actions: [
            { label: urgent > 0 ? 'Show me' : 'Morning brief', run: () => openWith(urgent > 0 ? 'Morning brief' : 'Morning brief') },
            { label: 'Later', run: () => setTeaser(null) },
          ],
        });
      }, 1500);
      return () => clearTimeout(t);
    }
    firstPageRef.current = false;
    // Every page open gets its contextual thought-process question.
    const t = setTimeout(() => {
      if (open) return;
      if (Date.now() - lastTeaserAtRef.current < 20_000) return; // don't stack popups
      showTeaser(nudgeFor(page));
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, ws]);

  // Things that need attention: surface the top critical/watch item once.
  useEffect(() => {
    if (open || !visible.length) return;
    const top = visible.find((i) => i.severity === 'critical' || i.severity === 'watch');
    if (!top || seenAttentionRef.current.has(top.id)) return;
    seenAttentionRef.current.add(top.id);
    const t = setTimeout(() => {
      if (open) return;
      if (Date.now() - lastTeaserAtRef.current < 20_000) {
        // Re-try shortly so reminders never get swallowed by a nudge.
        setTimeout(() => {
          if (!open) showTeaser({
            id: `attention-${top.id}`,
            kind: 'attention',
            title: top.title,
            body: `${top.detail} ${top.action}`,
            actions: [
              ...(top.link ? [{ label: 'Take me there', run: () => go(top.link as NonNullable<BusinessInsight['link']>) }] : []),
              { label: 'Dismiss', run: () => setTeaser(null) },
            ],
          });
        }, 21_000);
        return;
      }
      showTeaser({
        id: `attention-${top.id}`,
        kind: 'attention',
        title: top.title,
        body: `${top.detail} ${top.action}`,
        actions: [
          ...(top.link ? [{ label: 'Take me there', run: () => go(top.link as NonNullable<BusinessInsight['link']>) }] : []),
          { label: 'Dismiss', run: () => setTeaser(null) },
        ],
      });
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((i) => i.id).join(','), open]);

  // Celebration / encouragement when everything is calm.
  useEffect(() => {
    if (open || celebratedRef.current || urgent > 0 || !insights.length) return;
    celebratedRef.current = true;
    const positives = insights.filter((i) => i.severity === 'positive');
    const t = setTimeout(() => {
      if (open || Date.now() - lastTeaserAtRef.current < 20_000) return;
      showTeaser({
        id: 'celebration-calm',
        kind: 'celebration',
        title: 'All clear — nice work!',
        body: positives.length
          ? `${positives[0].title}. ${positives[0].action}`
          : 'Nothing needs action anywhere. Keep the momentum going.',
        actions: [
          { label: 'Morning brief', run: () => openWith('Morning brief') },
          { label: 'Thanks!', run: () => setTeaser(null) },
        ],
      });
    }, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urgent, insights.length, open]);

  // Pop questions / idle reminders after 45s with quick actions.
  useEffect(() => {
    const id = setInterval(() => {
      if (open || teaser || hidden) return;
      if (Date.now() - lastActiveRef.current < IDLE_MS) return;
      if (idleCountRef.current >= 3) return; // max 3 nudges per session
      if (Date.now() - lastIdleAtRef.current < 3 * 60_000) return;
      idleCountRef.current++;
      lastIdleAtRef.current = Date.now();
      const top = visible.find((i) => i.severity === 'critical' || i.severity === 'watch');
      showTeaser({
        id: `idle-${idleCountRef.current}`,
        kind: 'idle',
        title: top ? `Still here? ${top.title}` : 'Still here? Quick check-in',
        body: top ? top.action : 'Want a 30-second brief on anything that changed?',
        actions: [
          { label: 'Morning brief', run: () => openWith('Morning brief') },
          ...(top?.link ? [{ label: 'Take me there', run: () => go(top.link as NonNullable<BusinessInsight['link']>) }] : []),
          { label: 'Dismiss', run: () => setTeaser(null) },
        ],
      });
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, teaser, hidden, visible.map((i) => i.id).join(',')]);

  // Esc dismisses the panel and any popup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setTeaser(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A new urgent item wiggles the avatar.
  const prevUrgent = useRef(urgent);
  useEffect(() => {
    if (urgent > prevUrgent.current) setWiggleKey((k) => k + 1);
    prevUrgent.current = urgent;
  }, [urgent]);

  const talking = open || teaser !== null;
  const mood: AdvisorMood = teaser?.kind === 'celebration' && !open ? 'celebrating' : talking ? 'talking' : urgent > 0 ? 'worried' : 'happy';
  const nudge = PAGE_NUDGES[page] ?? PAGE_NUDGES.overview;

  if (hidden) {
    return (
      <button
        onClick={() => setHidden(false)}
        className="fixed bottom-5 left-5 z-40 flex h-11 w-11 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-lg transition-transform hover:scale-105 hover:text-foreground active:scale-95"
        title="Show business advisor"
        aria-label="Show business advisor"
      >
        <MessageCircle className="h-5 w-5" />
      </button>
    );
  }

  const TeaserIcon = teaser ? KIND_ICON[teaser.kind] : MessageCircleQuestion;

  return (
    <>
      {open && (
        <Card className="borga-teaser-in fixed bottom-24 left-5 z-40 flex max-h-[70vh] w-[min(400px,92vw)] flex-col overflow-hidden shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-primary" /> Business advisor
              {urgent > 0 && <Badge className="bg-amber-500/10 text-[10px] text-amber-600">{urgent} need{urgent === 1 ? 's' : ''} action</Badge>}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => void refresh()} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Refresh advisories">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button onClick={() => setHidden(true)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Hide advisor (chat button restores it)">
                <EyeOff className="h-4 w-4" />
              </button>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Close (Esc)">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="border-b bg-muted/30 px-4 py-2">
            <p className="text-[11px] text-muted-foreground">
              Contextual help — you are on <span className="font-semibold text-foreground">{page}{tab ? ` / ${tab}` : ''}</span>. Try: <button onClick={() => ask(nudge.question)} className="font-medium text-primary hover:underline">“{nudge.question}”</button>
            </p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {qa.length > 0 && (
              <div className="space-y-2">
                {qa.map((t, n) => (
                  <div key={n} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <p className="text-xs font-semibold">{t.q}</p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">{t.a.text}</p>
                    {t.a.link && (
                      <Button size="sm" variant="outline" className="mt-2 h-7 gap-1 text-[11px]" onClick={() => go(t.a.link as NonNullable<BusinessInsight['link']>)}>
                        Open <ArrowUpRight className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {visible.length === 0 && qa.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                All clear — no advisories right now. Ask me anything below, or pick a suggestion.
              </p>
            )}
            {visible.length === 0 && qa.length > 0 && (
              <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                All advisories dismissed until reload.
              </p>
            )}
            {visible.map((i) => (
              <div key={i.id} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[i.severity])} />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{i.area}</span>
                  {i.metric && <span className={cn('ml-auto text-[11px] font-semibold', SEVERITY_TEXT[i.severity])}>{i.metric}</span>}
                  <button
                    onClick={() => setDismissed((d) => new Set(d).add(i.id))}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Dismiss until reload"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <p className="mt-1.5 text-sm font-medium leading-snug">{i.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{i.detail}</p>
                <p className="mt-1.5 text-xs leading-snug"><span className="font-semibold text-primary">Do this: </span>{i.action}</p>
                {i.link && (
                  <Button size="sm" variant="outline" className="mt-2 h-7 gap-1 text-[11px]" onClick={() => go(i.link as NonNullable<BusinessInsight['link']>)}>
                    Open {i.area} <ArrowUpRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="border-t p-2.5">
            {/* Live keyword hints — what the advisor hears in your typing */}
            {hints.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2 py-1.5">
                <Ear className="h-3 w-3 shrink-0 text-primary" />
                {hints.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => ask(h.prompt)}
                    className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-transform hover:scale-105"
                    title={`Ask: ${h.prompt}`}
                  >
                    {h.label}?
                  </button>
                ))}
              </div>
            )}
            {/* Conversational follow-ups for the last answer */}
            {qa.length > 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
                {['Tell me more', 'What should I do?'].map((f) => (
                  <button
                    key={f}
                    onClick={() => ask(f)}
                    className="shrink-0 rounded-full border border-dashed px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {ADVISOR_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') ask(draft); }}
                placeholder="Ask about cash, pipeline, tickets…"
                className="h-9 text-xs"
              />
              <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => ask(draft)} disabled={!draft.trim()} title="Ask the engine">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Popup teaser bubble */}
      {teaser && !open && (
        <div className="borga-teaser-in fixed bottom-24 left-5 z-40 w-[min(320px,88vw)]">
          <Card className="overflow-hidden shadow-xl">
            <div className="flex items-start gap-2.5 p-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
                <TeaserIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold leading-snug">{teaser.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{teaser.body}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {teaser.actions.map((a) => (
                    <Button key={a.label} size="sm" variant={a.label === 'Dismiss' || a.label === 'Later' || a.label === 'Just browsing' || a.label === 'Thanks!' ? 'ghost' : 'default'} className="h-7 px-2.5 text-[11px]" onClick={a.run}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
              <button onClick={() => setTeaser(null)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Dismiss (Esc)">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Animated avatar — a living face with moods */}
      <button
        onClick={() => (open ? setOpen(false) : openWith())}
        className="borga-float fixed bottom-5 left-5 z-40 flex h-14 w-14 items-center justify-center focus:outline-none"
        title={open ? 'Close advisor (Esc)' : `Business advisor${urgent > 0 ? ` (${urgent} need action)` : ''} — click for contextual help`}
        aria-label="Open business advisor"
      >
        <span key={wiggleKey} className={cn('relative flex h-14 w-14 items-center justify-center transition-transform hover:scale-105 active:scale-95', wiggleKey > 0 && 'borga-wiggle')}>
          <AdvisorAvatar mood={mood} size={56} />
          {/* notification dot */}
          {!open && urgent > 0 && (
            <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-background">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" />
              <span className="relative">{urgent}</span>
            </span>
          )}
        </span>
      </button>
    </>
  );
}
