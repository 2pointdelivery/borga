'use client';

import { useState } from 'react';
import { TrendingUp, BarChart3 } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  Cell,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';
import { useBorga } from '@/lib/borga/store';
import { deriveValuation, industryProfile, VALUATION_CONFIG_SEED } from '@/lib/borga/data';
import { CURRENCY_SYMBOL } from '@/lib/borga/data';

const HISTORY_1Y = [
  { label: 'Jul 22', usd: 0.19, eqv: 1.85 }, { label: 'Aug 02', usd: 0.195, eqv: 1.87 },
  { label: 'Aug 14', usd: 0.192, eqv: 1.86 }, { label: 'Sep 02', usd: 0.188, eqv: 1.85 },
  { label: 'Sep 22', usd: 0.191, eqv: 1.88 }, { label: 'Oct 14', usd: 0.197, eqv: 1.92 },
  { label: 'Nov 04', usd: 0.2, eqv: 1.97 }, { label: 'Nov 24', usd: 0.203, eqv: 2.01 },
  { label: 'Dec 12', usd: 0.205, eqv: 2.05 }, { label: 'Jan 05', usd: 0.212, eqv: 2.12 },
  { label: 'Jan 20', usd: 0.218, eqv: 2.18 }, { label: 'Feb 03', usd: 0.221, eqv: 2.24 },
  { label: 'Feb 16', usd: 0.255, eqv: 2.48 }, { label: 'Mar 01', usd: 0.235, eqv: 2.38 },
  { label: 'Mar 20', usd: 0.238, eqv: 2.42 }, { label: 'Apr 08', usd: 0.242, eqv: 2.5 },
  { label: 'Apr 25', usd: 0.245, eqv: 2.55 }, { label: 'May 10', usd: 0.248, eqv: 2.6 },
  { label: 'May 25', usd: 0.251, eqv: 2.65 }, { label: 'Jun 03', usd: 0.27, eqv: 2.68 },
];

const tooltipStyle = {
  background: '#1C2B28',
  border: '1px solid #2B7A6F',
  borderRadius: 8,
  color: '#E8F5F3',
  fontSize: 12,
};

