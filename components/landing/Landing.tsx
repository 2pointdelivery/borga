'use client';

import Link from 'next/link';
import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Bot, Building2, CircleDot, Globe, Mic, PhoneCall, ShieldCheck, Star, Users, Wallet, Menu as MenuIcon, Megaphone, FolderKanban, Gauge, BarChart4, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiquidReveal } from './LiquidReveal';
import { NavMenu, PageLoader, StartDialog, type NavItem } from './LandingOverlays';
import {
  EASE_SNAP, Eyebrow, LineReveal, LogoMark, PillButton, ReadyContext, Reveal, StartContext, WordReveal,
  goTo, useAdaptiveGrid, useClock, useScrollProgress,
} from './landing-ui';

const SHELL = 'mx-auto w-full max-w-[88rem]';
const ACCENT = 'text-[var(--chart-1)]';

const NAV: NavItem[] = [
  { label: 'Home', id: 'home' },
  { label: 'Product', id: 'works' },
  { label: 'Capabilities', id: 'services' },
  { label: 'Why Borga', id: 'stats' },
  { label: 'Developers', href: '/developers' },
  { label: 'Sign in', href: '/login' },
];

const CARD_ITEMS = [
  { caption: 'Sales & pipeline', title: 'Deals that follow themselves up.' },
  { caption: 'Finance', title: 'Books that reconcile on their own.' },
  { caption: 'Voice', title: 'Say “Borga” and get it done.' },
];

const CONNECTS = ['Composio', 'ElevenLabs', 'Twilio', 'Deepgram', 'MailDog', 'Salt Edge', 'Supermemory', 'Fish Audio'];

const MODULES = [
  { name: 'Sales & Pipeline', cat: 'Sales', n: '01', desc: 'Kanban deals, account intelligence and AI-written proposals, with leads followed up automatically.', tags: ['Pipeline', 'CRM', 'Proposals'] },
  { name: 'Finance & Reporting', cat: 'Finance', n: '02', desc: 'A double-entry ledger, bank reconciliation, budgeting and one-click financial statements.', tags: ['Ledger', 'Banking', 'Budgets'] },
  { name: 'Agent Fleet', cat: 'AI', n: '03', desc: 'Specialist agents for every department, each with its own role and playbook, delegated to by priority.', tags: ['Agents', 'Delegation', 'Memory'] },
  { name: 'Voice & Calling', cat: 'Voice', n: '04', desc: 'A wake-word voice assistant, and agents that place real calls with natural voices.', tags: ['ElevenLabs', 'Twilio', 'Fish Audio'] },
];

const CAPABILITIES = [
  { title: 'Marketing & growth', desc: 'Multi-channel scheduling, paid-campaign ROAS and generative content.', icon: Megaphone },
  { title: 'People & HR', desc: 'Directory, time-off, teams and org planning in one place.', icon: Users },
  { title: 'Projects & budgets', desc: 'Boards, milestones and per-project budgets tracked against real spend.', icon: FolderKanban },
  { title: 'Secure by default', desc: 'Account authentication, per-company isolation and encrypted chat.', icon: ShieldCheck },
];

const MORE = ['Live valuation', 'Support desk & SLAs', 'Multi-company workspaces', 'Developer API & webhooks', 'Knowledge base', 'Email & SMTP'];

const STATS = [
  { value: 12, suffix: '', label: 'Departments automated' },
  { value: 16, suffix: '', label: 'AI agents on the fleet' },
  { value: 11, suffix: '', label: 'Modules included' },
  { value: 2, suffix: '', label: 'Voice engines to choose from' },
];

