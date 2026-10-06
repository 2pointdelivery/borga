'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type AdvisorMood = 'happy' | 'worried' | 'talking' | 'celebrating';

/**
 * The advisor's personality: a living face, not an icon. Eyes blink every few
 * seconds, pupils drift toward the cursor, and the smile reacts to the mood —
 * beaming when all is clear, concerned when something needs attention, and
 * chatting away while the panel or a popup speaks.
 */
export function AdvisorAvatar({ mood, size = 56 }: { mood: AdvisorMood; size?: number }) {
  const [blink, setBlink] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const gazeAt = useRef(0);

  // Natural blinking on a 2.8–6s rhythm.
  useEffect(() => {
    let alive = true;
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t1 = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t2 = setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          schedule();
        }, 160);
      }, 2800 + Math.random() * 3200);
    };
    schedule();
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Pupils follow the cursor (throttled) — the advisor feels present.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - gazeAt.current < 120) return;
      gazeAt.current = now;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setGaze({
        x: Math.max(-3, Math.min(3, ((e.clientX - cx) / cx) * 3)),
        y: Math.max(-2, Math.min(2.5, ((e.clientY - cy) / cy) * 2.5)),
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const worried = mood === 'worried';
  const talking = mood === 'talking';
  const celebrating = mood === 'celebrating';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      role="img"
      aria-label={worried ? 'Advisor — something needs attention' : talking ? 'Advisor speaking' : 'Advisor'}
      className="drop-shadow-lg"
    >
      <defs>
        <linearGradient id="advisor-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      {/* head */}
      <circle cx="28" cy="28" r="26" fill="url(#advisor-face)" />
      <circle cx="28" cy="28" r="26" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      {/* blush when happy / celebrating */}
      {(mood === 'happy' || celebrating) && (
        <>
          <ellipse cx="14.5" cy="33" rx="4" ry="2.6" fill="#f9a8d4" opacity="0.55" />
          <ellipse cx="41.5" cy="33" rx="4" ry="2.6" fill="#f9a8d4" opacity="0.55" />
        </>
      )}
      {/* brows — raised when worried */}
      <line x1="16" y1={worried ? 15 : 16.5} x2="24" y2={worried ? 17.5 : 16.5} stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" />
      <line x1="32" y1={worried ? 17.5 : 16.5} x2="40" y2={worried ? 15 : 16.5} stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" />
      {/* eyes */}
      {[20, 36].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="24" rx="5.2" ry={blink ? 0.8 : 6} fill="#fff" className="transition-all duration-100" />
          {!blink && (
            <circle cx={cx + gaze.x} cy={24.5 + gaze.y} r="2.6" fill="#1e1b4b" />
          )}
          {!blink && (
            <circle cx={cx + gaze.x - 0.8} cy={23.6 + gaze.y} r="0.9" fill="#fff" />
          )}
        </g>
      ))}
      {/* mouth */}
      {talking ? (
        <ellipse cx="28" cy="40" rx="4.5" ry="5" fill="#1e1b4b" className="borga-talk-mouth" />
      ) : worried ? (
        <path d="M22 42 Q28 38.5 34 42" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      ) : celebrating ? (
        <path d="M20 37 Q28 47 36 37 Q28 41 20 37 Z" fill="#fff" />
      ) : (
        <path d="M21 38 Q28 44 35 38" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      )}
      {/* sparkle on the cheek while celebrating */}
      {celebrating && (
        <g className={cn('borga-blink')} stroke="#fde68a" strokeWidth="1.6" strokeLinecap="round">
          <line x1="45" y1="12" x2="45" y2="18" />
          <line x1="42" y1="15" x2="48" y2="15" />
        </g>
      )}
    </svg>
  );
}