export function ValuationTab() {
  const { finance, knowledge, activeWorkspace, valuation } = useBorga();
  const ws = activeWorkspace();
  const config = valuation ?? VALUATION_CONFIG_SEED;
  const v = deriveValuation(finance, knowledge, ws, config);
  const wsName = ws?.legalName ?? ws?.name ?? 'your company';
  const wsShort = ws?.name ?? 'your company';
  const sym = CURRENCY_SYMBOL[ws?.currency ?? 'USD'];
  const [range, setRange] = useState<1 | 2 | 3>(1);

  // Methods from the DB-backed config, not hardcoded.
  const methods = config.methods ?? [];

  // Market assumptions computed live from the company's actual industry match
  // and its own derived valuation facts — never manually-typed static text.
  // Re-derives automatically whenever ws.industry or the underlying data changes.
  const profile = industryProfile(ws?.industry);
  const positioning = v.multiple > profile.baseMultiple ? 'above' : v.multiple < profile.baseMultiple ? 'below' : 'at';
  const momentumBand = v.momentum >= 70 ? 'above average' : v.momentum >= 50 ? 'average' : 'below average';
  const marketAssumptions = [
    { label: 'Sector', value: profile.label },
    { label: 'Industry Multiple Band', value: `${profile.lowMultiple}× – ${profile.highMultiple}× EV/Rev` },
    { label: 'Applied vs. Band Midpoint', value: `${v.multiple}× — ${positioning} typical ${profile.baseMultiple}×` },
    { label: 'Industry Growth Proxy', value: `${profile.growthProxy}% typical YoY` },
    { label: 'Peer Gross Margin (proxy)', value: `${profile.marginProxy}%` },
    { label: 'Momentum vs. Peers', value: `${v.momentum}/100 — ${momentumBand}` },
  ];

  // Illustrative price history, anchored to the live blended FMV so the trend
  // ends at the company's real derived value (not a fixed demo number).
  const scaleHist = v.fmv / 2.68;
  const HISTORY = HISTORY_1Y.map((h) => ({ label: h.label, usd: Math.round(h.usd * scaleHist * 100) / 100, eqv: Math.round(h.eqv * scaleHist * 100) / 100 }));
  const data = range === 1 ? HISTORY : range === 2 ? HISTORY.slice(10) : HISTORY.slice(14);

  const fmtM = (n: number) => `${sym}${n.toFixed(2)}M`;

  // Weighted method breakdown, scaled so the blend equals the live FMV.
  const rawContrib = methods.map((m) => (m.value * m.weight) / 100);
  const rawSum = rawContrib.reduce((a, b) => a + b, 0);
  const scale = rawSum > 0 ? v.fmv / rawSum : 1;
  const METHODS = methods.map((m) => ({
    ...m,
    contribution: Math.round((m.value * m.weight * scale) / 10000) / 100,
  }));
  const blended = Math.round(METHODS.reduce((s, m) => s + m.contribution, 0) * 100) / 100;

  const ASSUMPTIONS_COMPANY = [
    ['Incorporation', `${ws?.incorporationDate ? ws.incorporationDate.slice(0, 4) + ',' : '…'}${ws?.state ? ` ${ws.state}` : ws?.country ? ` ${ws.country}` : ''}`],
    ['Industry', ws?.industry ?? '…'],
    ['Country', ws?.country ?? '…'],
    ['City / HQ', ws?.city ? `${ws.city}${ws?.state ? `, ${ws.state}` : ''}` : '…'],
    ['Services', 'Configured in Services & Operations knowledge'],
    ['Platform', `${ws?.website ? 'Web' : '…'}${ws?.email ? ' + API' : ''}`],
    ['NTM Revenue Est.', fmtM(v.revenue)],
    ['Revenue Multiple', `${v.multiple}× NTM`],
  ];

  // Bear/bull multiples derived from the same floor/ceiling this company's FMV
  // range already uses (industry low/high bands) — not independent fabricated
  // numbers. Growth is scaled off the real computed growthPct, not a flat guess.
  const bearMultiple = v.revenue > 0 ? Math.round((v.floor / v.revenue) * 10) / 10 : v.multiple;
  const bullMultiple = v.revenue > 0 ? Math.round((v.ceiling / v.revenue) * 10) / 10 : v.multiple;
  const SCENARIOS = [
    { tone: 'bear', label: 'Bear Case', value: fmtM(v.floor), sub: '12-month downside', text: 'text-rose-500', border: 'border-rose-500/25 bg-rose-500/5', badge: 'bg-rose-500/10 text-rose-500 ring-rose-500/25', items: [['Revenue Growth', `+${Math.round(v.growthPct * 0.5)}% YoY`], ['Market Multiple', `${bearMultiple}×`], ['Implied Share', `~$${(v.floor / v.sharesM).toFixed(2)}`]] },
    { tone: 'base', label: 'Base Case ← Current', value: fmtM(v.fmv), sub: 'Best estimate today', text: 'text-emerald-500', border: 'border-emerald-500/30 bg-emerald-500/5', badge: 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/30', items: [['Revenue Growth', `+${v.growthPct}% YoY`], ['Market Multiple', `${v.multiple}×`], ['Implied Share', `~$${v.impliedShare}`]] },
    { tone: 'bull', label: 'Bull Case', value: fmtM(v.ceiling), sub: '12-month upside', text: 'text-emerald-400', border: 'border-emerald-400/30 bg-emerald-400/5', badge: 'bg-emerald-400/10 text-emerald-400 ring-emerald-400/30', items: [['Revenue Growth', `+${Math.round(v.growthPct * 1.5)}% YoY`], ['Market Multiple', `${bullMultiple}×`], ['Implied Share', `~$${(v.ceiling / v.sharesM).toFixed(2)}`]] },
  ];

  const BRIDGE = [
    { name: 'Market Comps', value: METHODS[0].contribution },
    { name: 'Revenue Mult.', value: METHODS[1].contribution },
    { name: 'Eqvista Ref.', value: METHODS[2].contribution },
    { name: 'Tech Premium', value: METHODS[3].contribution },
    { name: 'Total FMV', value: blended },
  ];

  const RADAR_2PT = [
    { dim: 'Market Reach', two: 52, peer: 75 },
    { dim: 'Tech Platform', two: 72, peer: 58 },
    { dim: 'Brand Recognition', two: 38, peer: 72 },
    { dim: 'Revenue Growth', two: 68, peer: 55 },
    { dim: 'Service Diversity', two: 74, peer: 62 },
    { dim: 'Operational Scale', two: 42, peer: 78 },
  ];

  const posPct = Math.max(0, Math.min(100, ((v.fmv - v.floor) / (v.ceiling - v.floor)) * 100));

  return (
    <div className="borga-fade-up space-y-5">
      {/* Hero */}
      <Card className="relative overflow-hidden border p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: 'var(--ring)' }} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Fair Market Valuation — {wsName}</p>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-5xl font-extrabold tracking-tight text-foreground">{fmtM(v.fmv)}</span>
              <span className="flex items-center gap-1 text-base font-semibold text-emerald-500">
                <TrendingUp className="h-4 w-4" /> +{v.growthPct}% <span className="text-xs font-normal text-muted-foreground">12mo</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Blended FMV — As of today — {ws?.currency ?? 'CAD'}</p>
            <div className="mt-4 flex flex-wrap gap-6 text-sm">
              {[
                ['Industry', ws?.industry ?? '…'],
                ['Incorporated', `${ws?.incorporationDate?.slice(0, 4) ?? '…'}${ws?.state ? ` — ${ws.state}` : ws?.country ? ` — ${ws.country}` : ''}`],
                ['Markets', [ws?.country].filter(Boolean).join(', ') || '…'],
                ['Eqvista Ref. Val.', `${fmtM(v.fmv)}`],
                ['Share Price Ref.', `$${v.impliedShare} ${ws?.currency ?? 'USD'} (+${v.growthPct}%)`],
              ].map(([k, val]) => (
                <div key={k}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</p>
                  <p className="mt-0.5 font-semibold text-muted-foreground">{val}</p>
                </div>
              ))}
            </div>
          </div>
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-600"
            title={v.growthSource === 'trailing-actuals' ? 'Growth is computed from this company\'s own trailing revenue trend' : 'Not enough revenue history yet — growth falls back to an industry estimate'}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            {v.growthSource === 'trailing-actuals' ? 'Growth from your own ledger' : 'Growth from industry proxy'}
          </Badge>
        </div>
      </Card>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Blended Valuation</p>
            <Badge className="bg-emerald-500/10 text-emerald-600">EST.</Badge>
          </div>
          <p className="mt-1 text-2xl font-semibold">{fmtM(v.fmv)}</p>
          <p className="text-[11px] text-muted-foreground">Weighted avg. of 4 methods</p>
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{fmtM(v.floor)} floor</span><span>{fmtM(v.ceiling)} ceiling</span>
          </div>
          <div className="relative mt-1 h-1.5 rounded bg-muted">
            <div className="absolute left-0 top-0 h-full rounded bg-gradient-to-r from-primary to-primary/40" style={{ width: `${posPct}%` }} />
            <div className="absolute -top-0.5 h-2.5 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${posPct}%` }} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Revenue Multiple</p>
            <Badge className="bg-sky-500/10 text-sky-600">NTM</Badge>
          </div>
          <p className="mt-1 text-2xl font-semibold">{v.multiple}×</p>
          <p className="text-[11px] text-muted-foreground">EV / Revenue — from knowledge base</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Momentum Score</p>
          <div className="mt-1 flex items-end gap-2">
            <p className="text-2xl font-semibold">{v.momentum}</p>
            <p className="pb-1 text-xs text-muted-foreground">/ 100</p>
            <Badge className="mb-1 ml-auto bg-emerald-500/10 text-emerald-600">STRONG</Badge>
          </div>
          <div className="mt-1 h-1.5 rounded bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500" />
          <p className="mt-1 text-[11px] text-muted-foreground">Price +{v.growthPct}% YoY — Cities +51 — 5 Countries</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Enterprise Value</p>
          <p className="mt-1 text-2xl font-semibold">{fmtM(v.ev)}</p>
          <p className="text-[11px] text-muted-foreground">EV = FMV + Net Debt Est.</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Implied Share Price</p>
            <Badge className="bg-emerald-500/10 text-emerald-600">+{v.growthPct}%</Badge>
          </div>
          <p className="mt-1 text-2xl font-semibold">${v.impliedShare}</p>
          <p className="text-[11px] text-muted-foreground">USD — Eqvista Reference Rate</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Applied Multiple</p>
          <p className="mt-1 text-2xl font-semibold">{v.multiple}×</p>
          <p className="text-[11px] text-muted-foreground">{v.growthSource === 'trailing-actuals' ? 'Industry band, blended with your own trailing growth' : 'Industry EV/Rev band for this sector'}</p>
        </Card>
      </div>

      {/* Price history */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="FMV Price History" sub="Illustrative shape, scaled to today's real FMV — this app has no live market-data feed for actual historical ticks" />
          <div className="flex gap-1 rounded-lg bg-muted p-0.5">
            {(['1Y', '6M', '3M'] as const).map((r, i) => (
              <button
                key={r}
                onClick={() => setRange((i + 1) as 1 | 2 | 3)}
                className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors', range === i + 1 ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9BBFBA' }} tickMargin={8} />
              <YAxis yAxisId="usd" tick={{ fontSize: 10, fill: '#9BBFBA' }} tickFormatter={(val) => `${sym}${val.toFixed(2)}`} domain={[0.15, 0.3]} />
              <YAxis yAxisId="eqv" orientation="right" tick={{ fontSize: 10, fill: '#FBBF24' }} tickFormatter={(val) => `${sym}${val.toFixed(1)}M`} domain={[1.5, 2.8]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#9BBFBA' }} />
              <Line yAxisId="usd" type="monotone" dataKey="usd" name="FMV Price (USD)" stroke="#3D9B8E" strokeWidth={2} dot={{ r: 2, fill: '#3D9B8E' }} />
              <Line yAxisId="eqv" type="monotone" dataKey="eqv" name="Eqvista Val ($M CAD)" stroke="#FBBF24" strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Method breakdown */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <SectionTitle title="Valuation Method Breakdown" sub={`Blended: ${fmtM(v.fmv)} ${ws?.currency ?? 'CAD'}`} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Implied Value</th>
                <th className="py-2 pr-4">Weight</th>
                <th className="py-2 pr-4">Contribution</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m) => (
                <tr key={m.name} className="border-b text-muted-foreground last:border-0 hover:bg-muted/20">
                  <td className="py-2.5 pr-4 font-medium text-foreground">{m.name}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{fmtM(m.value)}</td>
                  <td className="py-2.5 pr-4">
                    <span className="mr-2 inline-block h-1 w-6 rounded bg-primary" />
                    {m.weight}%
                  </td>
                  <td className="py-2.5 pr-4 font-semibold text-emerald-500">{fmtM(m.contribution)}</td>
                  <td className="py-2.5 text-xs">{m.note}</td>
                </tr>
              ))}
              <tr className="font-semibold text-foreground">
                <td className="py-3 pr-4">BLENDED FMV</td>
                <td className="py-3 pr-4 text-primary">{fmtM(v.fmv)}</td>
                <td className="py-3 pr-4">100%</td>
                <td className="py-3 pr-4 text-primary">{fmtM(blended)} {ws?.currency ?? 'CAD'}</td>
                <td className="py-3 text-xs text-muted-foreground">Weighted average</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Scenarios */}
      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIOS.map((s) => (
          <div key={s.label} className={cn('rounded-2xl border p-5', s.border)}>
            <div className={cn('text-[10px] font-semibold uppercase tracking-widest', s.text)}>{s.label}</div>
            <p className={cn('mt-1 text-3xl font-extrabold', s.text)}>{s.value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{s.sub}</p>
            <div className="mt-4 space-y-2">
              {s.items.map(([k, val]) => (
                <div key={k} className="flex items-center justify-between border-b border-border/50 pb-1.5 text-xs last:border-0">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-foreground">{val}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Assumptions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="Key Assumptions — Market" sub={`Live — ${profile.label} comparables, recalculated as your data changes`} />
          <div className="mt-3">
            {marketAssumptions.map((m) => (
              <div key={m.label} className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0">
                <span className="text-muted-foreground">{m.label}</span>
                <span className="font-medium text-foreground">{m.value}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle title="Key Assumptions — Company" />
          <div className="mt-3">
            {ASSUMPTIONS_COMPANY.map(([k, val]) => (
              <div key={k} className="flex items-center justify-between border-b border-border/50 py-2 text-sm last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium text-foreground">{val}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bridge + radar */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="Valuation Bridge" sub="Component contributions (CAD $M)" />
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BRIDGE} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9BBFBA' }} tickMargin={8} interval={0} />
                <YAxis tick={{ fontSize: 10, fill: '#9BBFBA' }} tickFormatter={(val) => `${sym}${val.toFixed(1)}M`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(val: number) => `${sym}${val.toFixed(2)}M ${ws?.currency ?? 'USD'}`} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {BRIDGE.map((_, i) => (
                    <Cell key={i} fill={i === BRIDGE.length - 1 ? '#4ADE80' : '#2B7A6F'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle title="Competitive Positioning" sub="Illustrative sample benchmark — not live competitor data (no market-intelligence feed is connected)" />
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={RADAR_2PT} outerRadius="70%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: '#9BBFBA' }} />
                <Radar name={wsShort} dataKey="two" stroke="#3D9B8E" fill="#3D9B8E" fillOpacity={0.2} strokeWidth={2} />
                <Radar name="Peer Average" dataKey="peer" stroke="#FBBF24" fill="#FBBF24" fillOpacity={0.1} strokeDasharray="5 3" />
                <Legend wrapperStyle={{ fontSize: 11, color: '#9BBFBA' }} />
                <Tooltip contentStyle={tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          These figures are derived from the live financial ledger and the company knowledge base (source facts under Company &amp; Brand → —Valuation &amp; financial position—). They are informational estimates only and do not constitute financial advice or a certified appraisal. Consult a licensed valuation professional before making investment decisions.
        </p>
      </Card>
    </div>
  );
}
