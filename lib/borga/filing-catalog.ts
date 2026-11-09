// Tax and statutory filings by jurisdiction: what a company has to file with the federal government and with its province, state or
// region, and when. Pure data and date arithmetic, with no UI and no store, so it can be tested on its own.
//
// What this is, and is not. It lists the recurring returns that apply to a company in Canada, the United States or Ghana, works
// out the due dates from the company's fiscal year end, and tracks which ones have been filed. It does NOT file anything with a tax
// authority. Every date here is the general rule; an extension, a different filing frequency assigned by the authority, a
// weekend or a public holiday can move it. Items we are less sure of carry confidence 'confirm' and are shown that way.

import type { TaxCategory } from './data';

export type FilingLevel = 'federal' | 'provincial' | 'state' | 'regional';
export type EntityType = 'corporation' | 's-corp' | 'partnership' | 'sole-proprietor';
export type Frequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual';
export type FigureBasis = 'salesTax' | 'income' | 'payroll' | 'none';
export type FilingCountry = 'CA' | 'US' | 'GH' | 'DK' | 'OTHER';

/** How the due date follows from the period. Day 'end' means the last day of the month. */
export type DueRule =
  /** `months` calendar months after the period end, on `day` (default: same day, an end-of-month period stays end-of-month). */
  | { kind: 'after'; months: number; day?: number | 'end' }
  /** Several dates inside the fiscal year. `months` counts from the first month of the year (13 = first month of next year). */
  | { kind: 'instalments'; months: number[]; day: number | 'end' }
  /** The authority sets the date (or it differs by state): the user enters it. */
  | { kind: 'manual' };

export interface Obligation {
  id: string;
  level: FilingLevel;
  authority: string;
  name: string;
  form?: string;
  /** 'chosen' = the filing frequency the company picked in its filing setup (sales tax / VAT). */
  frequency: Frequency | 'chosen';
  /** 'calendar' obligations follow the calendar year whatever the company's fiscal year end is (payroll slips, personal returns). */
  periodBasis: 'fiscal' | 'calendar';
  rule: DueRule | Partial<Record<Frequency, DueRule>>;
  figures: FigureBasis;
  /** For sales-tax returns: which of the company's tax profiles belong on this return. */
  taxCategories?: TaxCategory[];
  appliesTo?: EntityType[];
  when?: 'employees' | 'taxRegistered';
  /** This obligation takes the place of another (Revenu Québec's return covers GST and QST together). */
  replaces?: string;
  note?: string;
  url?: string;
  /** 'confirm' = the date or applicability is the general rule but we are less certain; the screen says so. */
  confidence?: 'statutory' | 'confirm';
}

export interface CustomObligation {
  id: string;
  name: string;
  authority: string;
  level: FilingLevel;
  frequency: Frequency;
  periodBasis: 'fiscal' | 'calendar';
  monthsAfter: number;
  day: number | 'end';
}

export interface FilingProfile {
  entityType: EntityType;
  /** Undefined = derive it (employees on the People page, a tax number in the company profile). */
  hasEmployees?: boolean;
  salesTaxRegistered?: boolean;
  salesTaxFrequency: Frequency;
  /** Filings due before this date are not tracked, so a company that joins today does not start with a year of "overdue". */
  trackedFrom?: string;
  /** False until the user has looked at the setup, so the screen can ask them to confirm it. */
  confirmed?: boolean;
  custom: CustomObligation[];
}

/** preparing and review are stages of an open filing; filed and not-required close it. */
export type FilingStatus = 'preparing' | 'review' | 'filed' | 'not-required';
export interface FilingRecord {
  /** `${obligationId}|${key}` */
  key: string;
  status: FilingStatus;
  filedOn?: string;
  reference?: string;
  amount?: number;
  note?: string;
  /** Who prepared and who reviewed it, as free text (a name or an accountant's firm). */
  preparer?: string;
  reviewer?: string;
  /** The user's own due date, for manual-rule obligations or when an authority granted an extension. */
  dueOverride?: string;
}

export interface FilingsState {
  profile: FilingProfile;
  records: FilingRecord[];
}

export const DEFAULT_FILING_PROFILE: FilingProfile = {
  entityType: 'corporation',
  salesTaxFrequency: 'quarterly',
  custom: [],
};

export const EMPTY_FILINGS: FilingsState = { profile: DEFAULT_FILING_PROFILE, records: [] };

export const ENTITY_LABEL: Record<EntityType, string> = {
  corporation: 'Corporation',
  's-corp': 'S corporation',
  partnership: 'Partnership',
  'sole-proprietor': 'Sole proprietor',
};

export const ENTITY_TYPES_BY_COUNTRY: Record<FilingCountry, EntityType[]> = {
  CA: ['corporation', 'partnership', 'sole-proprietor'],
  US: ['corporation', 's-corp', 'partnership', 'sole-proprietor'],
  GH: ['corporation', 'partnership', 'sole-proprietor'],
  DK: ['corporation', 'partnership', 'sole-proprietor'],
  OTHER: ['corporation', 'partnership', 'sole-proprietor'],
};

