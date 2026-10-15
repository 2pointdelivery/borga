// DCF valuation (pure): free-cash-flow projection from live revenue, terminal
// value, discounted at the company's WACC. Feeds the Valuation methods table —
// the user decides its weight; we compute the number.
// Tested in lib/fx.test.ts (kept with the other valuation math).

export interface DcfFacts {
  /** Trailing revenue (same units as the result). */
  revenue: number;
  /** Annual revenue growth, percent per year (e.g. 40 = 40%/yr). */
  growthPct: number;
  /** Operating margin on revenue, percent (e.g. 12 = 12% FCF margin). */
  fcfMarginPct: number;
  /** Discount rate, percent (e.g. 18 = 18%/yr). */
  waccPct: number;
  /** Years of explicit projection before the terminal value. */
  years?: number;
  /** Terminal growth, percent/yr (must stay below the WACC). */
  terminalGrowthPct?: number;
}

export interface DcfResult {
  /** Sum of the discounted explicit-year FCFs. */
  explicitValue: number;
  /** Discounted terminal value. */
  terminalValue: number;
  /** Enterprise value = explicit + terminal (add net debt for equity value). */
  enterpriseValue: number;
  rows: Array<{ year: number; revenue: number; fcf: number; discounted: number }>;
}

export function dcfValue(f: DcfFacts): DcfResult {
  const years = Math.max(1, Math.min(10, Math.floor(f.years ?? 5)));
  const wacc = Math.max(0.01, f.waccPct) / 100;
  const g = f.growthPct / 100;
  const margin = f.fcfMarginPct / 100;
  const tg = Math.min(wacc - 0.005, Math.max(-0.05, (f.terminalGrowthPct ?? 2) / 100));
  const rows: DcfResult['rows'] = [];
  let explicit = 0;
  let revenue = Math.max(0, f.revenue);
  for (let y = 1; y <= years; y++) {
    revenue = revenue * (1 + g);
    const fcf = revenue * margin;
    const discounted = fcf / Math.pow(1 + wacc, y);
    explicit += discounted;
    rows.push({ year: y, revenue: Math.round(revenue * 100) / 100, fcf: Math.round(fcf * 100) / 100, discounted: Math.round(discounted * 100) / 100 });
  }
  // Gordon growth on the year-after-last FCF, discounted back to today.
  const lastFcf = rows.length ? rows[rows.length - 1].fcf : 0;
  const terminal = lastFcf * (1 + tg) / (wacc - tg);
  const terminalValue = Math.round(terminal / Math.pow(1 + wacc, years) * 100) / 100;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { explicitValue: round(explicit), terminalValue, enterpriseValue: round(explicit + terminalValue), rows };
}
