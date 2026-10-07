import type { FundingOpportunity, KnowledgeEntry, Workspace } from './data';

/**
 * Pure funding analysis — no I/O, no server-only, unit-testable. The server
 * pipeline (fundraising-pipeline.ts) browses program websites and feeds the
 * raw text through here: requirements + expectations come out summarized, a
 * fit score ranks the opportunity, and a submission draft is assembled from
 * the company profile. Deterministic so it works with or without an LLM.
 */

export interface FundingRequirements {
  requirements: string;
  expectations: string;
  documentsNeeded: string[];
  deadline?: string;
  amount?: number;
}

export interface CompanyProfile {
  name: string;
  industry: string;
  country: string;
  services: string[];
  about: string;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“])/;

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 500);
}

const REQUIREMENT_HINTS = [
  'eligib', 'requirement', 'must be', 'must have', 'applicant', 'qualify', 'criteria',
  'who can apply', 'eligible', 'ineligib', 'business must', 'compan', 'must',
  'registered', 'in operation', 'at least', 'revenue', 'employees', 'sector', 'turnover',
];

const EXPECTATION_HINTS = [
  'expect', 'deliverable', 'report', 'milestone', 'timeline', 'disbursement',
  'paid in', 'tranches', 'obligation', 'monitor', 'evaluation', 'audited',
  'progress update', 'final report', 'matching fund', 'co-fund',
];

const DOCUMENT_HINTS: { match: RegExp; label: string }[] = [
  { match: /application form/i, label: 'Completed application form' },
  { match: /business plan/i, label: 'Business plan' },
  { match: /budget/i, label: 'Project budget' },
  { match: /financial statement/i, label: 'Financial statements' },
  { match: /bank statement/i, label: 'Bank statements' },
  { match: /registration|certificate of incorporation/i, label: 'Business registration certificate' },
  { match: /tax (clearance|certificate|number|id)/i, label: 'Tax clearance / tax ID' },
  { match: /pitch deck/i, label: 'Pitch deck' },
  { match: /cv|r[ée]sum[ée]/i, label: 'Founder CVs' },
  { match: /reference letter|support letter/i, label: 'Reference / support letters' },
  { match: /project proposal/i, label: 'Project proposal' },
  { match: /proof of address|utility bill/i, label: 'Proof of address' },
  { match: /id (card|document)|passport/i, label: 'Founder ID documents' },
];