export const LEVEL_LABEL: Record<FilingLevel, string> = {
  federal: 'Federal',
  provincial: 'Provincial',
  state: 'State',
  regional: 'Regional / local',
};

// ── dates (UTC, ISO strings, no timezone surprises) ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const make = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;

export function isIso(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

const parts = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
};

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return make(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Adds calendar months. With no `day`, a period ending on the last day of a month lands on the last day of the target month. */
export function addMonths(iso: string, n: number, day?: number | 'end'): string {
  const [y, m, d] = parts(iso);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  if (day === 'end') return make(ty, tm, 31);
  if (typeof day === 'number') return make(ty, tm, day);
  return d === daysIn(y, m) ? make(ty, tm, 31) : make(ty, tm, d);
}

export interface FiscalYearEnd {
  month: number;
  day: number;
}

export function fiscalYearEnd(ws?: { fiscalYearEndMonth?: number; fiscalYearEndDay?: number } | null): FiscalYearEnd {
  const month = ws?.fiscalYearEndMonth && ws.fiscalYearEndMonth >= 1 && ws.fiscalYearEndMonth <= 12 ? ws.fiscalYearEndMonth : 12;
  const day = ws?.fiscalYearEndDay && ws.fiscalYearEndDay >= 1 && ws.fiscalYearEndDay <= 31 ? ws.fiscalYearEndDay : 31;
  return { month, day };
}

export interface Period {
  start: string;
  end: string;
  /** Stable id of the period, used to match a filing record to it. */
  key: string;
}

/** Period ends that fall inside [fromEnd, toEnd]. Annual periods end on the fiscal (or calendar) year end, the rest on month ends. */
function periodEnds(freq: Frequency, basis: 'fiscal' | 'calendar', fye: FiscalYearEnd, fromEnd: string, toEnd: string): string[] {
  const out: string[] = [];
  const [fy] = parts(fromEnd);
  const [ty] = parts(toEnd);
  const anchor = basis === 'calendar' ? { month: 12, day: 31 } : fye;
  if (freq === 'annual') {
    for (let y = fy - 1; y <= ty + 1; y++) out.push(make(y, anchor.month, anchor.day));
  } else {
    for (let y = fy - 1; y <= ty + 1; y++) {
      const every = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : 6;
      for (let m = 1; m <= 12; m++) if ((m - anchor.month) % every === 0) out.push(make(y, m, 31));
    }
  }
  return out.filter((e) => e >= fromEnd && e <= toEnd).sort();
}

/** The period that ends on `end` for this frequency, with its first day. */
function periodOf(freq: Frequency, basis: 'fiscal' | 'calendar', fye: FiscalYearEnd, end: string): Period {
  const prev = freq === 'annual' ? previousAnnualEnd(end, basis, fye) : addMonths(end, freq === 'monthly' ? -1 : freq === 'quarterly' ? -3 : -6, 'end');
  return { start: addDays(prev, 1), end, key: end };
}

function previousAnnualEnd(end: string, basis: 'fiscal' | 'calendar', fye: FiscalYearEnd): string {
  const [y] = parts(end);
  const a = basis === 'calendar' ? { month: 12, day: 31 } : fye;
  return make(y - 1, a.month, a.day);
}

const resolveRule = (ob: Obligation, freq: Frequency): DueRule => {
  const r = ob.rule as DueRule | Partial<Record<Frequency, DueRule>>;
  if ('kind' in r) return r;
  return (r as Partial<Record<Frequency, DueRule>>)[freq] ?? { kind: 'manual' };
};

export interface FilingDue {
  obligationId: string;
  /** Matches FilingRecord.key together with the obligation id. */
  key: string;
  period: Period;
  /** null for a manual-rule obligation that has no date yet. */
  due: string | null;
  label: string;
}

/** The effective frequency of an obligation for this company. */
export function frequencyOf(ob: Obligation, profile: Pick<FilingProfile, 'salesTaxFrequency'>): Frequency {
  return ob.frequency === 'chosen' ? profile.salesTaxFrequency : ob.frequency;
}

function periodLabel(freq: Frequency, p: Period): string {
  const [y, m] = parts(p.end);
  if (freq === 'monthly') return `${MONTHS[m - 1]} ${y}`;
  if (freq === 'quarterly' || freq === 'semiannual') return `${MONTHS[parts(p.start)[1] - 1]}–${MONTHS[m - 1]} ${y}`;
  return `Year ended ${p.end}`;
}
const MONTHS =['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Every filing of one obligation whose period ends in [fromEnd, toEnd] (a record for it, if any, is matched later by key).
 * Instalment obligations produce one row per instalment inside each fiscal year.
 */
export function filingsOf(ob: Obligation, profile: Pick<FilingProfile, 'salesTaxFrequency'>, fye: FiscalYearEnd, fromEnd: string, toEnd: string): FilingDue[] {
  const freq = frequencyOf(ob, profile);
  const rule = resolveRule(ob, freq);
  const ends = periodEnds(freq, ob.periodBasis, fye, fromEnd, toEnd);
  const out: FilingDue[] = [];
  for (const end of ends) {
    const period = periodOf(freq, ob.periodBasis, fye, end);
    if (rule.kind === 'instalments') {
      const startMonthIdx = parts(period.start);
      rule.months.forEach((mo, i) => {
        const due = addMonths(make(startMonthIdx[0], startMonthIdx[1], 1), mo - 1, rule.day);
        out.push({ obligationId: ob.id, key: `${end}#${i + 1}`, period, due, label: `Instalment ${i + 1} of ${rule.months.length}, year ended ${end}` });
      });
    } else {
      const due = rule.kind === 'after' ? addMonths(end, rule.months, rule.day) : null;
      out.push({ obligationId: ob.id, key: end, period, due, label: periodLabel(freq, period) });
    }
  }
  return out;
}

// ── status ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DueState = 'filed' | 'not-required' | 'overdue' | 'due-soon' | 'upcoming' | 'needs-date';

export const DUE_SOON_DAYS = 30;

export function dueStateOf(due: string | null, record: FilingRecord | undefined, today: string): DueState {
  if (record?.status === 'filed') return 'filed';
  if (record?.status === 'not-required') return 'not-required';
  const d = record?.dueOverride && isIso(record.dueOverride) ? record.dueOverride : due;
  if (!d) return 'needs-date';
  const left = daysBetween(today, d);
  if (left < 0) return 'overdue';
  return left <= DUE_SOON_DAYS ? 'due-soon' : 'upcoming';
}

// ── jurisdictions ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function filingCountryOf(country?: string | null): FilingCountry {
  const c = (country ?? '').trim().toLowerCase().replace(/\./g, '');
  if (['us', 'usa', 'united states', 'united states of america'].includes(c)) return 'US';
  if (['ca', 'canada'].includes(c)) return 'CA';
  if (['gh', 'ghana'].includes(c)) return 'GH';
  if (['dk', 'denmark', 'danmark'].includes(c)) return 'DK';
  return 'OTHER';
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const CA_PROVINCES: Record<string, string[]> = {
  AB: ['alberta'], BC: ['british columbia', 'bc'], MB: ['manitoba'], NB: ['new brunswick'], NL: ['newfoundland and labrador', 'newfoundland', 'labrador'],
  NS: ['nova scotia'], NT: ['northwest territories'], NU: ['nunavut'], ON: ['ontario'], PE: ['prince edward island', 'pei'],
  QC: ['quebec', 'qc'], SK: ['saskatchewan'], YT: ['yukon', 'yukon territory'],
};
export const CA_PROVINCE_NAME: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
  NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon',
};

/** The two-letter code of a Canadian province or territory from its name or code, or '' if it is not one. */
export function provinceCode(state?: string | null): string {
  const s = fold(state ?? '');
  if (!s) return '';
  for (const [code, names] of Object.entries(CA_PROVINCES)) if (s === code.toLowerCase() || names.includes(s)) return code;
  return '';
}

const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
  maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
export function usStateCode(state?: string | null): string {
  const s = fold(state ?? '');
  if (!s) return '';
  if (US_STATE_CODES[s]) return US_STATE_CODES[s];
  const hit = Object.values(US_STATE_CODES).find((c) => c.toLowerCase() === s);
  return hit ?? '';
}

const AFTER = (months: number, day?: number | 'end'): DueRule => ({ kind: 'after', months, day });
const CORP: EntityType[] = ['corporation'];

const CRA = 'Canada Revenue Agency (CRA)';
const IRS = 'Internal Revenue Service (IRS)';
const GRA = 'Ghana Revenue Authority (GRA)';

const CA_FEDERAL: Obligation[] = [
  {
    id: 'ca-gsthst', level: 'federal', authority: CRA, name: 'GST/HST return', form: 'GST34', frequency: 'chosen', periodBasis: 'fiscal',
    rule: { monthly: AFTER(1, 'end'), quarterly: AFTER(1, 'end'), annual: AFTER(3, 'end') }, figures: 'salesTax', taxCategories: ['gst'], when: 'taxRegistered',
    note: 'Includes the HST of the participating provinces. Sole proprietors filing annually usually have until June 15 (payment is still due April 30).',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html',
  },
  {
    id: 'ca-t2', level: 'federal', authority: CRA, name: 'Corporation income tax return', form: 'T2', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(6, 'end'),
    figures: 'income', appliesTo: CORP,
    note: 'The return is due 6 months after the year end. The tax itself is due 2 months after the year end (3 months for many small Canadian-controlled private corporations). The provincial part is filed on the same return except in Quebec and Alberta.',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/corporations/corporation-tax-returns.html',
  },
  {
    id: 'ca-t1-business', level: 'federal', authority: CRA, name: 'Personal return with business income', form: 'T1 + T2125', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(6, 15),
    figures: 'income', appliesTo: ['sole-proprietor'], note: 'Self-employed individuals file by June 15, but any tax owing is due April 30.',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships.html',
  },
  {
    id: 'ca-t5013', level: 'federal', authority: CRA, name: 'Partnership information return', form: 'T5013', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(5, 'end'),
    figures: 'income', appliesTo: ['partnership'], confidence: 'confirm', note: 'Check the current deadline and whether your partnership must file.',
    url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t5013.html',
  },
  {
    id: 'ca-payroll', level: 'federal', authority: CRA, name: 'Payroll deductions remittance', frequency: 'monthly', periodBasis: 'calendar', rule: AFTER(1, 15),
    figures: 'payroll', when: 'employees', confidence: 'confirm',
    note: 'Regular monthly remitters pay by the 15th of the next month. Larger employers remit more often and very small ones quarterly; the CRA tells you which you are.',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/remitting-source-deductions.html',
  },
  {
    id: 'ca-t4', level: 'federal', authority: CRA, name: 'T4 slips and T4 summary', form: 'T4', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(2, 'end'),
    figures: 'payroll', when: 'employees',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4-information-employers.html',
  },
];

const CA_PROVINCIAL: Record<string, Obligation[]> = {
  ON: [
    {
      id: 'on-eht', level: 'provincial', authority: 'Ontario Ministry of Finance', name: 'Employer Health Tax return', form: 'EHT', frequency: 'annual', periodBasis: 'calendar',
      rule: AFTER(2, 15), figures: 'payroll', when: 'employees', confidence: 'confirm',
      note: 'Employers with a total Ontario payroll under the exemption (currently $1 million) pay no tax, and many do not have to file at all.',
      url: 'https://www.ontario.ca/page/employer-health-tax',
    },
  ],
  QC: [
    {
      id: 'qc-qst', level: 'provincial', authority: 'Revenu Québec', name: 'GST and QST return', form: 'VD-403', frequency: 'chosen', periodBasis: 'fiscal',
      rule: { monthly: AFTER(1, 'end'), quarterly: AFTER(1, 'end'), annual: AFTER(3, 'end') }, figures: 'salesTax', taxCategories: ['gst', 'sales'], when: 'taxRegistered',
      replaces: 'ca-gsthst', confidence: 'confirm', note: 'In Quebec, Revenu Québec collects both the GST and the QST on one return.',
      url: 'https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/',
    },
    {
      id: 'qc-co17', level: 'provincial', authority: 'Revenu Québec', name: 'Quebec corporation income tax return', form: 'CO-17', frequency: 'annual', periodBasis: 'fiscal',
      rule: AFTER(6, 'end'), figures: 'income', appliesTo: CORP, note: 'Quebec corporations file this with Revenu Québec as well as the federal T2.',
      url: 'https://www.revenuquebec.ca/en/businesses/income-tax/corporations/',
    },
    {
      id: 'qc-rl1', level: 'provincial', authority: 'Revenu Québec', name: 'RL-1 slips and summary', form: 'RL-1', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(2, 'end'),
      figures: 'payroll', when: 'employees', url: 'https://www.revenuquebec.ca/en/businesses/source-deductions-and-employer-contributions/',
    },
  ],
  AB: [
    {
      id: 'ab-at1', level: 'provincial', authority: 'Alberta Tax and Revenue Administration', name: 'Alberta corporate income tax return', form: 'AT1', frequency: 'annual',
      periodBasis: 'fiscal', rule: AFTER(6, 'end'), figures: 'income', appliesTo: CORP, note: 'Alberta corporations file the AT1 with Alberta in addition to the federal T2. Alberta has no provincial sales tax.',
      url: 'https://www.alberta.ca/corporate-income-tax',
    },
  ],
  BC: [
    {
      id: 'bc-pst', level: 'provincial', authority: 'BC Ministry of Finance', name: 'Provincial sales tax (PST) return', frequency: 'chosen', periodBasis: 'fiscal',
      rule: { monthly: AFTER(1, 'end'), quarterly: AFTER(1, 'end'), annual: AFTER(1, 'end') }, figures: 'salesTax', taxCategories: ['sales'], when: 'taxRegistered', confidence: 'confirm',
      note: 'BC PST is separate from the federal GST. The filing frequency is assigned to you when you register.', url: 'https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst',
    },
  ],
  SK: [
    {
      id: 'sk-pst', level: 'provincial', authority: 'Saskatchewan Ministry of Finance', name: 'Provincial sales tax (PST) return', frequency: 'chosen', periodBasis: 'fiscal',
      rule: { monthly: AFTER(1, 20), quarterly: AFTER(1, 20), annual: AFTER(1, 20) }, figures: 'salesTax', taxCategories: ['sales'], when: 'taxRegistered', confidence: 'confirm',
      note: 'Separate from the federal GST. Returns are generally due on the 20th of the month after the period.', url: 'https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-sales-tax',
    },
  ],
  MB: [
    {
      id: 'mb-rst', level: 'provincial', authority: 'Manitoba Finance', name: 'Retail sales tax (RST) return', frequency: 'chosen', periodBasis: 'fiscal',
      rule: { monthly: AFTER(1, 'end'), quarterly: AFTER(1, 'end'), annual: AFTER(1, 'end') }, figures: 'salesTax', taxCategories: ['sales'], when: 'taxRegistered', confidence: 'confirm',
      note: 'Separate from the federal GST. Confirm the due date for your filing frequency on the Manitoba site.', url: 'https://www.gov.mb.ca/finance/taxation/taxes/retail.html',
    },
  ],
};

const US_FEDERAL: Obligation[] = [
  {
    id: 'us-1120', level: 'federal', authority: IRS, name: 'Corporation income tax return', form: '1120', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(4, 15),
    figures: 'income', appliesTo: CORP, note: 'Filing an extension (Form 7004) moves the return date by six months but not the date the tax is due.',
    url: 'https://www.irs.gov/forms-pubs/about-form-1120',
  },
  {
    id: 'us-1120s', level: 'federal', authority: IRS, name: 'S corporation income tax return', form: '1120-S', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(3, 15),
    figures: 'income', appliesTo: ['s-corp'], url: 'https://www.irs.gov/forms-pubs/about-form-1120-s',
  },
  {
    id: 'us-1065', level: 'federal', authority: IRS, name: 'Partnership return', form: '1065', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(3, 15),
    figures: 'income', appliesTo: ['partnership'], url: 'https://www.irs.gov/forms-pubs/about-form-1065',
  },
  {
    id: 'us-schc', level: 'federal', authority: IRS, name: 'Personal return with business income', form: '1040 + Schedule C', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(4, 15),
    figures: 'income', appliesTo: ['sole-proprietor'], url: 'https://www.irs.gov/forms-pubs/about-schedule-c-form-1040',
  },
  {
    id: 'us-est-corp', level: 'federal', authority: IRS, name: 'Estimated tax payments', form: '1120-W', frequency: 'annual', periodBasis: 'fiscal', rule: { kind: 'instalments', months: [4, 6, 9, 12], day: 15 },
    figures: 'none', appliesTo: CORP, note: 'Paid electronically. Corporations expecting to owe $500 or more must pay in instalments.', url: 'https://www.irs.gov/businesses/corporations/estimated-taxes',
  },
  {
    id: 'us-est-sole', level: 'federal', authority: IRS, name: 'Estimated tax payments', form: '1040-ES', frequency: 'annual', periodBasis: 'calendar', rule: { kind: 'instalments', months: [4, 6, 9, 13], day: 15 },
    figures: 'none', appliesTo: ['sole-proprietor', 'partnership'], confidence: 'confirm', note: 'For the owners of the business. A date that falls on a weekend or holiday moves to the next business day.',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes',
  },
  {
    id: 'us-941', level: 'federal', authority: IRS, name: 'Quarterly payroll tax return', form: '941', frequency: 'quarterly', periodBasis: 'calendar', rule: AFTER(1, 'end'),
    figures: 'payroll', when: 'employees', note: 'Payroll tax deposits are due on a separate schedule (monthly or semiweekly) depending on your liability.',
    url: 'https://www.irs.gov/forms-pubs/about-form-941',
  },
  {
    id: 'us-w2', level: 'federal', authority: IRS, name: 'W-2 / W-3 and 1099-NEC', form: 'W-2, W-3, 1099-NEC', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(1, 'end'),
    figures: 'payroll', when: 'employees', note: 'Also give each employee and contractor their copy by the same date.', url: 'https://www.irs.gov/forms-pubs/about-form-w-2',
  },
  {
    id: 'us-940', level: 'federal', authority: IRS, name: 'Federal unemployment tax return', form: '940', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(1, 'end'),
    figures: 'payroll', when: 'employees', url: 'https://www.irs.gov/forms-pubs/about-form-940',
  },
];

/** Generic state obligations: the date differs by state, so the user enters it from their state's website. */
function usStateGeneric(stateName: string): Obligation[] {
  const st = stateName || 'your state';
  return [
    {
      id: 'us-state-income', level: 'state', authority: `${st} tax agency`, name: `${st} income or franchise tax return`, frequency: 'annual', periodBasis: 'fiscal', rule: { kind: 'manual' },
      figures: 'income', appliesTo: ['corporation', 's-corp', 'partnership'], note: 'Most states have one; a few have none. Mark it "not required" if yours does not apply.',
    },
    {
      id: 'us-state-sales', level: 'state', authority: `${st} tax agency`, name: `${st} sales and use tax return`, frequency: 'chosen', periodBasis: 'fiscal', rule: { kind: 'manual' },
      figures: 'salesTax', taxCategories: ['sales'], when: 'taxRegistered',
      note: 'The state assigns the filing frequency and due date when you register, often the 20th of the following month. Local (city or county) sales tax is often filed with the state return.',
    },
    {
      id: 'us-state-payroll', level: 'state', authority: `${st} labor or tax agency`, name: `${st} payroll withholding and unemployment returns`, frequency: 'quarterly', periodBasis: 'calendar',
      rule: { kind: 'manual' }, figures: 'payroll', when: 'employees', note: 'State income tax withholding and state unemployment insurance. Most states are quarterly; some require more often.',
    },
  ];
}

const US_STATE_SPECIFIC: Record<string, Obligation[]> = {
  CA: [
    {
      id: 'us-ca-100', level: 'state', authority: 'California Franchise Tax Board', name: 'California corporation franchise or income tax return', form: '100', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(4, 15),
      figures: 'income', appliesTo: CORP, replaces: 'us-state-income', confidence: 'confirm', note: 'There is a minimum franchise tax even if the company has no income.', url: 'https://www.ftb.ca.gov/file/business/types/corporations/',
    },
    {
      id: 'us-ca-100s', level: 'state', authority: 'California Franchise Tax Board', name: 'California S corporation return', form: '100S', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(3, 15),
      figures: 'income', appliesTo: ['s-corp'], replaces: 'us-state-income', confidence: 'confirm', url: 'https://www.ftb.ca.gov/file/business/types/s-corporations/',
    },
  ],
  TX: [
    {
      id: 'us-tx-franchise', level: 'state', authority: 'Texas Comptroller of Public Accounts', name: 'Texas franchise tax report', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(5, 15),
      figures: 'income', appliesTo: ['corporation', 's-corp', 'partnership'], replaces: 'us-state-income', confidence: 'confirm', note: 'Due May 15 each year. Texas has no personal or corporate income tax. Sole proprietors are not subject to it.',
      url: 'https://comptroller.texas.gov/taxes/franchise/',
    },
  ],
};

const GH_OBLIGATIONS: Obligation[] = [
  {
    id: 'gh-vat', level: 'federal', authority: GRA, name: 'VAT and levies return', frequency: 'monthly', periodBasis: 'fiscal', rule: AFTER(1, 'end'), figures: 'salesTax', taxCategories: ['vat', 'custom'],
    when: 'taxRegistered', note: 'Due by the last working day of the following month. The NHIL, GETFund and COVID-19 levies are reported on the same return.', url: 'https://gra.gov.gh/domestic-tax/tax-types/vat/',
  },
  {
    id: 'gh-cit', level: 'federal', authority: GRA, name: 'Annual company income tax return', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(4, 'end'), figures: 'income',
    appliesTo: ['corporation', 'partnership'], url: 'https://gra.gov.gh/domestic-tax/tax-types/income-tax/',
  },
  {
    id: 'gh-pit', level: 'federal', authority: GRA, name: 'Annual income tax return (self-employed)', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(4, 'end'), figures: 'income',
    appliesTo: ['sole-proprietor'], url: 'https://gra.gov.gh/domestic-tax/tax-types/income-tax/',
  },
  {
    id: 'gh-provisional', level: 'federal', authority: GRA, name: 'Provisional (quarterly) income tax payments', frequency: 'annual', periodBasis: 'fiscal', rule: { kind: 'instalments', months: [3, 6, 9, 12], day: 'end' },
    figures: 'none', confidence: 'confirm', note: 'Estimated tax paid in four instalments during the year.', url: 'https://gra.gov.gh/domestic-tax/tax-types/income-tax/',
  },
  {
    id: 'gh-paye', level: 'federal', authority: GRA, name: 'PAYE (employee income tax) return', frequency: 'monthly', periodBasis: 'calendar', rule: AFTER(1, 15), figures: 'payroll', when: 'employees',
    url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/',
  },
  {
    id: 'gh-ssnit', level: 'federal', authority: 'Social Security and National Insurance Trust (SSNIT)', name: 'SSNIT pension contributions', frequency: 'monthly', periodBasis: 'calendar', rule: AFTER(1, 14),
    figures: 'payroll', when: 'employees', confidence: 'confirm', url: 'https://www.ssnit.org.gh/',
  },
  {
    id: 'gh-permit', level: 'regional', authority: 'Your Metropolitan, Municipal or District Assembly', name: 'Business operating permit renewal', frequency: 'annual', periodBasis: 'calendar', rule: { kind: 'manual' },
    figures: 'none', confidence: 'confirm', note: 'Ghana has no provincial or state taxes. Local assemblies charge an annual business operating permit and sometimes property rates; the date and fee depend on the assembly.',
  },
];

const SKAT = 'Skattestyrelsen (Danish Tax Agency)';

const DK_OBLIGATIONS: Obligation[] = [
  {
    id: 'dk-moms', level: 'federal', authority: SKAT, name: 'VAT return (momsangivelse)', frequency: 'chosen', periodBasis: 'fiscal',
    rule: { monthly: AFTER(1, 25), quarterly: AFTER(3, 1), semiannual: AFTER(3, 1) }, figures: 'salesTax', taxCategories: ['vat'], when: 'taxRegistered', confidence: 'confirm',
    note: 'Skattestyrelsen assigns the period by turnover: roughly under DKK 5 million a year is half-yearly, DKK 5 to 50 million quarterly, above that monthly. Filed on TastSelv Erhverv.',
    url: 'https://skat.dk/erhverv/moms',
  },
  {
    id: 'dk-corp-tax', level: 'federal', authority: SKAT, name: 'Corporate income tax return (selskabsselvangivelse)', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(6, 'end'),
    figures: 'income', appliesTo: CORP, note: 'Due 6 months after the end of the financial year. The corporate tax rate is 22%.', url: 'https://skat.dk/erhverv/selskaber',
  },
  {
    id: 'dk-acontoskat', level: 'federal', authority: SKAT, name: 'Preliminary corporate tax (acontoskat)', frequency: 'annual', periodBasis: 'fiscal', rule: { kind: 'instalments', months: [3, 11], day: 20 },
    figures: 'none', appliesTo: CORP, confidence: 'confirm', note: 'Paid in two instalments, 20 March and 20 November for a calendar-year company. A company can choose to pay in more.',
    url: 'https://skat.dk/erhverv/selskaber',
  },
  {
    id: 'dk-annual-report', level: 'federal', authority: 'Danish Business Authority (Erhvervsstyrelsen)', name: 'Annual report (årsrapport)', frequency: 'annual', periodBasis: 'fiscal', rule: AFTER(5, 'end'),
    figures: 'income', appliesTo: CORP, confidence: 'confirm', note: 'Filed with the business register. The deadline is 5 months after the year end for most companies; check your reporting class.',
    url: 'https://erhvervsstyrelsen.dk/',
  },
  {
    id: 'dk-sole', level: 'federal', authority: SKAT, name: 'Personal return with business income (oplysningsskema)', frequency: 'annual', periodBasis: 'calendar', rule: AFTER(7, 1),
    figures: 'income', appliesTo: ['sole-proprietor'], confidence: 'confirm', note: 'Self-employed people usually file by 1 July for the previous calendar year.', url: 'https://skat.dk/borger/selvstaendig',
  },
  {
    id: 'dk-payroll', level: 'federal', authority: SKAT, name: 'Withheld income tax and labour market contribution (A-skat, AM-bidrag)', frequency: 'monthly', periodBasis: 'calendar', rule: AFTER(1, 10),
    figures: 'payroll', when: 'employees', confidence: 'confirm', note: 'Reported through eIndkomst. Small employers report monthly, due the 10th of the next month; larger ones report on a different schedule.',
    url: 'https://skat.dk/erhverv/loen-og-personale',
  },
];

export interface Jurisdiction {
  country: FilingCountry;
  /** The province or state code when it is recognised, otherwise ''. */
  region: string;
  regionName: string;
  /** What the second level is called here: Provincial, State, or none (Ghana). */
  regionLevel: FilingLevel | null;
  notes: string[];
}

export function jurisdictionOf(country?: string | null, state?: string | null): Jurisdiction {
  const c = filingCountryOf(country);
  if (c === 'CA') {
    const code = provinceCode(state);
    const notes = [
      'Canada has federal and provincial filings. Corporations file one T2 return that covers federal and provincial income tax, except in Quebec (CO-17) and Alberta (AT1), which have their own.',
    ];
    if (['NB', 'NL', 'NS', 'PE', 'ON'].includes(code)) notes.push('Your province uses the HST, so the provincial part is on the federal GST/HST return and there is no separate provincial sales tax return.');
    if (['YT', 'NT', 'NU'].includes(code)) notes.push('Your territory has no territorial sales tax: only the 5% federal GST applies.');
    if (!code) notes.push('Set your province in the company profile to see the provincial filings that apply to you.');
    return { country: c, region: code, regionName: CA_PROVINCE_NAME[code] ?? (state ?? ''), regionLevel: 'provincial', notes };
  }
  if (c === 'US') {
    const code = usStateCode(state);
    const notes = ['The United States has federal and state filings. There is no federal sales tax: sales tax is a state (and local) matter.'];
    if (!code) notes.push('Set your state in the company profile to see the state filings that apply to you.');
    return { country: c, region: code, regionName: state ?? '', regionLevel: 'state', notes };
  }
  if (c === 'GH') {
    return {
      country: c, region: '', regionName: state ?? '', regionLevel: null,
      notes: ['Ghana does not have provincial or state taxes. Almost everything is filed with the Ghana Revenue Authority.'],
    };
  }
  if (c === 'DK') {
    return {
      country: c, region: '', regionName: state ?? '', regionLevel: null,
      notes: [
        'Denmark has no regional taxes on companies: income tax and VAT are filed with Skattestyrelsen, and the annual report with the Danish Business Authority.',
        'Partnerships (I/S) are not taxed themselves: each partner reports their share, so there is no company income tax return to track here.',
      ],
    };
  }
  return {
    country: 'OTHER', region: '', regionName: state ?? '', regionLevel: null,
    notes: ['Built-in filings cover Canada, the United States, Denmark and Ghana. For another country, add your own filings below with the authority, how often, and the due date rule.'],
  };
}

export function builtInObligations(j: Jurisdiction): Obligation[] {
  let list: Obligation[] = [];
  if (j.country === 'CA') list = [...CA_FEDERAL, ...(CA_PROVINCIAL[j.region] ?? [])];
  else if (j.country === 'US') list = [...US_FEDERAL, ...(j.regionName || j.region ? usStateGeneric(j.regionName || j.region) : []), ...(US_STATE_SPECIFIC[j.region] ?? [])];
  else if (j.country === 'GH') list = GH_OBLIGATIONS;
  else if (j.country === 'DK') list = DK_OBLIGATIONS;
  // an obligation can take the place of a more general one (the Quebec return replaces the federal GST/HST return)
  const replaced = new Set(list.map((o) => o.replaces).filter(Boolean));
  return list.filter((o) => !replaced.has(o.id));
}

export function customToObligation(c: CustomObligation): Obligation {
  return {
    id: c.id, level: c.level, authority: c.authority || 'Tax authority', name: c.name, frequency: c.frequency, periodBasis: c.periodBasis,
    rule: AFTER(c.monthsAfter, c.day), figures: 'none', note: 'Added by you.',
  };
}

export interface ResolvedContext {
  employees: boolean;
  registered: boolean;
}

/** The obligations that apply to this company: built-in for its jurisdiction, filtered by entity type, employees and tax registration, plus its own. */
export function applicableObligations(j: Jurisdiction, profile: FilingProfile, ctx: ResolvedContext): Obligation[] {
  const base = builtInObligations(j).filter((o) => {
    if (o.appliesTo && !o.appliesTo.includes(profile.entityType)) return false;
    if (o.when === 'employees' && !ctx.employees) return false;
    if (o.when === 'taxRegistered' && !ctx.registered) return false;
    return true;
  });
  return [...base, ...profile.custom.map(customToObligation)];
}

export function recordKey(obligationId: string, key: string): string {
  return `${obligationId}|${key}`;
}

export const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Every six months', annual: 'Annual' };

/** The heading for a level in this country: the top level is "National" in Ghana and "Federal" elsewhere. */
export function levelLabel(country: FilingCountry, level: FilingLevel): string {
  if (level === 'federal') return country === 'GH' || country === 'DK' || country === 'OTHER' ? 'National' : 'Federal';
  return LEVEL_LABEL[level];
}

const ENTITY_SET = new Set<string>(['corporation', 's-corp', 'partnership', 'sole-proprietor']);
const FREQ_SET = new Set<string>(['monthly', 'quarterly', 'semiannual', 'annual']);
const LEVEL_SET = new Set<string>(['federal', 'provincial', 'state', 'regional']);

/** Accepts whatever was saved (nothing, an older shape, a damaged value) and returns a state the screen can always render. */
export function normalizeFilings(raw: unknown): FilingsState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FilingsState>;
  const p = (r.profile && typeof r.profile === 'object' ? r.profile : {}) as Partial<FilingProfile>;
  const custom = Array.isArray(p.custom)
    ? p.custom.filter((c): c is CustomObligation => !!c && typeof c.id === 'string' && typeof c.name === 'string' && FREQ_SET.has(c.frequency) && LEVEL_SET.has(c.level)
        && Number.isFinite(c.monthsAfter) && (c.day === 'end' || Number.isFinite(c.day)))
    : [];
  const records = Array.isArray(r.records)
    ? r.records.filter((x): x is FilingRecord => !!x && typeof x.key === 'string' && (x.status === 'preparing' || x.status === 'review' || x.status === 'filed' || x.status === 'not-required'))
    : [];
  return {
    profile: {
      entityType: ENTITY_SET.has(p.entityType as string) ? (p.entityType as EntityType) : DEFAULT_FILING_PROFILE.entityType,
      hasEmployees: typeof p.hasEmployees === 'boolean' ? p.hasEmployees : undefined,
      salesTaxRegistered: typeof p.salesTaxRegistered === 'boolean' ? p.salesTaxRegistered : undefined,
      salesTaxFrequency: FREQ_SET.has(p.salesTaxFrequency as string) ? (p.salesTaxFrequency as Frequency) : DEFAULT_FILING_PROFILE.salesTaxFrequency,
      trackedFrom: isIso(p.trackedFrom) ? p.trackedFrom : undefined,
      confirmed: p.confirmed === true,
      custom,
    },
    records,
  };
}
