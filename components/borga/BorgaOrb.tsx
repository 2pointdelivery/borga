'use client';

import { cn } from '@/lib/utils';

export function BorgaOrb({
  size = 168,
  active,
  thinking,
  className,
}: {
  size?: number;
  active: boolean;
  thinking: boolean;
  className?: string;
}) {
  const dim = Math.max(72, Math.min(240, size));
  return (
    <div className={cn('relative flex items-center justify-center', className)} style={{ width: dim, height: dim }}>
      {/* pulse rings */}
      <span className="borga-orb-ring absolute rounded-full border border-ring/50" style={{ inset: 0 }} />
      {active && (
        <span className="borga-orb-ring absolute rounded-full border border-primary/40" style={{ inset: -14, animationDelay: '0.6s' }} />
      )}
      {/* orbiting dots */}
      <div
        className="absolute inset-0"
        style={{ animation: 'borga-orbit 9s linear infinite' }}
      >
        <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-primary" />
      </div>
      <div
        className="absolute inset-0"
        style={{ animation: 'borga-orbit 13s linear infinite reverse' }}
      >
        <span className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-chart-2" />
      </div>
      {/* core */}
      <div
        className={cn(
          'flex items-end justify-center gap-[3px] rounded-full bg-gradient-to-br from-primary via-primary/80 to-chart-4 transition-shadow duration-500 borga-glow',
        )}
        style={{ width: dim * 0.56, height: dim * 0.56, padding: dim * 0.16 }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="borga-eq w-[3px] rounded-full bg-primary-foreground"
            style={{
              height: dim * 0.2,
              animationDelay: `${i * 0.12}s`,
              animationPlayState: active || thinking ? 'running' : 'paused',
              opacity: active || thinking ? 1 : 0.5,
            }}
          />
        ))}
      </div>
      {/* inner glow dot when active */}
      {active && <span className="borga-blink absolute h-2 w-2 rounded-full bg-primary-foreground" style={{ top: dim * 0.16, right: dim * 0.2 }} />}
    </div>
  );
}
