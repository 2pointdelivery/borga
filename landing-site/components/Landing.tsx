'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Command,
  Menu,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { CookieBanner } from '@/components/CookieBanner';
import { SiteFooter } from '@/components/SiteFooter';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://borga.example.com';

const CLIENTFLOW_TABS = [
  {
    id: 'pipeline',
    label: 'Project pipeline',
    badge: 'Sales & Projects',
    headline: 'See where every client and project stands at a glance.',
    desc: 'Follow every job from the first hello to the signed quote, active project board, and final payment—without jumping between five different apps.',
    metrics: [
      { label: 'Open deals', value: '$184,500' },
      { label: 'Expected this month', value: '$112,300' },
      { label: 'Projects on track', value: '14 of 15' },
      { label: 'Avg. time to close', value: '2 days' },
    ],
    note: 'When a client accepts your quote, Borga sets up the invoice and project board for you in one click.',
  },
  {
    id: 'capture',
    label: 'Lead capture',
    badge: 'Leads & Follow-ups',
    headline: 'Stay organized and never let a good lead go cold.',
    desc: 'Capture new inquiries, jot down what they need, see which leads are warmest, and hand each one to the right person on your team.',
    metrics: [
      { label: 'Lead warmth', value: '88 / 100 (Hot)' },
      { label: 'Client needs noted', value: '3 of 3 answered' },
      { label: 'Assigned to', value: 'Next available rep' },
      { label: 'First reply time', value: 'Under 5 mins' },
    ],
    note: 'If a lead goes quiet for a few days, your AI helper drafts a friendly follow-up and waits for your okay to send it.',
  },
  {
    id: 'clients',
    label: 'Client management',
    badge: 'Quotes & Client Portal',
    headline: 'Make it effortless for clients to say yes.',
    desc: 'Send clean, professional quotes and share a private client link where customers can review prices, accept proposals, and check their invoices—no login required.',
    metrics: [
      { label: 'Client link', value: 'No password needed' },
      { label: 'Quote status', value: 'Sent & viewed' },
      { label: 'When accepted', value: 'Creates invoice' },
      { label: 'Client history', value: 'All in one place' },
    ],
    note: 'Every email, WhatsApp message, call, quote, and invoice for a client lives on one simple timeline.',
  },
  {
    id: 'payments',
    label: 'Online payments',
    badge: 'Invoicing & Bookkeeping',
    headline: 'Get paid faster, with books that stay balanced on their own.',
    desc: 'Send invoices, take online payments, match bank transactions in seconds, and keep your income, expenses, and tax numbers ready year-round.',
    metrics: [
      { label: 'Money in (period)', value: '$142,800.00' },
      { label: 'Costs & expenses', value: '$88,350.00' },
      { label: 'Profit (net income)', value: '$54,450.00' },
      { label: 'Books balanced', value: 'To the cent ✓' },
    ],
    note: 'Real math, never guesswork: every invoice, bill, sale, and paycheck updates your books automatically.',
  },
  {
    id: 'automations',
    label: 'Automations',
    badge: 'AI Helpers & Reminders',
    headline: 'Put helpful AI to work on the busywork.',
    desc: 'Let your AI team sort support tickets, remind clients about overdue bills, draft replies, and email you a weekly profit summary—while you stay in charge.',
    metrics: [
      { label: 'AI helpers ready', value: '16 specialists' },
      { label: 'Runs on', value: 'Schedule or event' },
      { label: 'You stay in control', value: 'Approvals first' },
      { label: 'Notifications', value: 'Web & phone' },
    ],
    note: 'Nothing involving money or customer emails ever goes out without your thumbs-up.',
  },
] as const;

