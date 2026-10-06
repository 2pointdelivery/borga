'use client';

import { useRef, useState } from 'react';
import {
  ArrowRight, Sparkles, Boxes, TrendingUp, Users, Bot, ShieldCheck, ChevronDown,
  Megaphone, Wallet, Building2, Menu, X, Globe2, Lock, Zap,
} from 'lucide-react';
import { CookieBanner } from '@/components/CookieBanner';
import { SiteFooter } from '@/components/SiteFooter';

// Static-export mirror of components/landing/Landing.tsx in the main app,
// built to be deployed on GitHub Pages (static files only — no API routes,
// DB or session auth, which the real dashboard needs). "Sign in" /
// "Get started" point at the live app; set NEXT_PUBLIC_APP_URL at build time.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://borga.example.com';

const NAV = [
  {
    label: 'Product', links: [
      { label: 'Sales command', href: '#product' },
      { label: 'Marketing reach', href: '#product' },
      { label: 'Finance control', href: '#product' },
      { label: 'Agent fleet', href: '#product' },
      { label: 'Company value', href: '#product' },
    ],
  },
  {
    label: 'Customers', links: [
      { label: 'Why Borga', href: '#stats' },
      { label: 'Services', href: '#services' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    label: 'Company', links: [
      { label: 'About us', href: '#about' },
      { label: 'Contact', href: '#contact' },
      { label: 'Legal', href: '/privacy' },
    ],
  },
];

/** Numbered hero tabs (emons pattern): each re-themes the 3D scene. */
const TABS = [
  { n: '01', title: 'Sales command', desc: 'Pipeline, accounts and AI-written proposals that close.', accent: '#0ea5e9', chips: ['Kanban deals', 'Proposals', 'Forecasts'] },
  { n: '02', title: 'Marketing reach', desc: 'Social scheduling, paid ROAS and generative content.', accent: '#ec4899', chips: ['Social posts', 'Campaigns', 'AI drafts'] },
  { n: '03', title: 'Finance control', desc: 'Double-entry ledger, budgets and one-click financials.', accent: '#059669', chips: ['Ledger', 'Budgets', 'Reports'] },
  { n: '04', title: 'Agent fleet', desc: 'Specialists across every department, always on.', accent: '#8b5cf6', chips: ['Nova', 'Ledger', 'Atlas'] },
  { n: '05', title: 'Company value', desc: 'Live valuation that grows with your data.', accent: '#f59e0b', chips: ['Multiples', 'Growth', 'Comps'] },
];

const STATS = [
  { value: '12', label: 'Departments automated' },
  { value: '16', label: 'AI agents on fleet' },
  { value: '11', label: 'Modules included' },
  { value: '3', label: 'Regulatory regions covered' },
];

const SERVICES = [
  { icon: TrendingUp, title: 'Sales', desc: 'Kanban deals, account intelligence and proposals.' },
  { icon: Megaphone, title: 'Marketing', desc: 'Multi-channel scheduling and generative content.' },
  { icon: Wallet, title: 'Finance', desc: 'Double-entry ledger and one-click financials.' },
  { icon: Users, title: 'People', desc: 'Directory, time-off and org planning.' },
  { icon: Bot, title: 'Agents', desc: 'A brain-linked fleet across every department.' },
  { icon: Globe2, title: 'Communications', desc: 'Inbox, chat, voice and outbound calling.' },
  { icon: Building2, title: 'Company', desc: 'Multi-entity workspaces and live valuation.' },
  { icon: ShieldCheck, title: 'Trust', desc: 'Isolation, approvals and regional privacy.' },
];

const FAQS = [
  { q: 'What is Borga?', a: 'Borga is an AI company operating system: sales, marketing, finance, HR, communications and a live valuation in one workspace, operated by a fleet of specialist AI agents.' },
  { q: 'How do the AI agents work?', a: 'Each department has specialist agents (Nova for marketing, Ledger for finance, Atlas for strategy…). They read your live company data, propose actions, and anything that sends messages or moves value pauses for your approval first.' },
  { q: 'Is my company data isolated?', a: 'Yes. Every company runs as its own scoped tenant — CRM, ledger, people and agents never leak across workspaces.' },
  { q: 'Which privacy laws do you follow?', a: 'EU GDPR, US state laws (CCPA/CPRA), Canada PIPEDA, Nigeria NDPR, South Africa POPIA and Kenya DPA. Cookie rules differ by region — see the cookie policy linked below.' },
  { q: 'Can I cancel any time?', a: 'Yes. Export your data whenever you like; on termination workspaces stay read-only for 30 days, then are deleted.' },
];

function HeroScene({ accent, chips }: { accent: string; chips: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${x * 14}deg`);
    el.style.setProperty('--rx', `${-y * 12}deg`);
  };
  return (
    <div ref={ref} onMouseMove={onMove} className="hero3d relative mx-auto h-[380px] w-full max-w-[520px] select-none sm:h-[440px]" style={{ perspective: '1200px' }}>
      {/* orbit rings */}
      <div className="hero3d-tilt absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
        <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-foreground/20 ring-a" />
        <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/10 ring-b" />
        <div className="absolute left-1/2 top-1/2 h-[26rem] w-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-foreground/10 ring-c" />
        {/* core */}
        <div
          className="absolute left-1/2 top-1/2 flex h-36 w-36 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[2rem] text-white shadow-2xl core-bob"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)`, transform: 'translate(-50%,-50%) translateZ(70px)' }}
        >
          <Boxes className="h-12 w-12" />
        </div>
        {/* orbiting chips */}
        {chips.map((c, i) => (
          <div
            key={c}
            className="absolute left-1/2 top-1/2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur chip-orbit"
            style={{ ['--orbit' as string]: `${i * 120}deg`, borderTopColor: accent }}
          >
            {c}
          </div>
        ))}
        {/* floating glass cards */}
        <div className="absolute left-2 top-10 rounded-2xl border border-border bg-card/80 p-3 shadow-xl backdrop-blur card-a">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold"><Zap className="h-3 w-3" style={{ color: accent }} /> Pipeline</p>
          <p className="mt-1 font-mono text-lg font-bold">$1.2M</p>
        </div>
        <div className="absolute bottom-12 right-2 rounded-2xl border border-border bg-card/80 p-3 shadow-xl backdrop-blur card-b">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold"><Lock className="h-3 w-3" style={{ color: accent }} /> Approval gate</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Nova waits for you</p>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState(false);
  const active = TABS[tab];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <style>{`
        @keyframes ringSpin { from { transform: translate(-50%,-50%) rotateX(72deg) rotateZ(0deg); } to { transform: translate(-50%,-50%) rotateX(72deg) rotateZ(360deg); } }
        @keyframes coreBob { 0%,100% { margin-top: 0; } 50% { margin-top: -14px; } }
        @keyframes chipOrbit { from { transform: rotate(var(--orbit)) translateX(150px) rotate(calc(-1 * var(--orbit))); } to { transform: rotate(calc(var(--orbit) + 360deg)) translateX(150px) rotate(calc(-1 * (var(--orbit) + 360deg))); } }
        @keyframes cardFloat { 0%,100% { transform: translateY(0) translateZ(40px); } 50% { transform: translateY(-12px) translateZ(40px); } }
        @keyframes rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        .hero3d { --rx: 0deg; --ry: 0deg; }
        .hero3d-tilt { transform: rotateX(var(--rx)) rotateY(var(--ry)); transition: transform 0.25s ease-out; }
        .ring-a { animation: ringSpin 26s linear infinite; }
        .ring-b { animation: ringSpin 40s linear infinite reverse; }
        .ring-c { animation: ringSpin 60s linear infinite; }
        .core-bob { animation: coreBob 5s ease-in-out infinite; }
        .chip-orbit { animation: chipOrbit 18s linear infinite; }
        .card-a { animation: cardFloat 7s ease-in-out infinite; }
        .card-b { animation: cardFloat 8.5s ease-in-out 0.8s infinite; }
        .lf-rise { animation: rise 0.8s cubic-bezier(.2,.7,.2,1) both; }
      `}</style>

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
              <Boxes className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight">Borga</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm md:flex">
            {NAV.map((n) => (
              <div key={n.label} className="group relative">
                <button className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                  {n.label} <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <div className="invisible absolute left-0 top-full w-52 translate-y-1 rounded-2xl border border-border bg-card p-2 opacity-0 shadow-xl transition-all group-hover:visible group-hover:translate-y-2 group-hover:opacity-100">
                  {n.links.map((l) => (
                    <a key={l.label} href={l.href} className="block rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                      {l.label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <a href="#contact" className="text-muted-foreground transition-colors hover:text-foreground">Contact</a>
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <a href={`${APP_URL}/login`} className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Sign in
            </a>
            <a href={`${APP_URL}/signup`} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:opacity-90">
              Get started
            </a>
          </div>
          <button className="md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu">
            {menu ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menu && (
          <div className="border-t border-border px-6 py-4 md:hidden">
            {NAV.flatMap((n) => n.links).map((l) => (
              <a key={l.label} href={l.href} onClick={() => setMenu(false)} className="block py-2 text-sm text-muted-foreground">
                {l.label}
              </a>
            ))}
            <div className="mt-3 flex gap-2">
              <a href={`${APP_URL}/login`} className="flex-1 rounded-full border border-border px-4 py-2 text-center text-sm font-semibold">Sign in</a>
              <a href={`${APP_URL}/signup`} className="flex-1 rounded-full bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground">Get started</a>
            </div>
          </div>
        )}
      </header>

      {/* Hero (emons pattern: headline + CTA + 3D + numbered tabs) */}
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-6 pb-10 pt-12 lg:grid-cols-2 lg:pt-16">
        <div className="lf-rise">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> The AI Company OS
          </div>
          <h1 className="mt-6 text-5xl font-extrabold leading-[1.04] tracking-tight sm:text-6xl">
            Your company.<br />One mission.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">
            Sales, marketing, finance, people and valuation — run by a fleet of AI agents that act on your live company data, with you approving every consequential move.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${APP_URL}/signup`} className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:opacity-90">
              Create your workspace <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#product" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold transition hover:bg-card">
              Explore the platform
            </a>
          </div>
          {/* numbered tabs */}
          <div className="mt-10 flex flex-wrap gap-2">
            {TABS.map((t, i) => (
              <button
                key={t.n}
                onClick={() => setTab(i)}
                className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-left transition-all ${i === tab ? 'border-transparent text-white shadow-lg' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}
                style={i === tab ? { background: `linear-gradient(135deg, ${t.accent}, ${t.accent}aa)` } : undefined}
              >
                <span className="font-mono text-xs opacity-70">{t.n}</span>
                <span className="text-sm font-semibold">{t.title}</span>
              </button>
            ))}
          </div>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            <strong className="text-foreground">{active.title}:</strong> {active.desc}
          </p>
        </div>
        <HeroScene accent={active.accent} chips={active.chips} />
      </section>

      {/* Stats band */}
      <section id="stats" className="border-y border-border bg-card/50">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-6 py-10 md:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-4xl font-extrabold tracking-tight sm:text-5xl">{s.value}</p>
              <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Services grid */}
      <section id="product" className="mx-auto max-w-7xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Capabilities</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">One OS. Every operational area.</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-1 hover:shadow-xl">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="about" className="border-y border-border bg-card/50">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-16 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">About Borga</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Your experts for running the whole company in one place.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Borga replaces a dozen disconnected tools with one workspace where every department&apos;s data feeds the next:
              marketing spend lands in finance actuals, sales wins move valuation, support tickets train the agents. Each company
              is its own isolated tenant — your data never mingles with anyone else&apos;s.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {['Per-company isolation — CRM, ledger, people and agents stay scoped', 'Approval gates on every consequential agent action', 'Regional privacy: GDPR, CCPA/CPRA, NDPR and POPIA aware'].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { v: '99.9%', l: 'Uptime target' },
              { v: '24/7', l: 'Agent coverage' },
              { v: '1', l: 'Login for everything' },
              { v: '0', l: 'Data shared across tenants' },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-border bg-background p-6 text-center">
                <p className="text-3xl font-extrabold">{s.v}</p>
                <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">Frequently asked questions</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-border bg-card px-5 py-4">
              <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex items-center justify-between gap-3">
                  {f.q}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Contact CTA */}
      <section id="contact" className="mx-auto max-w-7xl px-6 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-primary p-10 text-center text-primary-foreground shadow-2xl sm:p-16">
          <h2 className="relative text-3xl font-extrabold tracking-tight sm:text-4xl">Start your company OS today.</h2>
          <p className="relative mt-3 opacity-80">Free to start. Your data stays isolated to your account.</p>
          <a href={`${APP_URL}/signup`} className="relative mt-7 inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-semibold text-foreground shadow transition hover:opacity-90">
            Get started <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      <SiteFooter />
      <CookieBanner />
    </main>
  );
}
