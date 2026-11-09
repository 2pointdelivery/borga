import { Boxes } from 'lucide-react';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://borga.example.com';

const COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Sales', href: '/#product' },
      { label: 'Marketing', href: '/#product' },
      { label: 'Finance', href: '/#product' },
      { label: 'Agent fleet', href: '/#product' },
      { label: 'Company OS', href: '/#product' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About us', href: '/#about' },
      { label: 'Contact', href: '/#contact' },
      { label: 'Careers', href: '/#contact' },
      { label: 'News', href: '/#faq' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Imprint', href: '/imprint' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Cookies', href: '/cookies' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Boxes className="h-5 w-5" />
              </span>
              <span className="text-lg font-bold tracking-tight">Borga</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Your company. One mission. The agent-powered operating system for sales, marketing, finance, people and valuation.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={`${APP_URL}/signup`} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
                Get started
              </a>
              <a href="/#contact" className="rounded-full border border-border px-4 py-2 text-xs font-semibold hover:bg-muted">
                Contact
              </a>
            </div>
          </div>
          {COLS.map((c) => (
            <div key={c.title}>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Borga — AI Company OS. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <a href="/imprint" className="hover:text-foreground">Imprint</a>
            <a href="/privacy" className="hover:text-foreground">Data protection</a>
            <a href="/terms" className="hover:text-foreground">Terms</a>
            <a href="/cookies" className="hover:text-foreground">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