const DATE_NEAR_DEADLINE = new RegExp(
  String.raw`(?:deadline|closing|closes|due|apply by|submit by)[^.]{0,80}?(` +
    String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}|\d{4}-\d{2}-\d{2})`,
  'i',
);

const AMOUNT_RE = /\$\s?[\d,]+(?:\.\d+)?\s?(k|m|million|thousand)?/i;

/** Pull requirements, expectations, document checklist, deadline and amount out of raw page text. */
export function extractFundingRequirements(markdown: string): FundingRequirements {
  const text = (markdown ?? '').slice(0, 20_000);
  const sents = sentences(text);

  const pick = (hints: string[], max: number): string[] => {
    const out: string[] = [];
    for (const s of sents) {
      const l = s.toLowerCase();
      if (hints.some((h) => l.includes(h)) && !out.some((o) => o.toLowerCase() === l)) {
        out.push(s);
        if (out.length >= max) break;
      }
    }
    return out;
  };

  const reqs = pick(REQUIREMENT_HINTS, 6);
  const exps = pick(EXPECTATION_HINTS, 6);
  const documentsNeeded = DOCUMENT_HINTS.filter((d) => d.match.test(text)).map((d) => d.label);

  const deadlineMatch = DATE_NEAR_DEADLINE.exec(text);
  const amountMatch = AMOUNT_RE.exec(text.slice(0, 4000));
  let amount: number | undefined;
  if (amountMatch) {
    const suffix = (amountMatch[1] ?? '').toLowerCase();
    const raw = Number(amountMatch[0].replace(/[$,\s]/g, '').replace(/[a-z]+$/i, ''));
    if (Number.isFinite(raw)) {
      amount = suffix.startsWith('m') || suffix.startsWith('million') ? raw * 1_000_000
        : suffix.startsWith('k') || suffix.startsWith('thousand') ? raw * 1000
        : raw;
    }
  }

  return {
    requirements: reqs.length
      ? reqs.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'No explicit eligibility criteria found on the program page — confirm directly with the funder before applying.',
    expectations: exps.length
      ? exps.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : 'No explicit deliverables or reporting terms found on the program page — ask the funder what reporting they expect.',
    documentsNeeded,
    deadline: deadlineMatch?.[1],
    amount,
  };
}

export interface FitScore {
  score: number;
  reasons: string[];
}

/** Deterministic 0–100 fit of an opportunity against the company profile. */
export function scoreFundingFit(
  opp: Pick<FundingOpportunity, 'program' | 'source' | 'note'> & { requirements?: string },
  profile: CompanyProfile,
): FitScore {
  const hay = `${opp.program} ${opp.source} ${opp.note} ${opp.requirements ?? ''}`.toLowerCase();
  let score = 50;
  const reasons: string[] = ['Baseline 50 — program is a live funding opportunity.'];

  const industryWords = profile.industry.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  if (industryWords.some((w) => hay.includes(w))) {
    score += 15;
    reasons.push('+15 industry match.');
  }
  const serviceWords = profile.services.flatMap((s) => s.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 3);
  if (serviceWords.some((w) => w.length > 4 && hay.includes(w))) {
    score += 15;
    reasons.push('+15 service/activity match.');
  }
  if (profile.country && hay.includes(profile.country.toLowerCase())) {
    score += 10;
    reasons.push(`+10 country match (${profile.country}).`);
  }
  if (/(startup|start-up|small business|sme|early-stage|seed)/i.test(hay)) {
    score += 5;
    reasons.push('+5 startup/SME friendly.');
  }
  if (/(alcohol|tobacco|gambling|weapon|adult)/i.test(hay)) {
    score -= 20;
    reasons.push('−20 restricted-sector program.');
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/** Company profile assembled from the workspace + knowledge base. */
export function companyProfileFrom(ws: Partial<Workspace> | null, kb: KnowledgeEntry[]): CompanyProfile {
  const about = kb
    .filter((k) => k.category === 'company' || k.category === 'services')
    .slice(0, 4)
    .map((k) => `${k.title}: ${k.answer}`)
    .join('\n');
  return {
    name: ws?.legalName || ws?.name || 'the company',
    industry: ws?.industry || 'general business',
    country: ws?.country || '',
    services: ws?.services ?? [],
    about: about || 'No company description on file yet.',
  };
}

/** Ready-to-submit application draft assembled from profile + extracted facts. */
export function buildApplicationDraft(
  opp: Pick<FundingOpportunity, 'program' | 'source' | 'amount' | 'deadline' | 'url'> & {
    requirements?: string; expectations?: string; documentsNeeded?: string[];
  },
  profile: CompanyProfile,
  fit: FitScore,
): string {
  const docs = (opp.documentsNeeded ?? []).map((d) => `- [ ] ${d}`).join('\n') || '- [ ] Confirm the document list with the funder';
  return [
    `APPLICATION DRAFT — ${opp.program}`,
    `Funder: ${opp.source} | Amount: $${opp.amount.toLocaleString()} | Deadline: ${opp.deadline || 'see program page'} | Fit: ${fit.score}%`,
    '',
    `1. Applicant: ${profile.name} (${profile.industry}${profile.country ? `, ${profile.country}` : ''})`,
    `   Services: ${profile.services.length ? profile.services.join(', ') : 'see company profile'}`,
    `   About: ${profile.about.split('\n')[0] ?? ''}`,
    '',
    `2. Why we fit (${fit.score}%): ${fit.reasons.join(' ')}`,
    '',
    `3. Eligibility (from ${opp.url || 'program page'}):`,
    (opp.requirements ?? '').split('\n').slice(0, 6).map((l) => `   ${l}`).join('\n') || '   Confirm eligibility with the funder.',
    '',
    '4. What they expect:',
    (opp.expectations ?? '').split('\n').slice(0, 6).map((l) => `   ${l}`).join('\n') || '   Confirm reporting terms with the funder.',
    '',
    '5. Document checklist:',
    docs,
    '',
    `6. Submission: ${fit.score >= 85 ? 'auto-submitted by Nadia (fit ≥ 85%).' : `draft only (fit ${fit.score}% < 85%) — review, then submit on the program portal: ${opp.url || ''}`}`,
    '',
    'Drafted by Nadia from the program website + company profile — review before submitting.',
  ].join('\n');
}