// ── header ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Header({ onMenu }: { onMenu: () => void }) {
  const ready = useContext(ReadyContext);
  const clock = useClock();
  const start = useContext(StartContext);
  const pick = (it: NavItem) => { if (it.id) goTo(it.id); };
  return (
    <header
      className="absolute inset-x-0 top-0 z-50"
      style={{ opacity: ready ? 1 : 0, transform: ready ? 'none' : 'translateY(-14px)', transition: 'opacity 700ms cubic-bezier(.22,1,.36,1) 150ms, transform 700ms cubic-bezier(.22,1,.36,1) 150ms' }}
    >
      <div className={cn(SHELL, 'flex items-center justify-between gap-6 px-5 py-5 sm:px-8 sm:py-6')}>
        <button onClick={() => goTo('home')} className="flex items-center gap-2 text-lg font-semibold tracking-tight transition-transform duration-300 hover:scale-[1.04]" style={{ transitionTimingFunction: EASE_SNAP }}>
          <LogoMark className={cn('text-xl', ACCENT)} /> Borga
        </button>
        <nav className="hidden lg:block" aria-label="Primary">
          <ul className="flex gap-8 text-sm font-medium">
            {NAV.slice(0, 4).map((it, i) => (
              <li key={it.label}>
                <button onClick={() => pick(it)} aria-current={i === 0 ? 'page' : undefined} className="opacity-80 transition duration-300 hover:-translate-y-0.5 hover:opacity-100" style={{ transitionTimingFunction: EASE_SNAP }}>{it.label}</button>
              </li>
            ))}
            <li><Link href="/developers" className="opacity-80 transition duration-300 hover:-translate-y-0.5 hover:opacity-100 inline-block">Developers</Link></li>
            <li><Link href="/login" className="opacity-80 transition duration-300 hover:-translate-y-0.5 hover:opacity-100 inline-block">Sign in</Link></li>
          </ul>
        </nav>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 rounded-[0.875rem] border border-border/80 bg-background/40 px-3 py-2 text-xs text-foreground/70 backdrop-blur-sm md:flex">
            <span className="text-foreground/45">Local time</span>
            <span className="min-w-14 font-medium tabular-nums text-foreground">{clock?.time ?? '9:41am'}</span>
            <span className="text-foreground/30">•</span>
            <span className="font-medium">{clock?.date ?? '12 March, 2025'}</span>
          </div>
          <button onClick={start} className="hidden rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:opacity-90 sm:block">Get started</button>
          <button onClick={onMenu} className="rounded-[0.875rem] border border-border/80 bg-background/40 backdrop-blur-sm transition hover:bg-background/70" aria-label="Open menu">
            <span className="flex items-center gap-2 px-4 py-2 text-xs font-medium uppercase tracking-wider transition-transform duration-300 hover:scale-105" style={{ transitionTimingFunction: EASE_SNAP }}>
              <MenuIcon className="size-3.5" /> <span className="hidden sm:inline">Menu</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

// ── hero ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function HeroCard() {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const go = (step: number) => { setDir(step); setI((v) => (v + step + CARD_ITEMS.length) % CARD_ITEMS.length); };
  const item = CARD_ITEMS[i];
  return (
    <div className="w-full max-w-sm rounded-[1.25rem] bg-background/70 p-2 shadow-sm ring-1 ring-border/70 backdrop-blur-xl lg:w-[19rem]">
      <div role="button" tabIndex={0} onClick={() => go(1)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(1); } }} className="flex cursor-pointer gap-2 rounded-[0.875rem]" aria-label="Next highlight">
        <div className="grid aspect-square w-24 place-items-center rounded-[0.875rem] bg-foreground text-3xl text-background"><LogoMark className={ACCENT} /></div>
        <div className="flex flex-1 flex-col justify-between rounded-[0.875rem] bg-muted/70 p-3">
          <div className="relative min-h-[3.25rem] overflow-hidden">
            <div key={i} className="absolute inset-0 motion-safe:animate-[landingSwap_.45s_cubic-bezier(.22,1,.36,1)_both]" style={{ ['--from' as string]: `${dir * 14}px` }}>
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-foreground/45">{item.caption}</p>
              <p className="max-w-32 text-sm font-medium leading-[1.35]">{item.title}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">{CARD_ITEMS.map((_, n) => <span key={n} className={cn('h-1 rounded-full transition-all duration-300', n === i ? 'w-4 bg-foreground/70' : 'w-1.5 bg-foreground/20')} />)}</div>
            <div className="flex gap-1">
              <button onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous" className="grid size-7 place-items-center rounded-full bg-background text-foreground/70 ring-1 ring-border transition hover:text-foreground"><ArrowRight className="size-3.5 rotate-180" /></button>
              <button onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next" className="grid size-7 place-items-center rounded-full bg-background text-foreground/70 ring-1 ring-border transition hover:text-foreground"><ArrowRight className="size-3.5" /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const start = useContext(StartContext);
  return (
    <section id="home" className="relative isolate overflow-hidden rounded-b-[2rem] bg-muted">
      <LiquidReveal className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-background/35 via-transparent to-background/35" />
      <Reveal gated y={20} delay={300} duration={1100} className="pointer-events-none absolute inset-x-0 bottom-28 z-[1] select-none text-center text-[13rem] font-bold leading-none text-background/40">
        BORGA
      </Reveal>

      <div className={cn(SHELL, 'relative z-20 flex flex-col gap-8 px-5 pb-20 pt-28 sm:px-8 lg:grid lg:min-h-[100lvh] lg:grid-cols-12 lg:gap-10 lg:pb-28 lg:pt-36')}>
        <div className="flex flex-col gap-7 lg:col-span-7">
          <Reveal gated y={10} delay={200}><span className="inline-flex items-center gap-2 text-sm font-medium text-foreground/70"><span className="size-1.5 rounded-full bg-foreground/50" /> The AI Company OS</span></Reveal>
          <LineReveal as="h1" gated delay={250} stagger={120} lines={['Run your whole', 'company on one', 'agent-powered OS']} className="max-w-[18ch] text-4xl font-semibold leading-[0.98] tracking-tight sm:text-5xl md:text-6xl" />
          <Reveal gated delay={650} y={10}>
            <div className="flex items-center gap-3">
              <span className={cn('flex gap-0.5', ACCENT)}>{[0, 1, 2, 3, 4].map((n) => <Star key={n} className="size-4 fill-current" />)}</span>
              <span className="text-sm font-medium text-foreground/70">12 departments, 16 specialist agents</span>
            </div>
          </Reveal>
          <Reveal gated delay={750} y={10}>
            <div className="flex flex-wrap gap-3">
              <PillButton arrow="right" onClick={start}>Create your workspace</PillButton>
              <PillButton variant="outline" onClick={() => goTo('works')}>See the product</PillButton>
            </div>
          </Reveal>
        </div>

        <div className="flex flex-col items-start gap-8 lg:col-span-5 lg:items-end">
          <Reveal gated delay={400} y={16} scale={0.96} className="w-full max-w-sm lg:w-auto"><HeroCard /></Reveal>
          <Reveal gated delay={550} y={14} className="w-full max-w-sm lg:w-[19rem]">
            <p className="mb-3 text-left text-xs font-medium text-foreground/45 lg:text-right">Connects to</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-3">
              {CONNECTS.map((c) => (
                <li key={c} className="flex items-center gap-1.5 text-xs text-foreground/70 opacity-70 transition duration-300 hover:-translate-y-0.5 hover:opacity-100">
                  <CircleDot className="size-3.5 shrink-0 text-foreground/40" /> {c}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>

      <Reveal gated delay={900} y={0}>
        <div className={cn(SHELL, 'relative z-20 flex items-center justify-between gap-3 border-t border-foreground/10 px-5 py-5 text-xs font-medium uppercase tracking-tight text-foreground/60 sm:px-8')}>
          <span>One workspace per company</span>
          <span className="hidden sm:block">Isolated, encrypted, yours</span>
          <span className="inline-flex gap-2">Scroll to explore <span>↓</span></span>
        </div>
      </Reveal>
    </section>
  );
}

// ── about / band ─────────────────────────────────────────────────────────────────────────────────────────────────────

function About() {
  return (
    <section id="about" className="bg-background">
      <div className={cn(SHELL, 'grid items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:py-28')}>
        <div className="relative min-h-56 lg:min-h-80">
          <Globe className="absolute -left-4 top-1/2 size-48 -translate-y-1/2 text-foreground/10 sm:size-64 lg:-left-6 lg:size-80" strokeWidth={1.2} aria-hidden />
          <div className="relative"><Eyebrow>The platform</Eyebrow></div>
          <Reveal y={12} className="absolute bottom-0 left-0 flex items-center gap-3 text-sm text-foreground/70">
            <Globe className="size-6 text-foreground" />
            <span className="max-w-56">Every company you own, as its own isolated workspace.</span>
          </Reveal>
        </div>
        <div className="flex flex-col gap-10">
          <WordReveal
            className="text-2xl font-medium leading-[1.35] tracking-tight sm:text-3xl"
            parts={[
              { text: 'Borga unifies sales, marketing, finance, HR and communications, ' },
              { text: 'run by agents, scoped per workspace, and grounded by a knowledge base they actually use.', className: 'text-muted-foreground' },
            ]}
          />
          <Reveal y={12} delay={200}>
            <div className="flex flex-wrap items-end justify-between gap-6 border-t border-border pt-6">
              <div>
                <p className="mb-2 text-sm text-foreground/45">Build on it</p>
                <div className="flex gap-2">
                  {[Bot, Building2, Wallet].map((Ic, n) => (
                    <span key={n} className={cn('grid size-9 place-items-center rounded-full text-sm', n === 0 ? 'bg-foreground text-background' : 'bg-muted text-foreground/70')}>
                      <Ic className="size-4 transition-transform duration-300 hover:scale-[1.18]" />
                    </span>
                  ))}
                </div>
              </div>
              <PillButton variant="outline" arrow="right" href="/developers">Developers</PillButton>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function CreateBand() {
  const tiles: Array<{ node: ReactNode; cls: string }> = [
    { node: 'Ask', cls: 'bg-muted text-foreground' },
    { node: 'Delegate', cls: 'bg-gradient-to-br from-[var(--chart-1)] to-[var(--chart-1)]/70 text-background' },
    { node: <ArrowRight className="size-9 sm:size-12" />, cls: 'bg-foreground text-background' },
    { node: 'Done', cls: 'bg-muted/60 text-foreground/35' },
  ];
  return (
    <section className="bg-background">
      <ul className={cn(SHELL, 'flex flex-col gap-3 px-5 py-10 sm:flex-row sm:gap-4 sm:px-8')}>
        {tiles.map((t, i) => (
          <Reveal as="li" key={i} y={28} delay={i * 120} className="flex-1">
            <div className={cn('grid h-24 place-items-center rounded-full text-3xl font-medium transition-transform duration-300 hover:scale-[1.03] sm:h-40 sm:text-4xl', t.cls)} style={{ transitionTimingFunction: EASE_SNAP }}>{t.node}</div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

// ── product / capabilities ───────────────────────────────────────────────────────────────────────────────────────────

function Modules() {
  return (
    <section id="works" className="bg-background">
      <div className={cn(SHELL, 'px-5 pb-20 pt-10 sm:px-8 lg:pb-28')}>
        <Reveal className="flex justify-center"><Eyebrow bordered>Product</Eyebrow></Reveal>
        <LineReveal delay={120} lines={['One OS, every module']} className="mx-auto mt-5 w-fit text-center text-4xl font-semibold tracking-tight sm:text-5xl" />
        <ul className="mt-12 grid gap-6 md:grid-cols-2">
          {MODULES.map((m, i) => (
            <Reveal as="li" key={m.name} y={48} delay={i * 90}>
              <Link href="/signup" className="group block">
                <article className="relative min-h-[22rem] overflow-hidden rounded-[2rem] bg-foreground p-6 text-background ring-1 ring-background/5 transition-transform duration-300 group-hover:-translate-y-2 group-hover:scale-[1.012] sm:min-h-[26rem] sm:p-8" style={{ transitionTimingFunction: EASE_SNAP }}>
                  <div className="flex justify-between text-xs uppercase tracking-tight text-background/45">
                    <span>{m.cat} — Module {m.n}</span>
                    <span className="grid size-11 place-items-center rounded-full bg-background/10 text-background ring-1 ring-background/15 transition-transform duration-300 group-hover:rotate-45 group-hover:scale-[1.08]"><ArrowUpRight className="size-4" /></span>
                  </div>
                  <div className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="relative text-7xl text-background/90"><LogoMark /></span>
                  </div>
                  <div className="absolute inset-x-6 bottom-6 sm:inset-x-8 sm:bottom-8">
                    <h3 className="text-2xl font-medium tracking-tight sm:text-3xl">{m.name}</h3>
                    <p className="mt-2 max-w-md text-sm text-background/55">{m.desc}</p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {m.tags.map((t) => <span key={t} className="inline-flex rounded-full border border-background/25 px-4 py-2 text-sm text-background">{t}</span>)}
                    </div>
                  </div>
                </article>
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section id="services" className="bg-background">
      <div className={cn(SHELL, 'px-5 py-20 sm:px-8 lg:py-28')}>
        <Reveal><Eyebrow>Capabilities</Eyebrow></Reveal>
        <LineReveal delay={120} lines={['Everything a company runs on']} className="mb-12 mt-5 max-w-[16ch] text-4xl font-semibold tracking-tight sm:mb-14 sm:text-5xl" />
        <ul>
          {CAPABILITIES.map((c, i) => (
            <Reveal as="li" key={c.title} y={24} delay={i * 80} className={cn(i > 0 && 'border-t border-border')}>
              <Link href="/signup" className="group/row flex items-center gap-4 rounded-[1.25rem] bg-transparent px-6 py-6 transition-all duration-300 hover:bg-muted hover:pl-8 hover:pr-5 sm:gap-6 sm:py-8" style={{ transitionTimingFunction: EASE_SNAP }}>
                <span className="w-7 text-sm font-medium text-foreground/40 sm:w-10">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="flex-1 text-2xl font-medium tracking-tight sm:text-3xl md:text-4xl">{c.title}</h3>
                <p className="hidden max-w-xs text-sm text-foreground/55 lg:block">{c.desc}</p>
                <span className="grid size-10 place-items-center rounded-full bg-foreground text-background transition-transform duration-300 group-hover/row:translate-x-[5px] sm:size-12"><ArrowUpRight className="size-4" /></span>
              </Link>
            </Reveal>
          ))}
        </ul>
        <Reveal y={16} delay={150} className="mt-10 flex flex-wrap gap-2">
          {MORE.map((m) => <span key={m} className="rounded-full border border-border px-4 py-2 text-sm text-foreground/70">{m}</span>)}
        </Reveal>
      </div>
    </section>
  );
}

function Stat({ value, suffix, label, delay }: { value: number; suffix: string; label: string; delay: number }) {
  const { ref, p } = useScrollProgress<HTMLDivElement>();
  return (
    <Reveal as="li" y={20} delay={delay}>
      <div ref={ref}>
        <div className="text-5xl font-semibold tracking-tight sm:text-6xl md:text-7xl">{Math.round(p * value)}{suffix}</div>
        <div className="mt-3 text-sm text-background/55">{label}</div>
      </div>
    </Reveal>
  );
}

function Stats() {
  return (
    <section id="stats" className="bg-background">
      <div className={cn(SHELL, 'px-5 pb-20 sm:px-8 lg:pb-28')}>
        <Reveal y={40} scale={0.99} duration={900} className="rounded-[2rem] bg-foreground px-6 py-12 text-background sm:py-16 md:px-16">
          <Eyebrow tone="light">By the numbers</Eyebrow>
          <LineReveal delay={120} lines={['One platform, every department.']} className="mt-4 max-w-[20ch] text-3xl font-medium tracking-tight md:text-4xl" />
          <ul className="mt-14 grid grid-cols-2 gap-x-8 gap-y-12 lg:grid-cols-4">
            {STATS.map((s, i) => <Stat key={s.label} {...s} delay={i * 90} />)}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

// ── footer ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function Footer() {
  const start = useContext(StartContext);
  const cols: Array<{ title: string; links: Array<{ label: string; href?: string; id?: string }> }> = [
    { title: 'Product', links: [{ label: 'Modules', id: 'works' }, { label: 'Capabilities', id: 'services' }, { label: 'Why Borga', id: 'stats' }] },
    { title: 'Build', links: [{ label: 'Developers', href: '/developers' }, { label: 'API & webhooks', href: '/developers' }] },
    { title: 'Account', links: [{ label: 'Create a workspace', href: '/signup' }, { label: 'Sign in', href: '/login' }, { label: 'Reset password', href: '/forgot' }] },
  ];
  const linkCls = 'inline-block text-sm transition duration-300 opacity-65 hover:translate-x-1 hover:opacity-100';
  return (
    <footer className="relative overflow-hidden rounded-t-[2rem] bg-foreground text-background">
      <div className={cn(SHELL, 'relative z-10 px-5 pb-10 pt-20 sm:px-8 lg:pt-24')}>
        <div className="flex flex-col gap-8 border-b border-background/10 pb-16 lg:flex-row lg:items-end lg:justify-between">
          <LineReveal stagger={100} lines={['Ready to run your', 'company on Borga?']} className="max-w-[16ch] text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl" />
          <PillButton variant="light" arrow="up-right" onClick={start}>Start your workspace</PillButton>
        </div>
        <div className="grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-2 text-lg font-semibold"><LogoMark className="text-xl" /> Borga</div>
            <p className="max-w-xs text-sm text-background/55">An AI company OS: sales, finance, people and communications, run by agents you can talk to.</p>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <p className="mb-4 text-xs uppercase tracking-tight text-background/40">{c.title}</p>
              <ul className="flex flex-col gap-3">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.href ? <Link href={l.href} className={linkCls}>{l.label}</Link> : <button onClick={() => goTo(l.id as string)} className={linkCls}>{l.label}</button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center justify-between gap-4 border-t border-background/10 pt-8 text-xs text-background/45 sm:flex-row">
          <span>© {new Date().getFullYear()} Borga. All rights reserved.</span>
          <span className="inline-flex items-center gap-1.5"><Mic className="size-3.5" /> <PhoneCall className="size-3.5" /> <BarChart4 className="size-3.5" /> <Gauge className="size-3.5" /> <TrendingUp className="size-3.5" /></span>
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-6 z-0 select-none text-center text-[13rem] font-bold leading-none text-background/5">BORGA</div>
    </footer>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function Landing() {
  useAdaptiveGrid();
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [start, setStart] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const closeStart = useCallback(() => setStart(false), []);
  const openStart = useCallback(() => setStart(true), []);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <ReadyContext.Provider value={ready}>
      <StartContext.Provider value={openStart}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[0.875rem] focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background">Skip to content</a>
        {!ready && <PageLoader onDone={() => setReady(true)} />}
        <Header onMenu={() => setMenu(true)} />
        <main id="main" className="min-h-screen overflow-x-hidden bg-background text-foreground">
          <Hero />
          <About />
          <CreateBand />
          <Modules />
          <Capabilities />
          <Stats />
        </main>
        <Footer />
        <NavMenu open={menu} items={[...NAV, { label: 'Start your workspace', start: true }]} onClose={closeMenu} onStart={openStart} />
        <StartDialog open={start} onClose={closeStart} />
      </StartContext.Provider>
    </ReadyContext.Provider>
  );
}
