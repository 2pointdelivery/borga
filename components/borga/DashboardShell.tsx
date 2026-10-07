'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  X,
  Sparkles,
  Bot,
  Sun,
  Moon,
  Loader2,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast-bus';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { deriveBusinessInsights, insightsToMemories, syncInsightsToKnowledgeBase } from '@/lib/borga/insights';
import { isPageId, type PageId, type NavTarget } from './nav';
import { useVisibleNav } from './use-visible-nav';
import { useCrmPull } from './use-crm-pull';
import { useAgentActivity } from './use-agent-activity';
import { useSaltEdgeReturn } from './use-saltedge-return';
import { BillingBanner, BillingPaywall, useBillingReturn } from './BillingGate';
import { notifyEmail } from '@/lib/borga/email-client';
import { useFeatures } from '@/lib/borga/features-client';
import { ThemeProvider, useTheme } from './theme-provider';
import { CommandPalette } from './CommandPalette';
import { AdvisoryWidget } from './AdvisoryWidget';
import { VoiceAssistant } from './VoiceAssistant';
import { useVoiceSetup } from '@/components/borga/use-voice-setup';
import { useVoice } from './use-voice';
import { BorgaOrb } from './BorgaOrb';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NewWorkspaceDialog } from './WorkspaceDialogs';
import { PageErrorBoundary } from './PageErrorBoundary';
import { OverviewPage } from './pages/OverviewPage';
import { SalesPage } from './pages/SalesPage';
import { MarketingPage } from './pages/MarketingPage';
import { CommunicationsPage } from './pages/CommunicationsPage';
import { SupportPage } from './pages/SupportPage';
import { FinancePage } from './pages/FinancePage';
import { InventoryPage } from './pages/InventoryPage';
import { ProjectsTab } from './panels/ProjectsTab';
import { HRPage } from './pages/HRPage';
import { CompanyPage } from './pages/CompanyPage';
import { AIPlatformPage } from './pages/AIPlatformPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { DevelopersPage } from './pages/DevelopersPage';
import { SettingsTab } from './panels/SettingsTab';
import { OnboardingStatus } from './OnboardingStatus';
import { UserMenu } from './UserMenu';
import { CalendarWidget, RightRail, StatusBar } from './SidebarWidgets';

import { SaveConflictBanner } from './SaveConflictBanner';
import { ConsentBanner } from './ConsentBanner';
interface ActiveRoute {
  page: PageId;
  tab?: string;
}

