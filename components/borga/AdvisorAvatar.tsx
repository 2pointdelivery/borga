'use client';

import { useEffect, useRef, useState } from 'react';

export type AdvisorMood = 'happy' | 'worried' | 'talking' | 'celebrating';

/**
 * Friendly Illustrated Human Business Advisor portrait.
 *
 * Features:
 * - Warm circular portrait backdrop with tailored blazer & collared shirt
 * - Wavy hair with soft sheen, friendly round glasses with lens catchlight
 * - Natural eye-blinking (every 2.8–6s) and cursor-tracking gaze
 * - Mood-driven eyebrows, rosy cheeks, and mouth (warm smile, empathetic concern,
 *   animated speaking mouth, or beaming celebration with sparkles)
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
        }, 140);
      }, 2800 + Math.random() * 3200);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Pupils follow the cursor gently so the advisor feels attentive and present.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - gazeAt.current < 120) return;
      gazeAt.current = now;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setGaze({
        x: Math.max(-1.8, Math.min(1.8, ((e.clientX - cx) / cx) * 1.8)),
        y: Math.max(-1.2, Math.min(1.4, ((e.clientY - cy) / cy) * 1.4)),
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
      aria-label={
        worried
          ? 'Business advisor: something needs your attention'
          : talking
            ? 'Business advisor speaking'
            : 'Business advisor'
      }
      className="drop-shadow-md select-none"
    >
      <defs>
        <linearGradient id="advisor-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={worried ? '#fef3c7' : '#ecfdf5'} />
          <stop offset="100%" stopColor={worried ? '#fde68a' : '#d1fae5'} />
        </linearGradient>
        <linearGradient id="advisor-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3c69f" />
          <stop offset="100%" stopColor="#e2a87b" />
        </linearGradient>
        <linearGradient id="advisor-Suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <clipPath id="advisor-circle-clip">
          <circle cx="28" cy="28" r="25" />
        </clipPath>
      </defs>

      {/* Outer portrait medallion */}
      <circle cx="28" cy="28" r="26" fill="#ffffff" />
      <circle
        cx="28"
        cy="28"
        r="25.2"
        fill="url(#advisor-bg)"
        stroke={worried ? '#f59e0b' : '#10b981'}
        strokeWidth="1.5"
      />

      <g clipPath="url(#advisor-circle-clip)">
        {/* Soft background halo */}
        <circle cx="28" cy="24" r="19" fill="#ffffff" opacity="0.45" />

        {/* Back hair silhouette */}
        <path
          d="M14 25 C13 14, 20 9, 28 9 C36 9, 43 14, 42 25 C42 31, 40 35, 38 36 L18 36 C16 35, 14 31, 14 25 Z"
          fill="#27201c"
        />

        {/* Shoulders / tailored blazer */}
        <path
          d="M9 55 C10 44, 18 41, 28 41 C38 41, 46 44, 47 55 Z"
          fill="url(#advisor-Suit)"
        />
        {/* Crisp white shirt & warm emerald tie/lapel */}
        <path d="M22 41 L28 51 L34 41 Z" fill="#ffffff" />
        <path d="M26.6 43.5 L28 52 L29.4 43.5 Z" fill="#10b981" />
        {/* Blazer lapels */}
        <path d="M20 41.5 L26 51 L22.5 53 L17.5 44 Z" fill="#334155" />
        <path d="M36 41.5 L30 51 L33.5 53 L38.5 44 Z" fill="#334155" />

        {/* Neck & subtle chin shadow */}
        <rect x="24" y="35" width="8" height="8" rx="3.5" fill="#d4956a" />
        <path d="M24 37.5 Q28 40.5 32 37.5 L32 35 L24 35 Z" fill="#b87a52" opacity="0.45" />

        {/* Ears */}
        <circle cx="15.8" cy="27.5" r="2.7" fill="#e2a87b" />
        <circle cx="40.2" cy="27.5" r="2.7" fill="#e2a87b" />

        {/* Head / face */}
        <rect x="16.5" y="14" width="23" height="25" rx="11.2" fill="url(#advisor-skin)" />

        {/* Warm rosy cheeks */}
        {(mood === 'happy' || celebrating || talking) && (
          <>
            <ellipse cx="20.2" cy="30.8" rx="2.6" ry="1.5" fill="#f43f5e" opacity="0.28" />
            <ellipse cx="35.8" cy="30.8" rx="2.6" ry="1.5" fill="#f43f5e" opacity="0.28" />
          </>
        )}

        {/* Front wavy hair with warm highlight */}
        <path
          d="M15.5 23.5 C15.5 15, 21 11, 28.5 11 C35.5 11, 40.8 15, 40.5 23 C38.5 19.2, 34.5 17.5, 29 17.8 C23 18.1, 18.5 19.5, 15.5 23.5 Z"
          fill="#27201c"
        />
        <path
          d="M20 14.5 Q27 12.2 34 14.8"
          fill="none"
          stroke="#57493f"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.7"
        />

        {/* Expressive Eyebrows */}
        {worried ? (
          <>
            <path d="M19.5 22.8 Q22 21.8 24.8 21.2" fill="none" stroke="#27201c" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M31.2 21.2 Q34 21.8 36.5 22.8" fill="none" stroke="#27201c" strokeWidth="1.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M19.5 21.8 Q22.2 20.4 25 21.5" fill="none" stroke="#27201c" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M31 21.5 Q33.8 20.4 36.5 21.8" fill="none" stroke="#27201c" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}

        {/* Eyes */}
        {[22.3, 33.7].map((cx) => (
          <g key={cx}>
            {blink ? (
              <path
                d={`M${cx - 2.4} 26.2 Q${cx} 27.4 ${cx + 2.4} 26.2`}
                fill="none"
                stroke="#27201c"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ) : (
              <>
                <ellipse cx={cx} cy="26" rx="2.4" ry="2.5" fill="#ffffff" />
                <circle cx={cx + gaze.x * 0.55} cy={26 + gaze.y * 0.5} r="1.55" fill="#1e1b4b" />
                <circle cx={cx + gaze.x * 0.4 - 0.55} cy={25.3 + gaze.y * 0.4} r="0.55" fill="#ffffff" />
              </>
            )}
          </g>
        ))}

        {/* Friendly Advisor Glasses (warm tortoiseshell frames) */}
        <g stroke="#78350f" strokeWidth="1.15" fill="none" opacity="0.88">
          <circle cx="22.3" cy="26" r="4.1" fill="#ffffff" fillOpacity="0.12" />
          <circle cx="33.7" cy="26" r="4.1" fill="#ffffff" fillOpacity="0.12" />
          <path d="M26.4 25.8 Q28 25 29.6 25.8" strokeLinecap="round" />
          <line x1="16.5" y1="25.5" x2="18.2" y2="25.8" strokeLinecap="round" />
          <line x1="37.8" y1="25.8" x2="39.5" y2="25.5" strokeLinecap="round" />
        </g>

        {/* Subtle nose */}
        <path
          d="M28 26.8 L27.3 30.2 Q28 30.8 28.9 30.2"
          fill="none"
          stroke="#b87a52"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Mouth expressions */}
        {talking ? (
          <g className="borga-talk-mouth">
            <ellipse cx="28" cy="34.2" rx="3.1" ry="2.3" fill="#7f1d1d" />
            <path d="M25.6 33.1 L30.4 33.1" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
          </g>
        ) : worried ? (
          <path
            d="M25 35.2 Q28 33.6 31 35.2"
            fill="none"
            stroke="#7c2d12"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : celebrating ? (
          <g>
            <path d="M23.5 32.8 Q28 38.2 32.5 32.8 Z" fill="#7f1d1d" />
            <path d="M24.4 33.2 L31.6 33.2" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" />
          </g>
        ) : (
          <path
            d="M24.2 33.4 Q28 36.8 31.8 33.4"
            fill="none"
            stroke="#7c2d12"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        )}
      </g>

      {/* Sparkles when celebrating */}
      {celebrating && (
        <g className="borga-blink" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round">
          <line x1="49" y1="8" x2="49" y2="14" />
          <line x1="46" y1="11" x2="52" y2="11" />
          <line x1="7" y1="12" x2="7" y2="17" />
          <line x1="4.5" y1="14.5" x2="9.5" y2="14.5" />
        </g>
      )}
    </svg>
  );
}
