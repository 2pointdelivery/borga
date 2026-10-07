'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_OUT, LogoMark, PillButton, goTo, setScrollLocked, useClock, useReducedMotion } from './landing-ui';

export interface NavItem { label: string; id?: string; href?: string; start?: boolean }

const FILL_MS = 1300;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Full-screen intro: counts 000 → 100, then slides up. The hero reveals start once it has left. */
export function PageLoader({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setScrollLocked(false);
    setGone(true);
    onDone();
  };

  useEffect(() => {
    setScrollLocked(true);
    return () => { if (!finished.current) setScrollLocked(false); };
  }, []);

  useEffect(() => {
    if (reduced) { finish(); return; }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / FILL_MS);
      setProgress(Math.round(easeInOutCubic(p) * 100));
      if (p < 1) raf = requestAnimationFrame(step);
      else setLeaving(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // safety: never trap the page behind the loader
  useEffect(() => { const t = setTimeout(finish, FILL_MS + 2500); return () => clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  return (
    <div
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-8 rounded-b-[2rem] bg-foreground text-background"
      style={{ transform: leaving ? 'translateY(-100%)' : 'translateY(0)', transition: `transform 750ms ${EASE_OUT}` }}
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && leaving) finish(); }}
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col items-center gap-5 text-center" style={{ opacity: leaving ? 0 : 1, transform: leaving ? 'translateY(-12px)' : 'none', transition: `all 400ms ${EASE_OUT}` }}>
        <div className="flex items-center gap-3 text-2xl font-semibold sm:text-3xl"><LogoMark className="text-3xl text-[var(--chart-1)]" /> Borga</div>
        <p className="max-w-[24ch] text-sm text-background/55">Your whole company, run by agents.</p>
      </div>
      <div className="flex w-[min(22rem,72vw)] flex-col gap-3">
        <div className="h-px bg-background/15"><div className="h-full bg-[var(--chart-1)]" style={{ width: `${progress}%`, transition: 'width .1s ease-out' }} /></div>
        <div className="flex justify-between text-xs font-medium uppercase tracking-wider text-background/45">
          <span>Loading</span>
          <span className="tabular-nums text-background/80">{String(progress).padStart(3, '0')}</span>
        </div>
      </div>
    </div>
  );
}

/** Full-screen menu. */
export function NavMenu({ open, items, onClose, onStart }: { open: boolean; items: NavItem[]; onClose: () => void; onStart: () => void }) {
  const clock = useClock();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setScrollLocked(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', esc);
      return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', esc); setScrollLocked(false); };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open, onClose]);

  if (!mounted) return null;
  const choose = (it: NavItem) => {
    onClose();
    if (it.start) { onStart(); return; }
    if (it.href) { router.push(it.href); return; }
    if (it.id) setTimeout(() => goTo(it.id as string), 340);
  };
  return (
    <div className="fixed inset-0 z-[115] flex flex-col bg-foreground text-background" style={{ opacity: shown ? 1 : 0, transition: 'opacity 300ms ease' }} role="dialog" aria-modal aria-label="Menu">
      <div className="mx-auto flex w-full max-w-[88rem] items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <span className="flex items-center gap-2 text-lg font-semibold"><LogoMark className="text-xl text-[var(--chart-1)]" /> Borga</span>
        <button onClick={onClose} className="inline-flex items-center gap-2 rounded-[0.875rem] border border-background/15 px-4 py-2 text-xs font-medium uppercase tracking-wider text-background/70 transition hover:border-background/40 hover:text-background">
          <X className="size-3.5" /> Close
        </button>
      </div>
      <nav className="mx-auto flex w-full max-w-[88rem] flex-1 flex-col justify-center px-5 sm:px-8" aria-label="Menu">
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li key={it.label}>
              <button
                onClick={() => choose(it)}
                className="group flex w-full items-baseline gap-4 py-2 text-left text-4xl font-semibold tracking-tight sm:text-6xl"
                style={{ transform: shown ? 'none' : 'translateY(1rem)', opacity: shown ? 1 : 0, transition: `all 500ms ease-out ${i * 45 + 80}ms` }}
              >
                <span className="text-base font-normal text-background/30 transition-colors group-hover:text-[var(--chart-1)]">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-background/70 transition-colors duration-300 group-hover:text-background">{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-3 border-t border-background/10 px-5 py-6 text-xs uppercase tracking-wide text-background/45 sm:flex-row sm:justify-between sm:px-8">
        <span>Local time{clock ? ` — ${clock.time}` : ''}</span>
        <button onClick={() => { onClose(); onStart(); }} className="text-background/70 hover:text-background hover:underline">Start your workspace →</button>
      </div>
    </div>
  );
}

/** The "start" dialog. Borga signup is by invitation, so this hands the email to the real signup page rather than pretending to send anything. */
export function StartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (open) {
      setMounted(true);
      setScrollLocked(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', esc);
      return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', esc); setScrollLocked(false); };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 320);
    return () => clearTimeout(t);
  }, [open, onClose]);

  if (!mounted) return null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onClose();
    router.push(`/signup${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`);
  };
  const field = 'w-full rounded-[0.875rem] border border-border bg-muted/50 px-4 py-3 text-sm outline-none transition focus:border-foreground/30 focus:bg-background';
  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-foreground/30 p-4 backdrop-blur-lg sm:items-center"
      style={{ opacity: shown ? 1 : 0, transition: 'opacity 260ms ease' }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Start your workspace"
    >
      <div
        className={cn('relative w-full max-w-[32rem] overflow-hidden rounded-[2rem] bg-background p-6 shadow-2xl ring-1 ring-border sm:p-8')}
        style={{ transform: shown ? 'none' : 'translateY(28px)', transition: `transform 400ms ${EASE_OUT}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-muted text-foreground/60 transition hover:bg-accent hover:text-foreground"><X className="size-4" /></button>
        <div className="mb-6 flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground/60"><span className="size-1.5 rounded-full bg-[var(--chart-1)]" /> Start your workspace</span>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Run your company on Borga.</h2>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">Work email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus className={field} />
          </label>
          <p className="text-xs text-foreground/45">Signup is by invitation: use the address your invite was sent to. Your email only travels to the next page.</p>
          <div className="mt-2 flex items-center justify-between gap-4">
            <Link href="/login" onClick={onClose} className="text-xs text-foreground/55 underline-offset-2 hover:text-foreground hover:underline">I already have an account</Link>
            <PillButton type="submit" arrow="up-right">Continue</PillButton>
          </div>
        </form>
      </div>
    </div>
  );
}
