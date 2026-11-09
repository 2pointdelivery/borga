// Ad-campaign CSV import: paste or upload rows from any ad platform's export.
// Column mapping is header-based (name, platform, budget, spent, impressions,
// clicks, conversions, revenue, start, end) with tolerant aliases; dates are
// normalised; duplicates by (name, platform) are skipped, never overwritten.
// Pure — tested in lib/reconcile.test.ts.

export interface AdCsvRow {
  name: string;
  platform: string;
  budget: number;
  spent: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  startDate: string;
  endDate: string;
}

export interface AdCsvResult {
  rows: AdCsvRow[];
  skipped: string[]; // human-readable reasons
}

const ALIASES: Record<keyof AdCsvRow, string[]> = {
  name: ['name', 'campaign', 'campaign name', 'campaign_name'],
  platform: ['platform', 'channel', 'network'],
  budget: ['budget', 'budget amount', 'monthly budget'],
  spent: ['spent', 'spend', 'cost', 'amount spent'],
  impressions: ['impressions', 'impr', 'views'],
  clicks: ['clicks', 'click'],
  conversions: ['conversions', 'conversion', 'conv', 'leads'],
  revenue: ['revenue', 'conversion value', 'return', 'sales'],
  startDate: ['start', 'start date', 'start_date', 'from'],
  endDate: ['end', 'end date', 'end_date', 'to'],
};

const PLATFORMS = ['google', 'linkedin', 'facebook', 'instagram', 'twitter', 'tiktok', 'youtube', 'pinterest', 'threads', 'buffer'];

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function num(v: string | undefined): number {
  if (!v) return 0;
  // Strip currency symbols, spaces and thousands separators; keep the decimal point.
  const cleaned = v.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '');
  const n = Number(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function isoDate(v: string | undefined): string {
  if (!v) return '';
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // dd/mm/yyyy or mm/dd/yyyy — take the pieces as-is; the ad form re-edits anyway.
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

/** Parse pasted CSV text (first row = headers) into campaign rows. */
export function parseAdCsv(text: string): AdCsvResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const skipped: string[] = [];
  if (lines.length < 2) return { rows: [], skipped: ['Need a header row and at least one data row.'] };
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/_/g, ' ').trim());
  const colFor = (field: keyof AdCsvRow): number => {
    for (const alias of ALIASES[field]) {
      const i = headers.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };
  const nameI = colFor('name');
  if (nameI < 0) return { rows: [], skipped: ['No "name" or "campaign" column found in the header row.'] };
  const idx = { platform: colFor('platform'), budget: colFor('budget'), spent: colFor('spent'), impressions: colFor('impressions'), clicks: colFor('clicks'), conversions: colFor('conversions'), revenue: colFor('revenue'), startDate: colFor('startDate'), endDate: colFor('endDate') };

  const rows: AdCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[nameI] ?? '').trim();
    if (!name) { skipped.push(`Row skipped (no name): ${line.slice(0, 40)}…`); continue; }
    const rawPlatform = (idx.platform >= 0 ? cells[idx.platform] ?? '' : '').toLowerCase();
    const platform = PLATFORMS.find((p) => rawPlatform.includes(p)) ?? 'google';
    rows.push({
      name,
      platform,
      budget: num(idx.budget >= 0 ? cells[idx.budget] : undefined),
      spent: num(idx.spent >= 0 ? cells[idx.spent] : undefined),
      impressions: num(idx.impressions >= 0 ? cells[idx.impressions] : undefined),
      clicks: num(idx.clicks >= 0 ? cells[idx.clicks] : undefined),
      conversions: num(idx.conversions >= 0 ? cells[idx.conversions] : undefined),
      revenue: num(idx.revenue >= 0 ? cells[idx.revenue] : undefined),
      startDate: isoDate(idx.startDate >= 0 ? cells[idx.startDate] : undefined),
      endDate: isoDate(idx.endDate >= 0 ? cells[idx.endDate] : undefined),
    });
  }
  return { rows, skipped };
}

/** Import result: rows to add vs rows whose (name, platform) already exists. */
export function dedupeAdRows(rows: AdCsvRow[], existing: Array<{ name: string; platform: string }>): { toAdd: AdCsvRow[]; duplicates: AdCsvRow[] } {
  const seen = new Set(existing.map((c) => `${c.name.trim().toLowerCase()}|${c.platform}`));
  const toAdd: AdCsvRow[] = [];
  const duplicates: AdCsvRow[] = [];
  for (const r of rows) {
    if (seen.has(`${r.name.trim().toLowerCase()}|${r.platform}`)) duplicates.push(r);
    else { toAdd.push(r); seen.add(`${r.name.trim().toLowerCase()}|${r.platform}`); }
  }
  return { toAdd, duplicates };
}
