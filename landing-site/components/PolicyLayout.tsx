import type { ReactNode } from 'react';
import { ArrowLeft, Boxes } from 'lucide-react';
import { SiteFooter } from '@/components/SiteFooter';

export function PolicyLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">Borga</span>
        </a>
        <a href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back home
        </a>
      </header>
      <article className="mx-auto max-w-3xl px-6 pb-20 pt-6">
        <h1 className="text-4xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>
        <div className="policy-body mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
          {children}
        </div>
      </article>
      <SiteFooter />
      <style>{`
        .policy-body h2 { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em; padding-top: 0.5rem; }
        .policy-body h3 { font-size: 1rem; font-weight: 600; }
        .policy-body ul { list-style: disc; padding-left: 1.4rem; display: grid; gap: 0.35rem; }
        .policy-body table { width: 100%; font-size: 0.85rem; border-collapse: collapse; }
        .policy-body th { text-align: left; padding: 0.5rem 0.75rem; background: var(--card); border-bottom: 2px solid var(--border); }
        .policy-body td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); vertical-align: top; }
        .policy-body a { text-decoration: underline; }
      `}</style>
    </main>
  );
}
