'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── page state ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** True once the intro loader has left; hero reveals wait for it. */
export const ReadyContext = createContext(false);
/** Opens the "start" dialog from anywhere on the page. */
export const StartContext = createContext<() => void>(() => {});

export const EASE_OUT = 'cubic-bezier(.22,1,.36,1)';
export const EASE_SNAP = 'cubic-bezier(.2,.8,.2,1)';

let locks = 0;
/** Locks or unlocks page scrolling. Several things can lock at once (loader, menu, dialog); it unlocks when the last lets go. */
export function setScrollLocked(lock: boolean) {
  locks = Math.max(0, locks + (lock ? 1 : -1));
  const el = document.documentElement;
  if (locks > 0) { el.style.overflow = 'hidden'; } else { el.style.removeProperty('overflow'); }
}

/**
 * The landing page is sized in rem and the root font-size follows the viewport (media queries in globals.css under `.landing-grid`).
 * Above 1920px it keeps growing, damped, so big screens do not just get wider margins. Everything is undone on leaving the page.
 */
export function useAdaptiveGrid() {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add('landing-grid');
    const apply = () => {
      const base = 16;
      const w = window.innerWidth;
      const reduction = ((1920 - w) / 1920) * 100;
      const size = base - (base * (reduction * 0.6666)) / 100;
      if (size > base) el.style.fontSize = `${size}px`;
      else el.style.removeProperty('font-size');
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      el.classList.remove('landing-grid');
      el.style.removeProperty('font-size');
    };
  }, []);
}

