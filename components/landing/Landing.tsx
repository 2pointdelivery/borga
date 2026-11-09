'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  Command,
  Menu,
  Search,
  Sliders,
  Sparkles,
  Star,
  X,
} from 'lucide-react';

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

const AI_WORK_PILLARS = [
  {
    title: 'Email & proposal drafts',
    tag: 'Save time writing',
    desc: 'Get warm, ready-to-send follow-ups, support replies, and project proposals written from your actual notes with the client.',
    sample: '“Drafted a follow-up for Accra Foods ($12,000 quote) mentioning their cold-storage issue — waiting for your approval.”',
  },
  {
    title: 'Project & ticket recaps',
    tag: 'Catch up in seconds',
    desc: 'See a plain-English summary of long email threads, support tickets that need a quick reply, and what is holding up a project.',
    sample: '“Ticket SUP-42 needs a reply in 30 mins. It matches a billing question we solved last week — suggested answer attached.”',
  },
  {
    title: 'Clear answers about your money',
    tag: 'Know your numbers',
    desc: 'Ask who still owes you, what you quoted a client last month, or how much profit you made this quarter—straight from your real books.',
    sample: '“You made $54,450 in profit this month (up 14%), and 3 invoices totaling $8,400 are more than two weeks overdue.”',
  },
  {
    title: 'Call booking & action notes',
    tag: 'From call to proposal',
    desc: 'Let clients book a video call, talk to Borga by voice when your hands are full, and turn call notes into a quote in one click.',
    sample: '“Finished discovery call with Wayne Retail → created a $1,000/mo bookkeeping proposal ready to review.”',
  },
] as const;

const BUSINESS_TYPES = [
  {
    title: 'Accountants & Bookkeepers',
    role: 'Advisors & Fractional CFOs',
    desc: 'Look after all your clients’ books, monthly closes, and tax returns from one place—without clients emailing you messy spreadsheets.',
    quote: '“We look after 18 client companies from one screen, and our clients don’t pay a cent extra to give us access.”',
    author: 'Ama M., CPA & Managing Partner',
    href: '/services',
  },
  {
    title: 'Marketing & Creative Agencies',
    role: 'Agencies & Strategists',
    desc: 'Plan social posts, track ad results, and manage sales pipelines for your clients on simple monthly retainers or fixed packages.',
    quote: '“Clients book a call, pick our growth package, and share just their Marketing and Sales tabs with us.”',
    author: 'Casandra G., Agency Founder',
    href: '/services',
  },
  {
    title: 'Consultants & Coaches',
    role: 'Professional Services',
    desc: 'Go from an intro call to a clear proposal, project checklist, time sheet, and monthly invoice without juggling separate tools.',
    quote: '“When a client accepts my quote, the invoice and project board are ready immediately. Nothing slips through the cracks.”',
    author: 'Alexis C., Business Consultant',
    href: '/signup',
  },
  {
    title: 'Event & Production Teams',
    role: 'Planners, Venues & Studios',
    desc: 'Keep client quotes, vendor bills, purchase orders, gear lists, and payment milestones organized in one calm workspace.',
    quote: '“I don’t make booking or vendor-payment mistakes anymore—Borga reminds me before anything is due.”',
    author: 'Jody H., Venue & Studio Director',
    href: '/signup',
  },
  {
    title: 'Startups & Growing Companies',
    role: 'Founders & Teams',
    desc: 'Track your ownership cap table, investor updates, team payroll, and day-to-day accounting in one place as you grow.',
    quote: '“Our cap table, company valuation, and daily bookkeeping finally live together instead of five different spreadsheets.”',
    author: 'Tiffany T., Founder & CEO',
    href: '/signup',
  },
  {
    title: 'Shops, Inventory & Field Teams',
    role: 'Product & Retail Businesses',
    desc: 'Manage products, barcodes, stock levels across locations, purchase orders, and a point-of-sale register that updates your books automatically.',
    quote: '“Every sale at the counter updates our stock and our accounting ledger at the same time.”',
    author: 'Kwame O., Operations Lead',
    href: '/signup',
  },
] as const;

