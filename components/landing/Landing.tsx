'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight, Sparkles, Boxes, TrendingUp, Users, Bot, ShieldCheck,
  BarChart4, Megaphone, Wallet, Building2, Gauge, FolderKanban, Mic, PhoneCall,
} from 'lucide-react';

const FEATURES = [
  { icon: TrendingUp, title: 'Unified sales & pipeline', desc: 'Kanban deals, account intelligence and AI-written proposals that close.' },
  { icon: Megaphone, title: 'Marketing & growth', desc: 'Multi-channel scheduling, paid-campaign ROAS and generative content.' },
  { icon: Wallet, title: 'Finance & reporting', desc: 'Double-entry ledger, banking reconciliation and one-click financials.' },
  { icon: Gauge, title: 'Budgeting & forecasting', desc: 'Financial-statement-style budgets with run-rate forecasts and annual budget-vs-actuals reporting.' },
  { icon: FolderKanban, title: 'Project management', desc: 'Boards, milestones and team assignments with per-project budgets tracked against actual spend.' },
  { icon: Users, title: 'People & HR', desc: 'Directory, time-off, teams and org planning in one place.' },
  { icon: Bot, title: 'Agent fleet', desc: 'Specialist AI agents across every department, brain-linked and ready.' },
  { icon: Mic, title: 'Always-listening voice assistant', desc: 'Hands-free control with wake-word activation — say "Borga" and speak your command.' },
  { icon: PhoneCall, title: 'AI-voiced outbound calling', desc: 'Agents place real calls over Twilio with natural ElevenLabs voices, logged and tracked automatically.' },
  { icon: BarChart4, title: 'Live valuation', desc: 'A dynamic, industry-aware valuation model that grows with your data.' },
  { icon: ShieldCheck, title: 'Secure by default', desc: 'Account authentication, per-company isolation and E2E encrypted chat.' },
  { icon: Building2, title: 'Multi-company workspaces', desc: 'Run every entity you own as its own scoped, isolated tenant.' },
];

const STATS = [
  { label: 'Departments automated', value: 12 },
  { label: 'AI agents on fleet', value: 16 },
  { label: 'Modules included', value: 11 },
];

function useCountUp(target: number, ms = 1200) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

function Stat({ label, value }: { label: string; value: number }) {
  const n = useCountUp(value);
  return (
    <div className="text-center">
      <div className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">{n}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

export function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <style>{`
        @keyframes borgaFloat { 0%,100% { transform: translateY(0) translateX(0); } 50% { transform: translateY(-26px) translateX(12px); } }
        @keyframes borgaFloatSlow { 0%,100% { transform: translateY(0); } 50% { transform: translateY(34px); } }
        @keyframes borgaSpin { to { transform: rotate(360deg); } }
        @keyframes borgaRise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes borgaGradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        .lf-float { animation: borgaFloat 9s ease-in-out infinite; }
        .lf-float-slow { animation: borgaFloatSlow 12s ease-in-out infinite; }
        .lf-spin { animation: borgaSpin 28s linear infinite; }
        .lf-rise { animation: borgaRise 0.8s cubic-bezier(.2,.7,.2,1) both; }
        .lf-rise-2 { animation: borgaRise 0.8s cubic-bezier(.2,.7,.2,1) 0.12s both; }
        .lf-rise-3 { animation: borgaRise 0.8s cubic-bezier(.2,.7,.2,1) 0.24s both; }
        .lf-gradient { background-image: linear-gradient(120deg,#6366f1,#0ea5e9,#059669,#f59e0b,#ec4899); background-size: 300% 300%; animation: borgaGradient 14s ease infinite; }
      `}</style>

      {/* Animated background orbs — kept at the edges and low opacity so they
          never wash over the hero content. */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="lf-gradient absolute -left-40 -top-40 h-96 w-96 rounded-full opacity-10 blur-3xl lf-float" />
        <div className="lf-gradient absolute right-[-14rem] top-24 h-[26rem] w-[26rem] rounded-full opacity-[0.06] blur-3xl lf-float-slow" />
        <div className="absolute bottom-[-14rem] left-1/4 h-80 w-80 rounded-full bg-primary/20 opacity-10 blur-3xl lf-float" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.05),transparent_60%)]" />
      </div>

      {/* Nav */}
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">Borga</span>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">Product</a>
          <a href="#stats" className="transition-colors hover:text-foreground">Why Borga</a>
          <Link href="/developers" className="transition-colors hover:text-foreground">Developers</Link>
          <Link href="/login" className="transition-colors hover:text-foreground">Sign in</Link>
        </nav>
        <Link href="/signup" className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90">
          Get started
        </Link>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-16 pt-12 sm:pt-20">
        <div className="lf-rise inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-primary" /> The AI Company OS — now with accounts & onboarding
        </div>
        <h1 className="lf-rise-2 mt-6 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
          Run your whole company on one{' '}
          <span className="lf-gradient bg-clip-text text-transparent">agent-powered</span> operating system.
        </h1>
        <p className="lf-rise-2 mt-6 max-w-2xl text-lg text-muted-foreground">
          Borga unifies sales, marketing, finance, HR, communications and a live company valuation —
          scoped per workspace, grounded by a knowledge base your agents actually use.
        </p>
        <div className="lf-rise-3 mt-9 flex flex-wrap items-center gap-4">
          <Link href="/signup" className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:opacity-90">
            Create your workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link href="/login" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold transition hover:bg-card">
            I already have an account
          </Link>
        </div>

        {/* floating chip row */}
        <div className="lf-rise-3 mt-12 flex flex-wrap gap-3 text-sm">
          {['AI agents', 'Voice control', 'Outbound calling', 'Budgeting', 'Valuation model', 'E2E chat', 'Multi-company'].map((c) => (
            <span key={c} className="rounded-full border border-border bg-card/50 px-3 py-1.5 text-muted-foreground backdrop-blur">
              {c}
            </span>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section id="stats" className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid grid-cols-3 gap-6 rounded-3xl border border-border bg-card/40 p-8 backdrop-blur">
          {STATS.map((s) => <Stat key={s.label} {...s} />)}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-14">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">One OS. Every operational area.</h2>
          <p className="mt-3 text-muted-foreground">Expanded KPIs and workflows across all twelve functional departments.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="lf-rise group rounded-2xl border border-border bg-card/50 p-5 transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl" style={{ animationDelay: `${i * 60}ms` }}>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="lf-gradient relative overflow-hidden rounded-3xl p-10 text-center text-white shadow-2xl sm:p-16">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20 lf-spin" />
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Start your company OS today.</h2>
          <p className="relative mt-3 text-white/80">Free to start. Your data stays isolated to your account.</p>
          <Link href="/signup" className="relative mt-7 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-primary shadow transition hover:opacity-90">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        Borga — AI Company OS. Built for operators who want their whole business in one place.
        <span className="mx-2">·</span>
        <Link href="/developers" className="transition-colors hover:text-foreground">API & Developers</Link>
      </footer>
    </main>
  );
}
