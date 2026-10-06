'use client';

import { useEffect, useRef, useState } from 'react';

export type AdvisorMood = 'happy' | 'worried' | 'talking' | 'celebrating';

/**
 * The advisor's face: a small, friendly green robot. Its eyes blink every few seconds and look toward the cursor, its antenna light
 * glows, and its expression follows the mood: a warm smile when all is clear, a gentle frown when something needs attention, an open
 * mouth while it speaks, and a big grin with sparkles when there is good news.
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
        }, 150);
      }, 2800 + Math.random() * 3200);
    };
    schedule();
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Pupils follow the cursor (throttled), so the advisor feels present.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - gazeAt.current < 120) return;
      gazeAt.current = now;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setGaze({
        x: Math.max(-2.4, Math.min(2.4, ((e.clientX - cx) / cx) * 2.4)),
        y: Math.max(-1.6, Math.min(2, ((e.clientY - cy) / cy) * 2)),
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
      aria-label={worried ? 'Advisor: something needs attention' : talking ? 'Advisor speaking' : 'Advisor'}
      className="drop-shadow-lg"
    >
      <defs>
        <linearGradient id="advisor-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="100%" stopColor="#16a34a" />
        </linearGradient>
        <linearGradient id="advisor-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#15803d" />
          <stop offset="100%" stopColor="#166534" />
        </linearGradient>
      </defs>

      {/* antenna with a glowing light */}
      <line x1="28" y1="5.5" x2="28" y2="11" stroke="#15803d" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="28" cy="4.2" r="3" fill={worried ? '#fbbf24' : '#fef08a'} className={talking || celebrating ? 'borga-blink' : undefined} />
      <circle cx="27.2" cy="3.4" r="0.9" fill="#fff" opacity="0.85" />

      {/* ears */}
      <rect x="1" y="26" width="5" height="12" rx="2.5" fill="#15803d" />
      <rect x="50" y="26" width="5" height="12" rx="2.5" fill="#15803d" />

      {/* body */}
      <rect x="4" y="10" width="48" height="44" rx="15" fill="url(#advisor-body)" />
      <rect x="4" y="10" width="48" height="44" rx="15" fill="none" stroke="#15803d" strokeWidth="1.6" />
      <path d="M12 16 Q28 11 44 16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.35" />

      {/* face panel */}
      <rect x="10" y="18" width="36" height="28" rx="11" fill="url(#advisor-face)" />

      {/* cheeks */}
      {(mood === 'happy' || celebrating) && (
        <>
          <ellipse cx="14.5" cy="38" rx="3.2" ry="2.1" fill="#fda4af" opacity="0.65" />
          <ellipse cx="41.5" cy="38" rx="3.2" ry="2.1" fill="#fda4af" opacity="0.65" />
        </>
      )}

      {/* brows: tilted up when worried */}
      {worried && (
        <>
          <line x1="15" y1="22.5" x2="23" y2="24" stroke="#bbf7d0" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="33" y1="24" x2="41" y2="22.5" stroke="#bbf7d0" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}

      {/* eyes */}
      {[20, 36].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy="29.5" rx="5" ry={blink ? 0.7 : 6} fill="#fff" className="transition-all duration-100" />
          {!blink && <circle cx={cx + gaze.x} cy={30 + gaze.y} r="3" fill="#052e16" />}
          {!blink && <circle cx={cx + gaze.x - 0.9} cy={29 + gaze.y} r="1" fill="#fff" />}
        </g>
      ))}

      {/* mouth */}
      {talking ? (
        <ellipse cx="28" cy="40.5" rx="3.6" ry="3.6" fill="#052e16" className="borga-talk-mouth" />
      ) : worried ? (
        <path d="M23 41.5 Q28 38.5 33 41.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      ) : celebrating ? (
        <path d="M21.5 37.5 Q28 47 34.5 37.5 Q28 41 21.5 37.5 Z" fill="#fff" />
      ) : (
        <path d="M22.5 38.5 Q28 43.5 33.5 38.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      )}

      {/* sparkles while celebrating */}
      {celebrating && (
        <g className="borga-blink" stroke="#fde68a" strokeWidth="1.6" strokeLinecap="round">
          <line x1="49" y1="9" x2="49" y2="15" />
          <line x1="46" y1="12" x2="52" y2="12" />
          <line x1="7" y1="14" x2="7" y2="19" />
          <line x1="4.5" y1="16.5" x2="9.5" y2="16.5" />
        </g>
      )}
    </svg>
  );
}