const SHARED_SERVICES_OFFERS = [
  {
    title: 'Bookkeeping & Fractional CFO',
    badge: 'Finance Access Only',
    desc: 'Bring in a vetted accountant or CFO to reconcile your bank, close your monthly books, and prepare your tax returns right inside Borga.',
    price: 'Monthly or Custom',
    priceSub: 'Advisor gets 85% · Borga keeps 15%',
    specs: [
      { k: 'How long', v: 'Ongoing monthly' },
      { k: 'Covers', v: 'Books, bills, taxes & reports' },
      { k: 'What they see', v: 'Only your Finance tab (free seat)' },
      { k: 'What you get', v: 'Clean books & peace of mind' },
    ],
    href: '/login?role=advisor&next=/services',
  },
  {
    title: '1-on-1 Discovery or Setup Call',
    badge: 'Live Video Call',
    desc: 'Spend 45–60 minutes with a specialist to set up your books, review your numbers, plan a campaign, or build custom AI workflows.',
    price: 'Book a time',
    priceSub: 'or pick a fixed package',
    specs: [
      { k: 'How long', v: '45–60 minutes' },
      { k: 'Good for', v: 'Setup, cleanup, or advice' },
      { k: 'How it works', v: 'Built-in video call + screen share' },
      { k: 'Afterwards', v: 'Clear action plan or proposal' },
    ],
    href: '/login?role=advisor&next=/services',
  },
  {
    title: 'Sales, Marketing & Project Help',
    badge: 'Sales · Marketing · Projects',
    desc: 'Hire a vetted agency or project manager to run your outreach, schedule social campaigns, or keep a big project moving for you.',
    price: 'Fixed Package',
    priceSub: 'usually $500 to $5,000',
    specs: [
      { k: 'How long', v: 'One-off sprint or monthly' },
      { k: 'How to start', v: 'Pick a package or request a quote' },
      { k: 'What they see', v: 'Only Sales, Marketing, or Projects' },
      { k: 'What you get', v: 'Every update logged on your timeline' },
    ],
    href: '/login?role=advisor&next=/services',
  },
] as const;

const TESTIMONIALS = [
  {
    quote: 'With Borga, I don’t have to glue ten different apps together. My leads, quotes, invoices, accounting, and AI helpers all work together in one place.',
    author: 'Tiffany T.',
    role: 'Founder & CEO',
  },
  {
    quote: 'Clients love the private quote link—they can read the proposal, click accept, and pay without having to create an account. We get paid 10x faster.',
    author: 'Jayne B.',
    role: 'Creative Director',
  },
  {
    quote: 'Inviting our accountant through Shared Services took two minutes. We shared only our Finance tab, and it didn’t add a single dollar to our monthly seat bill.',
    author: 'Marcus V.',
    role: 'Business Owner',
  },
] as const;

const QUICK_AI_ANSWERS = [
  {
    q: 'Which "Log in as" option should I pick?',
    a: 'Pick "Your Company" if you are running your own business (/app). Pick "Advisor & Agency" if you are an accountant, consultant, or agency helping clients (/services). Pick "System Admin" only if you manage the platform itself (/admin).',
    href: '/login',
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
    href: '/signup',
    cta: 'Create Your Workspace',
  },
] as const;