/** Local time and date, read on the client only (so the server and browser never disagree). Null until the first tick. */
export function useClock() {
  const [now, setNow] = useState<{ time: string; date: string } | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const h = d.getHours();
      setNow({
        time: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`,
        date: `${d.getDate()} ${d.toLocaleString('en-US', { month: 'long' })}, ${d.getFullYear()}`,
      });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(q.matches);
    const on = () => setR(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return r;
}

/** True once the element has scrolled into view (once). With `gated`, also waits for the intro loader. */
export function useInView<T extends Element>(gated = false) {
  const ready = useContext(ReadyContext);
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { ref, shown: seen && (!gated || ready) };
}

// ── reveals ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fades and slides its content in when it scrolls into view. */
export function Reveal({ as, delay = 0, y = 24, scale, gated = false, duration = 750, className, style, children }: {
  as?: ElementType; delay?: number; y?: number; scale?: number; gated?: boolean; duration?: number; className?: string; style?: CSSProperties; children: ReactNode;
}) {
  const Tag = (as ?? 'div') as ElementType;
  const { ref, shown } = useInView<HTMLElement>(gated);
  const hidden = `translateY(${y}px)${scale ? ` scale(${scale})` : ''}`;
  return (
    <Tag
      ref={ref}
      className={cn('motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:!transition-none', className)}
      style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : hidden, transition: `opacity ${duration}ms ${EASE_OUT} ${delay}ms, transform ${duration}ms ${EASE_OUT} ${delay}ms`, ...style }}
    >
      {children}
    </Tag>
  );
}

/** A heading revealed line by line: each line slides up out of a clip. */
export function LineReveal({ lines, as, delay = 0, stagger = 110, gated = false, className }: {
  lines: string[]; as?: ElementType; delay?: number; stagger?: number; gated?: boolean; className?: string;
}) {
  const Tag = (as ?? 'h2') as ElementType;
  const { ref, shown } = useInView<HTMLElement>(gated);
  return (
    <Tag ref={ref} className={className}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.08em]">
          <span
            className="block motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:!transition-none"
            style={{ transform: shown ? 'none' : 'translateY(105%)', opacity: shown ? 1 : 0, transition: `transform 900ms cubic-bezier(.215,.61,.355,1) ${delay + i * stagger}ms, opacity 900ms ease ${delay + i * stagger}ms` }}
          >
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}

/** A statement revealed word by word. `parts` lets a tail of the sentence take a different style. */
export function WordReveal({ parts, className }: { parts: Array<{ text: string; className?: string }>; className?: string }) {
  const { ref, shown } = useInView<HTMLHeadingElement>();
  let n = 0;
  return (
    <h2 ref={ref} className={className}>
      {parts.map((p, pi) => (
        <span key={pi} className={p.className}>
          {p.text.split(' ').filter(Boolean).map((w) => {
            const i = n++;
            return (
              <span
                key={i}
                className="inline-block motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:!transition-none"
                style={{ transform: shown ? 'none' : 'translateY(24px)', opacity: shown ? 1 : 0, transition: `transform 700ms cubic-bezier(.165,.84,.44,1) ${i * 35}ms, opacity 700ms ease ${i * 35}ms` }}
              >
                {w}&nbsp;
              </span>
            );
          })}
        </span>
      ))}
    </h2>
  );
}

// ── small parts ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden className={cn('h-[1em] w-[1em]', className)}>
      <path d="M24 2c2.2 13.8 7.9 19.6 22 22-14.1 2.4-19.8 8.2-22 22-2.2-13.8-7.9-19.6-22-22 14.1-2.4 19.8-8.2 22-22Z" />
    </svg>
  );
}

export function Eyebrow({ children, tone = 'dark', bordered }: { children: ReactNode; tone?: 'dark' | 'light'; bordered?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm font-medium', tone === 'dark' ? 'text-foreground/70' : 'text-background/70', bordered && 'rounded-full border border-border px-4 py-1.5')}>
      <span className={cn('size-1.5 rounded-full', tone === 'dark' ? 'bg-foreground/50' : 'bg-background/60')} />
      {children}
    </span>
  );
}

/** A pill button or link. With `arrow`, a round badge with an arrow that nudges on hover. */
export function PillButton({ children, variant = 'dark', arrow, href, onClick, type = 'button', disabled, className }: {
  children: ReactNode; variant?: 'dark' | 'light' | 'outline'; arrow?: 'right' | 'up-right'; href?: string; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; className?: string;
}) {
  const look = variant === 'dark' ? 'bg-foreground text-background' : variant === 'light' ? 'bg-muted text-foreground' : 'border border-border bg-transparent text-foreground';
  const badge = variant === 'dark' ? 'bg-background text-foreground' : 'bg-foreground text-background';
  const inner = (
    <span className={cn('inline-flex items-center gap-3 rounded-full text-sm font-medium', look, arrow ? 'py-1.5 pl-6 pr-1.5' : 'px-7 py-3.5')}>
      {children}
      {arrow && (
        <span className={cn('grid size-9 place-items-center rounded-full text-base', badge)}>
          {arrow === 'right'
            ? <ArrowRight className="size-4 transition-transform duration-300 group-hover/pill:translate-x-[3px]" style={{ transitionTimingFunction: EASE_SNAP }} />
            : <ArrowUpRight className="size-4 transition-transform duration-300 group-hover/pill:-translate-y-[2px] group-hover/pill:translate-x-[2px]" style={{ transitionTimingFunction: EASE_SNAP }} />}
        </span>
      )}
    </span>
  );
  const cls = cn('group/pill inline-block transition-transform duration-300 hover:scale-[1.04] disabled:opacity-60', className);
  const style = { transitionTimingFunction: EASE_SNAP };
  if (href) return href.startsWith('/') ? <Link href={href} className={cls} style={style}>{inner}</Link> : <a href={href} className={cls} style={style}>{inner}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>{inner}</button>;
}

/** Smooth-scrolls to a section by id (the page's scroll behaviour is smooth while the landing page is mounted). */
export function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Scroll progress of an element: 0 when its top reaches the bottom of the screen, 1 when its centre reaches the middle. */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [p, setP] = useState(0);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    setP(Math.min(1, Math.max(0, (vh - r.top) / (vh / 2 + r.height / 2))));
  }, []);
  useEffect(() => {
    let last = 0;
    const on = () => { const now = performance.now(); if (now - last > 30) { last = now; update(); } };
    update();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, [update]);
  return { ref, p };
}