const SHARED_SERVICES_OFFERS = [
  {
    title: 'Bookkeeping & Fractional CFO',
    badge: 'Finance Access Only',
    desc: 'Bring in a vetted accountant or CFO to reconcile your bank, close your monthly books, and prepare your tax returns right inside Borga.',
    price: 'Monthly or Custom',
    priceSub: 'Advisor gets 85% · Borga keeps 15%',
    href: `${APP_URL}/login?role=advisor&next=/services`,
  },
  {
    title: '1-on-1 Discovery or Setup Call',
    badge: 'Live Video Call',
    desc: 'Spend 45–60 minutes with a specialist to set up your books, review your numbers, plan a campaign, or build custom AI workflows.',
    price: 'Book a time',
    priceSub: 'or pick a fixed package',
    href: `${APP_URL}/login?role=advisor&next=/services`,
  },
  {
    title: 'Sales, Marketing & Project Help',
    badge: 'Sales · Marketing · Projects',
    desc: 'Hire a vetted agency or project manager to run your outreach, schedule social campaigns, or keep a big project moving for you.',
    price: 'Fixed Package',
    priceSub: 'usually $500 to $5,000',
    href: `${APP_URL}/login?role=advisor&next=/services`,
  },
] as const;

const QUICK_AI_ANSWERS: Array<{ q: string; a: string; href: string; cta: string }> = [
  {
    q: 'Which "Log in as" option should I pick?',
    a: 'Pick "Your Company" if you are running your own business. Pick "Advisor & Agency" if you are an accountant, consultant, or agency helping clients. Pick "System Admin" only if you manage the platform itself.',
    href: `${APP_URL}/login`,
    cta: 'Go to Sign In',
  },
  {
    q: 'How much does Borga cost?',
    a: 'It is $2 per team member per month for your company workspace—with every feature included. If you hire an outside accountant or agency through Shared Services, their seat on your workspace is free, and Borga simply keeps 15% of their service fee (the advisor gets 85%).',
    href: '#pricing',
    cta: 'See Pricing & Calculator',
  },
  {
    q: 'Will AI ever send emails or move money without asking me?',
    a: 'Never. Your AI helpers can draft replies, organize tickets, and prepare reminders, but anything that sends a message to a customer or touches money waits for your approval first.',
    href: `${APP_URL}/signup`,
    cta: 'Create Your Workspace',
  },
];

