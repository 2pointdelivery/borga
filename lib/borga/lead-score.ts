import type { Lead } from './data';

/**
 * Rule-based lead scoring (0-100, explainable — every point names its reason).
 * No model, no training data: the same lead always scores the same, so the
 * pipeline order is stable and the rep can see exactly what to improve
 * (diagnose the need, make contact, grow the deal).
 */

export type ScoreBand = 'hot' | 'warm' | 'cold';

export interface ScoreFactor {
  key: string;
  points: number;
  max: number;
  why: string;
}

export interface LeadScore {
  score: number;
  band: ScoreBand;
  factors: ScoreFactor[];
}

const DAY = 86_400_000;

function valuePoints(value: number): { points: number; why: string } {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (v <= 0) return { points: 0, why: 'No deal value recorded yet.' };
  if (v < 1000) return { points: 8, why: `Deal value ${v.toLocaleString()} (small).` };
  if (v < 10_000) return { points: 18, why: `Deal value ${v.toLocaleString()} (mid-size).` };
  if (v < 50_000) return { points: 26, why: `Deal value ${v.toLocaleString()} (large).` };
  return { points: 30, why: `Deal value ${v.toLocaleString()} (strategic).` };
}

function stagePoints(stage: Lead['stage']): { points: number; why: string } {
  switch (stage) {
    case 'new': return { points: 5, why: 'Stage: new (10% to close).' };
    case 'qualified': return { points: 12, why: 'Stage: qualified (30% to close).' };
    case 'proposal': return { points: 20, why: 'Stage: proposal (60% to close).' };
    case 'won': return { points: 20, why: 'Stage: won — keep the relationship warm.' };
    case 'lost': return { points: 0, why: 'Stage: lost — score frozen at zero.' };
  }
}

function recencyPoints(lead: Lead, nowMs: number): { points: number; why: string } {
  const at = lead.lastContactAt ?? lead.createdAt;
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return { points: 0, why: 'No contact recorded yet.' };
  const days = Math.max(0, (nowMs - t) / DAY);
  if (days <= 2) return { points: 20, why: 'Contact within the last 2 days.' };
  if (days <= 7) return { points: 12, why: `Last contact ${Math.floor(days)} days ago.` };
  if (days <= 30) return { points: 5, why: `Last contact ${Math.floor(days)} days ago — going cold.` };
  return { points: 0, why: `No contact for ${Math.floor(days)} days.` };
}

/** A diagnosed need and reachable contact details: the two things a rep controls directly. */
function fitPoints(lead: Lead): { points: number; why: string } {
  let points = 0;
  const bits: string[] = [];
  const answered = [lead.diagnosis?.problem, lead.diagnosis?.since, lead.diagnosis?.tried].filter((v) => v && v.trim()).length;
  if (answered > 0) {
    points += answered >= 3 ? 10 : 6;
    bits.push(`need diagnosed (${answered}/3 questions)`);
  }
  if (lead.email.trim()) {
    points += 5;
    bits.push('email on file');
  }
  if (lead.phone.trim()) {
    points += 5;
    bits.push('phone on file');
  }
  if (!bits.length) return { points: 0, why: 'No diagnosis and no contact details.' };
  return { points: Math.min(20, points), why: bits.join(', ').slice(0, 120) + '.' };
}

export function scoreLead(lead: Lead, nowMs: number = Date.now()): LeadScore {
  if (lead.stage === 'lost') {
    return { score: 0, band: 'cold', factors: [{ key: 'stage', points: 0, max: 20, why: 'Stage: lost — score frozen at zero.' }] };
  }
  const value = valuePoints(lead.value);
  const stage = stagePoints(lead.stage);
  const recency = recencyPoints(lead, nowMs);
  const fit = fitPoints(lead);
  const score = Math.min(100, value.points + stage.points + recency.points + fit.points);
  return {
    score,
    band: score >= 65 ? 'hot' : score >= 35 ? 'warm' : 'cold',
    factors: [
      { key: 'value', points: value.points, max: 30, why: value.why },
      { key: 'stage', points: stage.points, max: 20, why: stage.why },
      { key: 'recency', points: recency.points, max: 20, why: recency.why },
      { key: 'fit', points: fit.points, max: 20, why: fit.why },
    ],
  };
}

/** Pipeline order: hottest first, then biggest value. Closed deals sink (won above lost). */
export function compareLeadsByScore(a: Lead, b: Lead, nowMs: number = Date.now()): number {
  const rank = (l: Lead) => (l.stage === 'lost' ? -2 : l.stage === 'won' ? -1 : scoreLead(l, nowMs).score);
  const sa = rank(a);
  const sb = rank(b);
  if (sa !== sb) return sb - sa;
  return b.value - a.value;
}