function ShellInner() {
  const {
    userName, log, voice, hydrate, synced, dbAvailable, activeWorkspaceId, activeWorkspace,
    finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees,
    memories, addMemory, knowledge, setKnowledge, settings, setSettings, agents, llm, llmCatalog,
    projects, tasks, ads, inventoryItems, stockMovements, chats, calls, leaveRequests, fundraising,
    kbQuestions, revenueTracks, budgets, filings, posts, webhooks, mcpServers, kpiGroups,
    scheduledTasks, agentRuns, loadedWorkspaceId,
  } = useBorga();
  // `synced` turns true once the company list is known; the company's own data arrives after. Background jobs that read or write
  // that data must wait for it, or they act on seed values and their saves are refused (or worse, overwrite real data).
  const dataReady = synced && !!activeWorkspaceId && loadedWorkspaceId === activeWorkspaceId;
  const { setMode, resolvedDark } = useTheme();
  // What the AI actually is right now: the selected provider (Pollinations works out of the box, no key).
  const aiLabel = llmCatalog.find((p) => p.id === llm.providerId)?.label ?? llm.providerId;
  const { startListening, stopListening } = useVoice();
  // keeps the stored "ElevenLabs connected" flag equal to what the server finds (the key is tried, not just present)
  useVoiceSetup();
  const [route, setRoute] = useState<ActiveRoute>({ page: 'overview' });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const runRecurringInvoices = useBorga((s) => s.runRecurringInvoices);
  const runRecurringBills = useBorga((s) => s.runRecurringBills);
  const crmAutoPull = settings.crmAutoPull === true;
  const pullCrm = useCrmPull();
  const navPages = useVisibleNav();
  const billing = useBorga((s) => s.billing);
  // back from Stripe Checkout: lift the paywall as soon as the payment is confirmed
  useBillingReturn();
  // back from the bank (Salt Edge): import what it returned and show Banking
  useSaltEdgeReturn(useCallback(() => setRoute({ page: 'finance', tab: 'banking' }), []));

  // Company Engine: keep customers and deals in step with the company CRM while the dashboard is open.
  useEffect(() => {
    if (!dataReady || !crmAutoPull) return;
    const t0 = setTimeout(() => void pullCrm(), 4000);
    const t = setInterval(() => void pullCrm(), 30 * 60_000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [dataReady, crmAutoPull, activeWorkspaceId, pullCrm]);

  // Recurring billing: create any invoices that came due. It runs when the dashboard opens, every
  // 30 minutes while it stays open, and when the tab regains focus. The schedule is advanced and the
  // draft invoices are written in the same store update, so a repeat run never duplicates one.
  useEffect(() => {
    if (!dataReady) return;
    const tick = () => {
      const bills = runRecurringBills();
      if (bills.created) notifyEmail(activeWorkspaceId, 'recurring_bills', { numbers: bills.bills });
      if (bills.created) toast({ title: bills.created + ' recurring bill' + (bills.created === 1 ? '' : 's') + ' recorded', description: bills.bills.join(', ') + ' — unpaid; review under Finance → Vendors & AP.', variant: 'success' });
      const r = runRecurringInvoices();
      if (r.created) notifyEmail(activeWorkspaceId, 'recurring_invoices', { numbers: r.invoices });
      if (r.created) toast({ title: r.created + ' recurring invoice' + (r.created === 1 ? '' : 's') + ' drafted', description: r.invoices.join(', ') + ' — review and send under Sales → Invoicing.', variant: 'success' });
    };
    tick();
    const t = setInterval(tick, 30 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [dataReady, activeWorkspaceId, runRecurringInvoices, runRecurringBills]);
  useAgentActivity(dataReady);
  const voiceEnabled = useFeatures((s) => s.flags.voice);
  const widgetsEnabled = useFeatures((s) => s.flags.widgets);
  const advisorEnabled = useFeatures((s) => s.flags.advisor);
  const loadFeatures = useFeatures((s) => s.load);
  const greeted = useRef(false);

  useEffect(() => {
    if (synced && activeWorkspaceId) void loadFeatures(activeWorkspaceId);
  }, [synced, activeWorkspaceId, loadFeatures]);

  // A page switched off while open falls back to the overview instead of rendering a dead route.
  useEffect(() => {
    if (!navPages.some((p) => p.id === route.page)) setRoute({ page: 'overview' });
  }, [navPages, route.page]);
  const autoTrainRef = useRef(false);

  // Persistent learning: once a day (per company), turn live business
  // insights into durable agent memories and refresh the knowledge base so
  // the system keeps improving from what the company's own data shows,
  // without requiring a manual "Train fleet" click every time.
  useEffect(() => {
    if (!dataReady || autoTrainRef.current) return;
    autoTrainRef.current = true;
    const last = settings.lastAutoTrainAt ? new Date(settings.lastAutoTrainAt).getTime() : 0;
    if (Date.now() - last < 24 * 3600_000) return;
    const insights = deriveBusinessInsights({
      finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees, projects, tasks, ads, inventoryItems, stockMovements,
      chats, calls, leaveRequests, fundraising, knowledge, kbOpenQuestions: kbQuestions.length,
      runsSummary: {
        failed: agentRuns.filter((r) => r.status === 'error').length,
        scheduledActive: scheduledTasks.filter((t) => t.enabled).length,
      },
      revenueTracks, budgets, filings, posts, webhooks, mcpServers, kpiGroups,
    });
    if (insights.length === 0) return;
    const wsName = activeWorkspace()?.name ?? 'the company';
    const freshMemories = insightsToMemories(insights, wsName).filter((m) => !memories.some((x) => x.content === m.content));
    freshMemories.forEach(addMemory);
    setKnowledge(syncInsightsToKnowledgeBase(insights, knowledge));
    setSettings({ lastAutoTrainAt: new Date().toISOString() });
    if (freshMemories.length > 0) {
      log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'system', kind: 'learn', message: `Daily auto-training: learned ${freshMemories.length} new insight(s) and refreshed ${insights.length} knowledge-base entries from live data.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string | NavTarget;
      // Accept either "page" strings or { page, tab } deep links.
      if (typeof detail === 'string') {
        if (isPageId(detail)) setRoute({ page: detail });
      } else if (detail && isPageId(detail.page)) {
        setRoute({ page: detail.page, tab: detail.tab });
      }
    };
    window.addEventListener('borga:nav', handler);
    return () => window.removeEventListener('borga:nav', handler);
  }, []);

  // Persistent automations: while the app is open, poll the server-side scheduler
  // so enabled recurring tasks actually fire on their cadence instead of only
  // running when someone manually clicks "Run now". This is app-open automation,
  // not a true server cron — a task due while nobody has the dashboard open waits
  // until the next time someone opens it.
  useEffect(() => {
    if (!dataReady) return;
    const runTick = () => {
      fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'tick', ws: activeWorkspaceId }),
      }).catch(() => {});
    };
    runTick();
    const id = window.setInterval(runTick, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [dataReady, activeWorkspaceId]);

  // Hydrate DB-backed state (workspaces + the active company's entities).
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Re-hydrate when switching companies so every module reflects that tenant.
  useEffect(() => {
    if (greeted.current) hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Greet on wake
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Awakened — ${part}, ${userName}.` });
  }, [userName, log]);

  // Spoken greeting: only for people who turned voice on (Settings). Nothing plays, and no microphone is requested, on a fresh install.
  const spoke = useRef(false);
  useEffect(() => {
    if (!synced || spoke.current || !voiceEnabled || !settings.notifications.voice) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    spoke.current = true;
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    const u = new SpeechSynthesisUtterance(`${part}, ${userName}. Borga is listening — how can I help today?`);
    u.rate = 1.02;
    u.pitch = 0.72;
    const t = setTimeout(() => window.speechSynthesis.speak(u), 500);
    return () => clearTimeout(t);
  }, [synced, voiceEnabled, settings.notifications.voice, userName]);

  // Always-listening voice: when "Wake on name" is on in Settings, keep the
  // mic continuously live app-wide (not just while the voice panel is open),
  // auto-restarting through browser silence timeouts, and re-arming itself
  // whenever the tab regains focus (mobile browsers routinely kill an open
  // recognition session when backgrounded).
  useEffect(() => {
    if (!synced || !voiceEnabled || !settings.notifications.voice) return;
    // Give the wake greeting a moment to finish so the mic doesn't transcribe it.
    const startDelay = setTimeout(() => startListening(), 2500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') startListening();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(startDelay);
      document.removeEventListener('visibilitychange', onVisible);
      stopListening();
    };
  }, [synced, voiceEnabled, settings.notifications.voice, startListening, stopListening]);

  const isDark = resolvedDark;

  if (!synced) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  const activeWs = activeWorkspace();
  if (!activeWs) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="max-w-md p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bot className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-lg font-bold">No company yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Create your first company workspace to start using Borga.</p>
          <div className="mt-5 flex justify-center">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create a company
            </Button>
          </div>
          <NewWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <SaveConflictBanner />
      <ConsentBanner />
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold leading-none">Borga</p>
            <p className="text-[11px] text-sidebar-foreground/60">Company OS</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 pb-3">
          {navPages.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => setRoute({ page: n.id })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  route.page === n.id
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
              >
                <Icon className="h-4 w-4" /> {n.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-3 px-3 pb-3 2xl:hidden">
          {widgetsEnabled && <CalendarWidget />}
        </div>
        <div className="border-t p-4 text-xs text-sidebar-foreground/60">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', dbAvailable ? 'bg-emerald-500' : 'bg-amber-500')} />
            <span title={dbAvailable ? 'Your data is saved to the database.' : 'The database is not reachable, so changes are only saved on this device.'}>
              {dbAvailable ? `${agents.length} agents · AI: ${aiLabel}` : 'Offline: saved on this device only'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
              <Bot className="h-4 w-4" />
            </span>
            <WorkspaceSwitcher />
            <h1 className="hidden text-sm font-semibold md:block">
              {navPages.find((p) => p.id === route.page)?.label}
            </h1>
            <span
              title={dbAvailable ? 'Changes synced to the cloud database' : 'Running in local mode — cloud database unreachable'}
              className={cn(
                'hidden items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium ring-1 sm:flex',
                dbAvailable ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/25' : 'bg-amber-500/10 text-amber-600 ring-amber-500/25',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', dbAvailable ? 'bg-emerald-500' : 'bg-amber-500')} />
              {dbAvailable ? 'Synced' : 'Local mode'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {voiceEnabled && (
            <button
                onClick={() => setVoiceOpen((v) => !v)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors hover:bg-accent',
                  voice.listening && 'bg-primary/10 text-primary',
                )}
              >
                <Mic className="h-4 w-4" />
                <span className="hidden sm:inline">{voice.listening ? 'Listening…' : 'Borga'}</span>
              </button>
            )}
            <button
              onClick={() => setMode(isDark ? 'light' : 'dark')}
              className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
              title="Toggle theme"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <UserMenu />
          </div>
        </header>

        {/* Mobile nav bar */}
        <div className="sticky top-14 z-20 flex gap-1 overflow-x-auto border-b bg-background/80 px-2 py-2 backdrop-blur lg:hidden">
          {navPages.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => setRoute({ page: n.id })}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
                  route.page === n.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {n.label}
              </button>
            );
          })}
        </div>

        <OnboardingStatus />

        <div className="flex flex-1">
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <BillingBanner />
            {billing?.access === 'blocked' ? <BillingPaywall /> : (
            <PageErrorBoundary key={route.page} pageName={navPages.find((p) => p.id === route.page)?.label ?? route.page}>
              {route.page === 'overview' && <OverviewPage key={`ov-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'sales' && <SalesPage key={`sa-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'marketing' && <MarketingPage key={`mk-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'communications' && <CommunicationsPage key={`co-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'support' && <SupportPage key={`su-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'finance' && <FinancePage key={`fi-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'inventory' && <InventoryPage key={`inv-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'projects' && <ProjectsTab key={`pr-${route.tab ?? ''}`} initialProjectId={route.tab} />}
              {route.page === 'hr' && <HRPage key={`hr-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'company' && <CompanyPage key={`cp-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'ai' && <AIPlatformPage key={`ai-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'integrations' && <IntegrationsPage key={`in-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'developers' && <DevelopersPage key={`dev-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'settings' && <SettingsTab />}
            </PageErrorBoundary>
            )}
          </div>
        </main>
        {widgetsEnabled && <RightRail />}
        </div>
        <StatusBar />
      </div>

      {voiceEnabled && (
        <>
      {/* Voice panel */}
      <div
        className={cn(
          'fixed right-0 top-0 z-40 h-full w-[min(400px,92vw)] border-l bg-background/95 backdrop-blur transition-transform duration-300',
          voiceOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Voice Assistant
          </span>
          <button onClick={() => setVoiceOpen(false)} className="rounded-lg p-1.5 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>
        <VoiceAssistant expanded />
      </div>
      {voiceOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setVoiceOpen(false)} />}

      {/* Floating voice orb */}
      <button
        onClick={() => setVoiceOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95"
        title="Talk to Borga"
        aria-label="Open voice assistant"
      >
        <BorgaOrb size={64} active={voice.listening} thinking={voice.thinking ?? false} />
      </button>
        </>
      )}

      <CommandPalette onOpenVoice={() => setVoiceOpen(true)} />
      {advisorEnabled && <AdvisoryWidget page={route.page} tab={route.tab} />}
    </div>
  );
}

export function DashboardShell() {
  return (
    <ThemeProvider>
      <ShellInner />
    </ThemeProvider>
  );
}