export function Landing() {
  const [activeTab, setActiveTab] = useState<(typeof CLIENTFLOW_TABS)[number]['id']>('pipeline');
  const [askOpen, setAskOpen] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [calcSeats, setCalcSeats] = useState(5);
  const [calcRetainer, setCalcRetainer] = useState(1000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAskOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const currentFlow = useMemo(
    () => CLIENTFLOW_TABS.find((t) => t.id === activeTab) ?? CLIENTFLOW_TABS[0],
    [activeTab],
  );

  const filteredAnswers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return QUICK_AI_ANSWERS;
    return QUICK_AI_ANSWERS.filter(
      (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
    );
  }, [query]);

  const seatMonthly = Math.max(1, calcSeats) * 2;
  const platformCut = Math.round(calcRetainer * 0.15);
  const advisorNet = calcRetainer - platformCut;

  return (
    <div className="min-h-screen bg-[#fbfbfb] text-[#111111] selection:bg-[#111111] selection:text-[#fbfbfb] dark:bg-[#0b0b0d] dark:text-[#f5f5f7]">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#fbfbfb]/90 backdrop-blur-md dark:border-white/10 dark:bg-[#0b0b0d]/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-6">
            <a href="#clientflow" className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-[#111111] font-mono text-xs font-bold text-white dark:bg-white dark:text-black">
                B
              </span>
              <span>Borga</span>
            </a>

            <nav aria-label="Primary" className="hidden items-center gap-5 text-sm text-black/70 md:flex dark:text-white/70">
              <a href="#clientflow" className="transition hover:text-black dark:hover:text-white">How It Works</a>
              <a href="#work-with-us" className="transition hover:text-black dark:hover:text-white">Hire an Advisor</a>
              <a href="#pricing" className="transition hover:text-black dark:hover:text-white">Pricing</a>
              <a href={`${APP_URL}/developers`} className="transition hover:text-black dark:hover:text-white">Developers</a>
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-black/15 bg-white px-2.5 py-1 text-xs font-medium text-black/80 shadow-2xs transition hover:border-black/30 dark:border-white/15 dark:bg-white/5 dark:text-white/80"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Ask a question</span>
              <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-black/60 dark:bg-white/10 dark:text-white/60">
                ⌘K
              </kbd>
            </button>

            <a
              href={`${APP_URL}/login?role=company&next=/app`}
              className="px-2.5 py-1 text-xs font-medium text-black/75 transition hover:text-black dark:text-white/75 dark:hover:text-white"
            >
              Log in as Company
            </a>
            <a
              href={`${APP_URL}/login?role=advisor&next=/services`}
              className="hidden px-2.5 py-1 text-xs font-medium text-black/75 transition hover:text-black lg:inline-block dark:text-white/75 dark:hover:text-white"
            >
              Advisor
            </a>
            <a
              href={`${APP_URL}/login?role=admin&next=/admin`}
              className="hidden px-2.5 py-1 text-xs font-medium text-black/75 transition hover:text-black lg:inline-block dark:text-white/75 dark:hover:text-white"
            >
              Admin
            </a>

            <a
              href={`${APP_URL}/signup`}
              className="hidden rounded-md bg-[#111111] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black/85 sm:inline-flex dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              Get started
            </a>

            <button
              type="button"
              onClick={() => setMobileMenu((v) => !v)}
              aria-label="Open menu"
              className="rounded-md border border-black/15 p-1.5 md:hidden dark:border-white/15"
            >
              {mobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section id="clientflow" className="border-b border-black/10 pb-16 pt-12 sm:pb-20 sm:pt-16 dark:border-white/10">
          <p className="font-mono text-xs uppercase tracking-widest text-black/55 dark:text-white/55">
            One calm place to run your business
          </p>

          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-[3.35rem]">
            Manage every client, project, and payment all in one place.
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-relaxed text-black/70 sm:text-lg dark:text-white/70">
            Send quotes, get paid, track projects, and keep your books and taxes up to date—with helpful AI that handles the busywork and real accountants or agencies ready to step in when you want a hand.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-black/65 dark:text-white/65">
            <span className="inline-flex items-center gap-1 font-medium text-black dark:text-white">
              <Star className="h-3.5 w-3.5 fill-current" /> 4.9
              <span className="font-normal text-black/55 dark:text-white/55">(loved by founders &amp; agencies)</span>
            </span>
            <span>·</span>
            <span><strong className="font-semibold text-black dark:text-white">All-in-one</strong> CRM, projects &amp; books</span>
            <span>·</span>
            <span><strong className="font-semibold text-black dark:text-white">16</strong> AI helpers</span>
            <span>·</span>
            <span><strong className="font-semibold text-black dark:text-white">$2</strong> / user / month</span>
          </div>

          <div className="mt-10 flex flex-wrap gap-2">
            {CLIENTFLOW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                  t.id === activeTab
                    ? 'border-black bg-[#111111] text-white dark:border-white dark:bg-white dark:text-black'
                    : 'border-black/15 bg-white text-black/75 dark:border-white/15 dark:bg-white/[0.03]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-black/12 bg-white p-6 dark:border-white/12 dark:bg-white/[0.03]">
            <span className="font-mono text-xs text-black/55 dark:text-white/55">{currentFlow.badge}</span>
            <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{currentFlow.headline}</h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-black/65 dark:text-white/65">{currentFlow.desc}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {currentFlow.metrics.map((m) => (
                <div key={m.label} className="rounded-lg border border-black/10 bg-[#fbfbfb] p-3.5 dark:border-white/10 dark:bg-black/30">
                  <p className="text-[11px] text-black/55 dark:text-white/55">{m.label}</p>
                  <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{m.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-black/65 dark:text-white/65">
              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
              {currentFlow.note}
            </p>
          </div>
        </section>

        <section id="work-with-us" className="border-b border-black/10 py-16 sm:py-20 dark:border-white/10">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Want an expert to handle your books, sales, or marketing?
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-black/65 dark:text-white/65">
            Book a call with a vetted accountant, CFO, or agency. You choose which tabs they can see—and adding an advisor never costs you an extra $2/month user seat.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {SHARED_SERVICES_OFFERS.map((s) => (
              <a key={s.title} href={s.href} className="group flex flex-col justify-between rounded-xl border border-black/12 bg-white p-5 transition hover:border-black/35 dark:border-white/12 dark:bg-white/[0.03]">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-black/5 px-2 py-0.5 font-mono text-[11px] dark:bg-white/10">{s.badge}</span>
                    <ArrowUpRight className="h-4 w-4 text-black/40" />
                  </div>
                  <h3 className="mt-3 text-base font-semibold group-hover:underline">{s.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-black/65 dark:text-white/65">{s.desc}</p>
                </div>
                <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
                  <span className="font-mono text-base font-bold">{s.price}</span> <span className="text-[11px] text-black/55">{s.priceSub}</span>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section id="pricing" className="py-16 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Simple, honest pricing: $2 per person per month.</h2>
          <div className="mt-6 grid gap-4 rounded-xl border border-black/12 bg-white p-5 lg:grid-cols-12 dark:border-white/12 dark:bg-white/[0.03]">
            <div className="space-y-2 text-xs lg:col-span-7">
              <p className="text-sm font-semibold">Everything included — no extra charge for outside advisors</p>
              <p className="text-black/65 dark:text-white/65">
                Every company workspace includes leads, quotes, client portal links, invoicing, bookkeeping, tax worksheets, projects, inventory, and 16 AI helpers.
              </p>
            </div>
            <div className="flex flex-col justify-between rounded-lg border border-black/10 bg-[#fbfbfb] p-4 text-xs lg:col-span-5 dark:border-white/10 dark:bg-black/30">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-black/60 dark:text-white/60">People on your team ($2/mo)</span>
                  <input type="number" min={1} max={500} value={calcSeats} onChange={(e) => setCalcSeats(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded border border-black/15 bg-white px-2.5 py-1 font-mono text-xs dark:border-white/15 dark:bg-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-black/60 dark:text-white/60">Advisor fee ($ USD)</span>
                  <input type="number" min={0} step={100} value={calcRetainer} onChange={(e) => setCalcRetainer(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded border border-black/15 bg-white px-2.5 py-1 font-mono text-xs dark:border-white/15 dark:bg-black" />
                </label>
              </div>
              <div className="mt-3 space-y-1 border-t border-black/10 pt-2.5 font-mono text-[11px] dark:border-white/10">
                <div className="flex justify-between"><span>Your monthly workspace bill:</span><strong>${seatMonthly.toFixed(2)}/mo</strong></div>
                <div className="flex justify-between"><span>Advisor takes home (85%):</span><strong>${advisorNet.toLocaleString()}</strong></div>
                <div className="flex justify-between"><span>Borga platform fee (15%):</span><strong>${platformCut.toLocaleString()}</strong></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
      <CookieBanner />

      {askOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20 backdrop-blur-xs" onClick={() => setAskOpen(false)}>
          <div className="w-full max-w-xl rounded-xl border border-black/15 bg-[#fbfbfb] p-4 shadow-2xl dark:border-white/15 dark:bg-[#141417]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-black/10 pb-3 dark:border-white/10">
              <Search className="h-4 w-4 text-black/50" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask about pricing, hiring an advisor, or which login to pick…" className="flex-1 bg-transparent text-sm outline-none" />
              <button type="button" onClick={() => setAskOpen(false)} className="rounded p-1"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto">
              {filteredAnswers.map((item) => (
                <div key={item.q} className="rounded-lg border border-black/10 bg-white p-3 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                  <p className="font-semibold">{item.q}</p>
                  <p className="mt-1 leading-relaxed text-black/65 dark:text-white/65">{item.a}</p>
                  <a href={item.href} className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-4">{item.cta} <ArrowRight className="h-3 w-3" /></a>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-black/10 pt-2.5 text-[11px] text-black/50">
              <span className="inline-flex items-center gap-1"><Command className="h-3 w-3" /> Press Esc or ⌘K to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
