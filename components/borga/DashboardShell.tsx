'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { deriveBusinessInsights, insightsToMemories, syncInsightsToKnowledgeBase } from '@/lib/borga/insights';
import { NAV_PAGES, isPageId, type PageId, type NavTarget } from './nav';
import { ThemeProvider, useTheme } from './theme-provider';
import { CommandPalette } from './CommandPalette';
import { VoiceAssistant } from './VoiceAssistant';
import { useVoice } from './use-voice';
import { BorgaOrb } from './BorgaOrb';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { NewWorkspaceDialog } from './WorkspaceDialogs';
import { PageErrorBoundary } from './PageErrorBoundary';
import { OverviewPage } from './pages/OverviewPage';
import { SalesPage } from './pages/SalesPage';
import { MarketingPage } from './pages/MarketingPage';
import { CommunicationsPage } from './pages/CommunicationsPage';
import { FinancePage } from './pages/FinancePage';
import { ProjectsTab } from './panels/ProjectsTab';
import { HRPage } from './pages/HRPage';
import { CompanyPage } from './pages/CompanyPage';
import { AIPlatformPage } from './pages/AIPlatformPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { SettingsTab } from './panels/SettingsTab';
import { OnboardingStatus } from './OnboardingStatus';

interface ActiveRoute {
  page: PageId;
  tab?: string;
}

function ShellInner() {
  const {
    userName, log, voice, hydrate, synced, dbAvailable, activeWorkspaceId, activeWorkspace,
    finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees,
    memories, addMemory, knowledge, setKnowledge, settings, setSettings,
  } = useBorga();
  const { setMode, resolvedDark } = useTheme();
  const { startListening, stopListening } = useVoice();
  const [route, setRoute] = useState<ActiveRoute>({ page: 'overview' });
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const greeted = useRef(false);
  const autoTrainRef = useRef(false);

  // Persistent learning: once a day (per company), turn live business
  // insights into durable agent memories and refresh the knowledge base so
  // the system keeps improving from what the company's own data shows,
  // without requiring a manual "Train fleet" click every time.
  useEffect(() => {
    if (!synced || autoTrainRef.current) return;
    autoTrainRef.current = true;
    const last = settings.lastAutoTrainAt ? new Date(settings.lastAutoTrainAt).getTime() : 0;
    if (Date.now() - last < 24 * 3600_000) return;
    const insights = deriveBusinessInsights({ finance, invoices, bills, vendors, customers, leads, goals, journals, bankTxns, bankAccounts, employees });
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
  }, [synced]);

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
    if (!synced || !activeWorkspaceId) return;
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
  }, [synced, activeWorkspaceId]);

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
    const msg = `${part}, ${userName}. Borga is online. All systems running smoothly — how can I help today?`;
    log({ agentId: 'a1', agentName: 'Borga', actor: 'system', kind: 'system', message: `Awakened — ${part}, ${userName}.` });
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = 1.02;
      u.pitch = 0.72;
      setTimeout(() => window.speechSynthesis.speak(u), 500);
    }
  }, [userName, log]);

  // Always-listening voice: when "Wake on name" is on in Settings, keep the
  // mic continuously live app-wide (not just while the voice panel is open),
  // auto-restarting through browser silence timeouts, and re-arming itself
  // whenever the tab regains focus (mobile browsers routinely kill an open
  // recognition session when backgrounded).
  useEffect(() => {
    if (!synced || !settings.notifications.voice) return;
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
  }, [synced, settings.notifications.voice, startListening, stopListening]);

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
          {NAV_PAGES.map((n) => {
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
        <div className="border-t p-4 text-xs text-sidebar-foreground/60">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <span>Fleet online — brain linked</span>
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
              {NAV_PAGES.find((p) => p.id === route.page)?.label}
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
            <button
              onClick={() => setMode(isDark ? 'light' : 'dark')}
              className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
              title="Toggle theme"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        {/* Mobile nav bar */}
        <div className="sticky top-14 z-20 flex gap-1 overflow-x-auto border-b bg-background/80 px-2 py-2 backdrop-blur lg:hidden">
          {NAV_PAGES.map((n) => {
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

        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <PageErrorBoundary key={route.page} pageName={NAV_PAGES.find((p) => p.id === route.page)?.label ?? route.page}>
              {route.page === 'overview' && <OverviewPage key={`ov-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'sales' && <SalesPage key={`sa-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'marketing' && <MarketingPage key={`mk-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'communications' && <CommunicationsPage key={`co-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'finance' && <FinancePage key={`fi-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'projects' && <ProjectsTab key={`pr-${route.tab ?? ''}`} initialProjectId={route.tab} />}
              {route.page === 'hr' && <HRPage key={`hr-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'company' && <CompanyPage key={`cp-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'ai' && <AIPlatformPage key={`ai-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'integrations' && <IntegrationsPage key={`in-${route.tab ?? ''}`} initialTab={route.tab} />}
              {route.page === 'settings' && <SettingsTab />}
            </PageErrorBoundary>
          </div>
        </main>
      </div>

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

      <CommandPalette onOpenVoice={() => setVoiceOpen(true)} />
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
