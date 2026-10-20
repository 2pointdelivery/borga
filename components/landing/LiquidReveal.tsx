'use client';

import { useEffect, useRef } from 'react';

/**
 * The hero backdrop: one scene shown as it is, and a second one that the pointer paints in as a soft, fading brush trail.
 * Both scenes are drawn here (an "agent network" in light and in dark), so there are no image files and nothing to download.
 * Nothing runs for people who ask for reduced motion: they just see the first scene.
 */

const BRUSH_RADIUS = 143; // CSS px
const DECAY = 0.016; // how much of the trail fades each frame
const IDLE_FRAMES = 120; // frames without movement before the trail is wiped

// Fixed node layout (fractions of the width/height) so both scenes line up exactly.
const NODES: Array<[number, number, number]> = [
  [0.1, 0.22, 7], [0.24, 0.62, 5], [0.31, 0.3, 9], [0.45, 0.78, 6], [0.52, 0.18, 6], [0.58, 0.5, 12], [0.7, 0.3, 7],
  [0.78, 0.7, 8], [0.88, 0.2, 6], [0.92, 0.55, 9], [0.66, 0.86, 5], [0.38, 0.48, 6], [0.15, 0.84, 6],
];
const LINKS: Array<[number, number]> = [[0, 2], [2, 4], [2, 5], [5, 6], [6, 8], [5, 7], [7, 9], [3, 5], [1, 11], [11, 5], [11, 2], [12, 3], [7, 10], [9, 6], [1, 12]];

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, dark: boolean) {
  const ink = dark ? '255,255,255' : '10,10,10';
  const g = ctx.createLinearGradient(0, 0, w, h);
  if (dark) { g.addColorStop(0, '#0b0b0c'); g.addColorStop(1, '#232326'); } else { g.addColorStop(0, '#ecebe9'); g.addColorStop(1, '#c9c9c9'); }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // faint grid
  const step = Math.max(48, Math.round(w / 28));
  ctx.strokeStyle = `rgba(${ink},${dark ? 0.07 : 0.06})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();

  // soft glows
  const glow = (cx: number, cy: number, r: number, a: number) => {
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(${dark ? '255,170,110' : '255,255,255'},${a})`);
    rg.addColorStop(1, `rgba(${dark ? '255,170,110' : '255,255,255'},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  glow(w * 0.62, h * 0.48, Math.min(w, h) * 0.7, dark ? 0.22 : 0.7);
  glow(w * 0.2, h * 0.75, Math.min(w, h) * 0.5, dark ? 0.12 : 0.45);

  // links, then nodes
  const unit = Math.max(1, w / 1600);
  ctx.strokeStyle = `rgba(${ink},${dark ? 0.28 : 0.18})`;
  ctx.lineWidth = 1.5 * unit;
  ctx.beginPath();
  for (const [a, b] of LINKS) { ctx.moveTo(NODES[a][0] * w, NODES[a][1] * h); ctx.lineTo(NODES[b][0] * w, NODES[b][1] * h); }
  ctx.stroke();
  for (const [fx, fy, r] of NODES) {
    ctx.beginPath();
    ctx.arc(fx * w, fy * h, r * 2.2 * unit, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${ink},${dark ? 0.1 : 0.07})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fx * w, fy * h, r * unit, 0, Math.PI * 2);
    ctx.fillStyle = dark ? '#ffb27a' : '#111';
    ctx.fill();
  }
}

export function LiquidReveal({ className }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const base = baseRef.current;
    const trail = trailRef.current;
    if (!box || !base || !trail) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = trail.getContext('2d');
    const bctx = base.getContext('2d');
    if (!ctx || !bctx) return;

    const cover = document.createElement('canvas');
    const brush = document.createElement('canvas');
    const bru = brush.getContext('2d');
    const rem = () => (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16; // the page scales with the viewport
    let radius = BRUSH_RADIUS * rem() * dpr;
    let W = 0;
    let H = 0;
    let points: Array<[number, number]> = [];
    let last: [number, number] | null = null;
    let idle = 0;
    let raf = 0;
    let running = false;

    const measure = () => {
      const r = box.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      for (const c of [base, trail, cover]) { c.width = W; c.height = H; }
      radius = BRUSH_RADIUS * rem() * dpr;
      brush.width = brush.height = Math.ceil(radius * 2);
      drawScene(bctx, W, H, false);
      const cctx = cover.getContext('2d');
      if (cctx) drawScene(cctx, W, H, true);
    };

    const stamp = (x: number, y: number) => {
      if (!bru) return;
      const d = brush.width;
      const c = d / 2;
      bru.globalCompositeOperation = 'source-over';
      bru.clearRect(0, 0, d, d);
      const rg = bru.createRadialGradient(c, c, 0, c, c, c);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.55, 'rgba(255,255,255,0.82)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      bru.fillStyle = rg;
      bru.fillRect(0, 0, d, d);
      bru.globalCompositeOperation = 'source-in';
      bru.drawImage(cover, x - c, y - c, d, d, 0, 0, d, d);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(brush, x - c, y - c);
    };

    const tick = () => {
      raf = 0;
      const drawing = points.length > 0;
      if (drawing) idle = 0;
      else { idle += 1; if (idle > IDLE_FRAMES) { running = false; return; } }
      const fade = drawing ? DECAY : Math.min(DECAY + idle * 0.004, 0.5);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, W, H);
      if (drawing) { for (const [x, y] of points) stamp(x, y); points = []; }
      if (idle >= IDLE_FRAMES) ctx.clearRect(0, 0, W, H);
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const x = (e.clientX - r.left) * dpr;
      const y = (e.clientY - r.top) * dpr;
      if (x < -radius || y < -radius || x > W + radius || y > H + radius) { last = null; return; }
      if (last) {
        const dist = Math.hypot(x - last[0], y - last[1]);
        const step = Math.max(radius * 0.3, 1);
        const n = Math.min(Math.ceil(dist / step), 60);
        for (let i = 1; i < n; i++) points.push([last[0] + ((x - last[0]) * i) / n, last[1] + ((y - last[1]) * i) / n]);
      }
      points.push([x, y]);
      last = [x, y];
      if (!running) { running = true; idle = 0; }
      if (!raf) raf = requestAnimationFrame(tick);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    if (!reduced) window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={boxRef} className={className} aria-hidden>
      <canvas ref={baseRef} className="absolute inset-0 size-full" />
      <canvas ref={trailRef} className="pointer-events-none absolute inset-0 size-full" />
    </div>
  );
}
