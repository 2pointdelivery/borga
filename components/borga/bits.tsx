'use client';

import type { Agent } from '@/lib/borga/data';
import { cn } from '@/lib/utils';

export function AgentAvatar({
  name,
  color,
  size = 40,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}, ${color}99)`, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

export function StatusPill({ status }: { status: Agent['status'] }) {
  const map: Record<Agent['status'], { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' },
    idle: { label: 'Idle', cls: 'bg-muted text-muted-foreground ring-border' },
    learning: { label: 'Learning', cls: 'bg-sky-500/10 text-sky-600 ring-sky-500/30' },
    offline: { label: 'Offline', cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/30' },
  };
  const s = map[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function Sparkline({
  points,
  stroke = 'var(--ring)',
  width = 96,
  height = 30,
}: {
  points: number[];
  stroke?: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1 || 1);
  const d = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p - min) / range) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={area} fill={stroke} opacity={0.12} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}