export function Landing() {
  const [activeTab, setActiveTab] = useState<(typeof CLIENTFLOW_TABS)[number]['id']>('pipeline');
  const [loginMenuOpen, setLoginMenuOpen] = useState(false);
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
      if (e.key === 'Escape') {
        setAskOpen(false);
        setLoginMenuOpen(false);
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
      {/* TOP HEADER */}
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#fbfbfb]/90 backdrop-blur-md dark:border-white/10 dark:bg-[#0b0b0d]/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-[#111111] font-mono text-xs font-bold text-white dark:bg-white dark:text-black">
                B
              </span>
              <span>Borga</span>
            </Link>

            <nav aria-label="Primary" className="hidden items-center gap-5 text-sm text-black/70 md:flex dark:text-white/70">
              <a href="#clientflow" className="transition hover:text-black dark:hover:text-white">How It Works</a>
              <a href="#ai-work" className="transition hover:text-black dark:hover:text-white">AI Helpers</a>
              <a href="#business-types" className="transition hover:text-black dark:hover:text-white">Who It&apos;s For</a>
              <a href="#work-with-us" className="transition hover:text-black dark:hover:text-white">Hire an Advisor</a>
              <a href="#pricing" className="transition hover:text-black dark:hover:text-white">Pricing</a>
              <Link href="/developers" className="transition hover:text-black dark:hover:text-white">Developers</Link>
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

            {/* "Log in as >" Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setLoginMenuOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-black/15 bg-white px-2.5 py-1 text-xs font-medium text-black/85 transition hover:border-black/35 dark:border-white/15 dark:bg-white/5 dark:text-white/85"
              >
                <span>Log in as</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {loginMenuOpen && (
                <div
                  className="absolute right-0 mt-2 w-72 rounded-xl border border-black/15 bg-white p-1.5 shadow-xl dark:border-white/15 dark:bg-[#141417]"
                  onMouseLeave={() => setLoginMenuOpen(false)}
                >
                  <p className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-black/45 dark:text-white/45">
                    Choose where to sign in
                  </p>
                  <Link
                    href="/login?role=company&next=/app"
                    onClick={() => setLoginMenuOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Your Company ▸</p>
                      <p className="text-[11px] text-black/60 dark:text-white/60">Run your day-to-day business (/app)</p>
                    </div>
                  </Link>
                  <Link
                    href="/login?role=advisor&next=/services"
                    onClick={() => setLoginMenuOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Briefcase className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Advisor &amp; Agency ▸</p>
                      <p className="text-[11px] text-black/60 dark:text-white/60">Work with client companies (/services)</p>
                    </div>
                  </Link>
                  <Link
                    href="/login?role=admin&next=/admin"
                    onClick={() => setLoginMenuOpen(false)}
                    className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <Sliders className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">System Admin ▸</p>
                      <p className="text-[11px] text-black/60 dark:text-white/60">Platform settings &amp; approvals (/admin)</p>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/signup"
              className="hidden rounded-md bg-[#111111] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black/85 sm:inline-flex dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              Get started
            </Link>

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

        {mobileMenu && (
          <div className="border-t border-black/10 bg-[#fbfbfb] px-5 py-4 text-sm md:hidden dark:border-white/10 dark:bg-[#0b0b0d]">
            <div className="flex flex-col gap-2.5">
              <a href="#clientflow" onClick={() => setMobileMenu(false)}>How It Works</a>
              <a href="#ai-work" onClick={() => setMobileMenu(false)}>AI Helpers</a>
              <a href="#business-types" onClick={() => setMobileMenu(false)}>Who It&apos;s For</a>
              <a href="#work-with-us" onClick={() => setMobileMenu(false)}>Hire an Advisor</a>
              <a href="#pricing" onClick={() => setMobileMenu(false)}>Pricing ($2/user/mo)</a>
              <hr className="border-black/10 dark:border-white/10" />
              <p className="font-mono text-[10px] uppercase text-black/50 dark:text-white/50">Log in as ▸</p>
              <Link href="/login?role=company&next=/app" onClick={() => setMobileMenu(false)}>Your Company (/app)</Link>
              <Link href="/login?role=advisor&next=/services" onClick={() => setMobileMenu(false)}>Advisor &amp; Agency (/services)</Link>
              <Link href="/login?role=admin&next=/admin" onClick={() => setMobileMenu(false)}>System Admin (/admin)</Link>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        {/* HERO */}
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

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#111111] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-black/85 dark:bg-white dark:text-black"
            >
              Start your workspace ($2/user/mo) <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/login?role=advisor&next=/services"
              className="inline-flex items-center gap-1.5 rounded-md border border-black/15 bg-white px-3.5 py-2.5 text-xs font-medium text-black/85 transition hover:border-black/35 dark:border-white/15 dark:bg-white/5 dark:text-white/85"
            >
              <span>+ Need a bookkeeper, CFO, or agency? Explore Shared Services</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Proof strip */}
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
            <span><strong className="font-semibold text-black dark:text-white">180</strong> currencies</span>
            <span>·</span>
            <span><strong className="font-semibold text-black dark:text-white">$2</strong> / user / month</span>
          </div>

          {/* 5-Stage Interactive Clientflow Switcher */}
          <div className="mt-10">
            <div className="flex flex-wrap gap-2">
              {CLIENTFLOW_TABS.map((t) => {
                const active = t.id === activeTab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? 'border-black bg-[#111111] text-white dark:border-white dark:bg-white dark:text-black'
                        : 'border-black/15 bg-white text-black/75 hover:border-black/35 dark:border-white/15 dark:bg-white/[0.03] dark:text-white/75'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-black/12 bg-white p-6 dark:border-white/12 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-black/55 dark:text-white/55">{currentFlow.badge}</span>
                <span className="font-mono text-[11px] text-black/50 dark:text-white/50">AI for judgment · Software for exact math</span>
              </div>
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

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-3.5 text-xs text-black/65 dark:border-white/10 dark:text-white/65">
                <span>
                  <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
                  {currentFlow.note}
                </span>
                <Link href="/signup" className="font-semibold text-black underline underline-offset-4 dark:text-white">
                  Try {currentFlow.label.toLowerCase()} →
                </Link>
              </div>
            </div>
          </div>

          {/* 3-Step Lead-to-Payment Band */}
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02]">
              <span className="font-mono text-xs text-black/45 dark:text-white/45">Step 1 · Capture leads</span>
              <h3 className="mt-1.5 text-base font-semibold">Stay organized and never miss a lead</h3>
              <p className="mt-1 text-xs leading-relaxed text-black/65 dark:text-white/65">
                Keep every new inquiry in one place, see who is ready to buy, and let your AI helper draft a warm follow-up if someone goes quiet.
              </p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02]">
              <span className="font-mono text-xs text-black/45 dark:text-white/45">Step 2 · Quote &amp; get paid</span>
              <h3 className="mt-1.5 text-base font-semibold">Simplify booking, proposals, and payments</h3>
              <p className="mt-1 text-xs leading-relaxed text-black/65 dark:text-white/65">
                Send a clean quote link your client can accept in one click. Once they say yes, Borga creates the invoice and project board for you.
              </p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02]">
              <span className="font-mono text-xs text-black/45 dark:text-white/45">Step 3 · Keep clean books</span>
              <h3 className="mt-1.5 text-base font-semibold">Keep every project and dollar on track</h3>
              <p className="mt-1 text-xs leading-relaxed text-black/65 dark:text-white/65">
                Every paid invoice, bill, and sale updates your accounting automatically—so tax time and monthly reports are already done.
              </p>
            </div>
          </div>
        </section>

        {/* PUT AI TO WORK */}
        <section id="ai-work" className="border-b border-black/10 py-16 sm:py-20 dark:border-white/10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-widest text-black/50 dark:text-white/50">
                Put AI to Work · Real Answers from Your Business
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Ask who&apos;s overdue, what you quoted a client, or how this month looks. The answers come from your account, not the internet.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-black/65 dark:text-white/65">
                Your AI helpers know your clients, projects, and books—so they can draft emails, summarize busy threads, and flag what needs your attention today, while real accounting code handles the math.
              </p>
            </div>
            <Link href="/signup" className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-4">
              Try Borga AI in your workspace <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {AI_WORK_PILLARS.map((p) => (
              <div key={p.title} className="flex flex-col justify-between rounded-xl border border-black/12 bg-white p-5 dark:border-white/12 dark:bg-white/[0.03]">
                <div>
                  <span className="rounded bg-black/5 px-2 py-0.5 font-mono text-[11px] font-medium dark:bg-white/10">
                    {p.tag}
                  </span>
                  <h3 className="mt-3 text-base font-semibold">{p.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-black/65 dark:text-white/65">{p.desc}</p>
                </div>
                <p className="mt-4 rounded-lg border border-black/10 bg-[#fbfbfb] px-3 py-2 font-mono text-[11px] text-black/75 dark:border-white/10 dark:bg-black/30 dark:text-white/75">
                  {p.sample}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* BUILT FOR ANYONE WITH CLIENTS */}
        <section id="business-types" className="border-b border-black/10 py-16 sm:py-20 dark:border-white/10">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-black/50 dark:text-white/50">
              Built for Anyone with Clients
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              From solo consultants and agencies to growing teams.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-black/65 dark:text-white/65">
              Turn on only the tools your business uses today, and switch more on as you grow.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {BUSINESS_TYPES.map((b) => (
              <Link
                key={b.title}
                href={b.href}
                className="group flex flex-col justify-between rounded-xl border border-black/12 bg-white p-5 transition hover:border-black/35 dark:border-white/12 dark:bg-white/[0.03] dark:hover:border-white/35"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-black/50 dark:text-white/50">{b.role}</span>
                    <ArrowUpRight className="h-4 w-4 text-black/40 transition group-hover:text-black dark:text-white/40 dark:group-hover:text-white" />
                  </div>
                  <h3 className="mt-2 text-base font-semibold group-hover:underline">{b.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-black/65 dark:text-white/65">{b.desc}</p>
                </div>
                <div className="mt-5 border-t border-black/10 pt-3 text-[11px] dark:border-white/10">
                  <p className="italic text-black/75 dark:text-white/75">{b.quote}</p>
                  <p className="mt-1 font-medium text-black/55 dark:text-white/55">— {b.author}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* WORK WITH VETTED ADVISORS — Shared Services Marketplace */}
        <section id="work-with-us" className="border-b border-black/10 py-16 sm:py-20 dark:border-white/10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-widest text-black/50 dark:text-white/50">
                Shared Services Portal (/services)
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Want an expert to handle your books, sales, or marketing?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-black/65 dark:text-white/65">
                Book a call with a vetted accountant, CFO, project manager, or agency right inside Borga. You choose which tabs they can see—and adding an advisor never costs you an extra $2/month user seat.
              </p>
            </div>
            <Link href="/login?role=advisor&next=/services" className="text-xs font-semibold underline underline-offset-4">
              Are you an advisor or agency? Sign in here →
            </Link>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {SHARED_SERVICES_OFFERS.map((s) => (
              <Link
                key={s.title}
                href={s.href}
                className="group flex flex-col justify-between rounded-xl border border-black/12 bg-white p-5 transition hover:border-black/35 dark:border-white/12 dark:bg-white/[0.03] dark:hover:border-white/35"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="rounded bg-black/5 px-2 py-0.5 font-mono text-[11px] font-medium dark:bg-white/10">
                      {s.badge}
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-black/40 transition group-hover:text-black dark:text-white/40 dark:group-hover:text-white" />
                  </div>
                  <h3 className="mt-3 text-base font-semibold group-hover:underline">{s.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-black/65 dark:text-white/65">{s.desc}</p>
                </div>

                <div className="mt-6 border-t border-black/10 pt-4 dark:border-white/10">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-base font-bold">{s.price}</span>
                    <span className="text-[11px] text-black/55 dark:text-white/55">{s.priceSub}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-black/10 pt-3 text-[11px] dark:border-white/10">
                    {s.specs.map((sp) => (
                      <div key={sp.k}>
                        <dt className="text-black/45 dark:text-white/45">{sp.k}</dt>
                        <dd className="mt-0.5 font-medium">{sp.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Link>
            ))}
          </div>

          {/* Customer Testimonials */}
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.author} className="rounded-xl border border-black/10 bg-white p-5 text-xs dark:border-white/10 dark:bg-white/[0.02]">
                <p className="italic leading-relaxed text-black/80 dark:text-white/80">&ldquo;{t.quote}&rdquo;</p>
                <p className="mt-3 font-semibold text-black dark:text-white">{t.author}</p>
                <p className="text-[11px] text-black/55 dark:text-white/55">{t.role}</p>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="py-16 sm:py-20">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-black/50 dark:text-white/50">
              Simple, Honest Pricing
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Move to Borga with confidence.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-black/65 dark:text-white/65">
              One straightforward price for your whole team: $2 per person per month. Hired accountants and agencies get a free seat, and Borga keeps a 15% platform fee from their service payout.
            </p>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-12">
            <div className="flex flex-col justify-between rounded-xl border border-black bg-white p-6 lg:col-span-4 dark:border-white dark:bg-white/[0.04]">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase">Your Company</span>
                  <span className="rounded bg-black px-2 py-0.5 font-mono text-[10px] text-white dark:bg-white dark:text-black">Everything Included</span>
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-bold">$2</span>
                  <span className="text-xs text-black/60 dark:text-white/60">/ team member / month</span>
                </div>
                <p className="mt-2 text-xs text-black/65 dark:text-white/65">
                  Every tool you need to manage clients, projects, payments, bookkeeping, and AI helpers.
                </p>
                <ul className="mt-4 space-y-2 border-t border-black/10 pt-4 text-xs dark:border-white/10">
                  <li>✓ Unlimited clients, leads, quotes &amp; projects</li>
                  <li>✓ Invoices, online payments &amp; bank matching</li>
                  <li>✓ Full bookkeeping, fixed assets &amp; tax worksheets</li>
                  <li>✓ Private client portal links &amp; shared inbox</li>
                  <li>✓ 16 AI helpers &amp; custom workflow builder</li>
                  <li>✓ Outside advisors &amp; accountants don&apos;t add a seat</li>
                </ul>
              </div>
              <Link
                href="/signup?role=company"
                className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[#111111] py-2.5 text-xs font-semibold text-white transition hover:bg-black/85 dark:bg-white dark:text-black"
              >
                Create Company Workspace <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-black/15 bg-white p-6 lg:col-span-4 dark:border-white/15 dark:bg-white/[0.02]">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase">Advisors &amp; Agencies</span>
                  <span className="rounded bg-black/5 px-2 py-0.5 font-mono text-[10px] dark:bg-white/10">Shared Services</span>
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-bold">85%</span>
                  <span className="text-xs text-black/60 dark:text-white/60">you keep (15% platform fee)</span>
                </div>
                <p className="mt-2 text-xs text-black/65 dark:text-white/65">
                  List your services, take discovery calls, send proposals or fixed packages, and work inside client workspaces.
                </p>
                <ul className="mt-4 space-y-2 border-t border-black/10 pt-4 text-xs dark:border-white/10">
                  <li>✓ Free to list your practice &amp; packages</li>
                  <li>✓ Built-in call booking &amp; video rooms</li>
                  <li>✓ Offer monthly retainers or fixed-price packages</li>
                  <li>✓ Work right inside the client tabs unlocked for you</li>
                  <li>✓ Automatic 85% / 15% split &amp; client receipt</li>
                  <li>✓ Clear activity log of everything you deliver</li>
                </ul>
              </div>
              <Link
                href="/login?role=advisor&next=/services"
                className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-black/20 py-2.5 text-xs font-semibold transition hover:border-black dark:border-white/20"
              >
                Open Advisor Portal (/services) <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {/* Interactive Pricing & Split Calculator */}
            <div className="flex flex-col justify-between rounded-xl border border-black/12 bg-white p-6 text-xs lg:col-span-4 dark:border-white/12 dark:bg-white/[0.03]">
              <div>
                <p className="font-mono text-xs font-semibold uppercase">Quick Cost Calculator</p>
                <p className="mt-1 text-black/60 dark:text-white/60">
                  See what your team pays per month and how advisor fees split.
                </p>
                <div className="mt-4 space-y-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium">People on your team ($2/mo each)</span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={calcSeats}
                      onChange={(e) => setCalcSeats(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full rounded-md border border-black/15 bg-[#fbfbfb] px-3 py-1.5 font-mono text-xs dark:border-white/15 dark:bg-black"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium">Advisor or agency project fee ($ USD)</span>
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={calcRetainer}
                      onChange={(e) => setCalcRetainer(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-md border border-black/15 bg-[#fbfbfb] px-3 py-1.5 font-mono text-xs dark:border-white/15 dark:bg-black"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-5 space-y-2 border-t border-black/10 pt-4 font-mono text-xs dark:border-white/10">
                <div className="flex justify-between">
                  <span>Your monthly workspace bill:</span>
                  <strong>${seatMonthly.toFixed(2)} / mo</strong>
                </div>
                <div className="flex justify-between">
                  <span>Extra seat cost for your advisor:</span>
                  <strong>$0.00 (Free)</strong>
                </div>
                <div className="flex justify-between">
                  <span>Advisor takes home (85%):</span>
                  <strong>${advisorNet.toLocaleString()}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Borga platform fee (15%):</span>
                  <strong>${platformCut.toLocaleString()}</strong>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-black/10 bg-white/60 py-14 text-xs dark:border-white/10 dark:bg-white/[0.01]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <p className="font-semibold text-black dark:text-white">Manage Clients</p>
              <ul className="mt-3 space-y-2 text-black/65 dark:text-white/65">
                <li><a href="#clientflow" className="hover:underline">Sales Pipeline</a></li>
                <li><a href="#clientflow" className="hover:underline">Quotes &amp; Proposals</a></li>
                <li><a href="#clientflow" className="hover:underline">Client Portal Links</a></li>
                <li><a href="#clientflow" className="hover:underline">Shared Inbox</a></li>
                <li><a href="#clientflow" className="hover:underline">Support Tickets</a></li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-black dark:text-white">Money &amp; Books</p>
              <ul className="mt-3 space-y-2 text-black/65 dark:text-white/65">
                <li><a href="#clientflow" className="hover:underline">Invoices &amp; Payments</a></li>
                <li><a href="#clientflow" className="hover:underline">Bookkeeping &amp; Ledger</a></li>
                <li><a href="#clientflow" className="hover:underline">Bank Matching</a></li>
                <li><a href="#clientflow" className="hover:underline">Cap Table &amp; Equity</a></li>
                <li><a href="#clientflow" className="hover:underline">Tax Worksheets</a></li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-black dark:text-white">Shared Services</p>
              <ul className="mt-3 space-y-2 text-black/65 dark:text-white/65">
                <li><Link href="/services" className="hover:underline">Advisor &amp; Agency Portal</Link></li>
                <li><Link href="/services" className="hover:underline">Book a Discovery Call</Link></li>
                <li><Link href="/services" className="hover:underline">Fixed-Price Packages</Link></li>
                <li><Link href="/services" className="hover:underline">Share Specific Tabs</Link></li>
                <li><Link href="/services" className="hover:underline">85 / 15 Fee Split</Link></li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-black dark:text-white">Log in as ▸</p>
              <ul className="mt-3 space-y-2 text-black/65 dark:text-white/65">
                <li><Link href="/login?role=company&next=/app" className="hover:underline">Your Company (/app)</Link></li>
                <li><Link href="/login?role=advisor&next=/services" className="hover:underline">Advisor &amp; Agency (/services)</Link></li>
                <li><Link href="/login?role=admin&next=/admin" className="hover:underline">System Admin (/admin)</Link></li>
                <li><Link href="/signup" className="hover:underline">Create an Account</Link></li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-black dark:text-white">Developers &amp; Admin</p>
              <ul className="mt-3 space-y-2 text-black/65 dark:text-white/65">
                <li><Link href="/developers" className="hover:underline">API &amp; Webhooks</Link></li>
                <li><Link href="/admin" className="hover:underline">Admin Portal</Link></li>
                <li><Link href="/forgot" className="hover:underline">Reset Password</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-black/10 pt-6 text-[11px] text-black/55 dark:border-white/10 dark:text-white/55">
            <div className="flex flex-wrap items-center gap-4">
              <span>© {new Date().getFullYear()} Borga</span>
              <span>·</span>
              <span>$2/user/mo + 15% Shared Services fee</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>All systems up and running</span>
            </div>
          </div>
        </div>
      </footer>

      {/* ASK A QUESTION ⌘K MODAL */}
      {askOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20 backdrop-blur-xs"
          onClick={() => setAskOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-black/15 bg-[#fbfbfb] p-4 shadow-2xl dark:border-white/15 dark:bg-[#141417]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-black/10 pb-3 dark:border-white/10">
              <Search className="h-4 w-4 text-black/50 dark:text-white/50" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask about pricing, hiring an advisor, or which login to pick…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setAskOpen(false)}
                className="rounded p-1 text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto">
              {filteredAnswers.map((item) => (
                <div key={item.q} className="rounded-lg border border-black/10 bg-white p-3 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                  <p className="font-semibold">{item.q}</p>
                  <p className="mt-1 leading-relaxed text-black/65 dark:text-white/65">{item.a}</p>
                  <Link
                    href={item.href}
                    onClick={() => setAskOpen(false)}
                    className="mt-2 inline-flex items-center gap-1 font-medium underline underline-offset-4"
                  >
                    {item.cta} <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-2.5 text-[11px] text-black/50 dark:border-white/10 dark:text-white/50">
              <span className="inline-flex items-center gap-1">
                <Command className="h-3 w-3" /> Press <kbd className="rounded border px-1 font-mono">Esc</kbd> or <kbd className="rounded border px-1 font-mono">⌘K</kbd> to close
              </span>
              <div className="flex gap-3">
                <Link href="/login?role=company&next=/app" className="underline">Company Login</Link>
                <Link href="/login?role=advisor&next=/services" className="underline">Advisor Login</Link>
                <Link href="/login?role=admin&next=/admin" className="underline">Admin Login</Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
