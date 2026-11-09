// Bank reconciliation scoring: amount + date window + payee tokens.
// Replaces amount-coincidence matching (two equal amounts on different days
// are not the same money). Pure — tested in lib/reconcile.test.ts.

export interface ReconTxn {
  amount: number;
  dateIso?: string;
  description: string;
}

export interface ReconCandidate {
  ref: string;
  amount: number;
  dateIso?: string;
  label: string;
}

export interface ReconScore {
  candidate: ReconCandidate;
  score: number; // 0–100
  reasons: string[];
}

const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'payment', 'paid', 'invoice', 'bill', 'ref', 'no', 'transfer', 'bank', 'ltd', 'inc', 'llc', 'co', 'ltda']);

function tokens(s: string): Set<string> {
  return new Set(
    (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

function dayDiff(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(a) - Date.parse(b);
  if (!Number.isFinite(ms)) return null;
  return Math.abs(ms) / 86_400_000;
}

/** Score one candidate against a bank line. Deterministic, explainable. */
export function scoreCandidate(txn: ReconTxn, c: ReconCandidate): ReconScore {
  let score = 0;
  const reasons: string[] = [];
  if (txn.amount === 0 || c.amount === 0 || Math.sign(txn.amount) !== Math.sign(c.amount)) {
    return { candidate: c, score: 0, reasons: ['amount sign differs'] };
  }
  // Amount (40): exact cents, then 1% and 5% bands.
  const rel = Math.abs(c.amount - txn.amount) / Math.abs(txn.amount);
  if (Math.abs(c.amount - txn.amount) < 0.005) { score += 40; reasons.push('exact amount'); }
  else if (rel < 0.01) { score += 25; reasons.push('amount within 1%'); }
  else if (rel < 0.05) { score += 10; reasons.push('amount within 5%'); }
  else return { candidate: c, score, reasons: ['amount too far'] };
  // Date window (25): same-week postings score highest.
  const dd = dayDiff(txn.dateIso, c.dateIso);
  if (dd !== null) {
    if (dd <= 3) { score += 25; reasons.push('same week'); }
    else if (dd <= 7) { score += 15; reasons.push('within 7 days'); }
    else if (dd <= 14) { score += 5; reasons.push('within 14 days'); }
    else return { candidate: c, score: 0, reasons: ['dates too far apart'] };
  }
  // Payee tokens (up to 30): shared significant words.
  const a = tokens(txn.description);
  const b = tokens(c.label);
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  if (shared > 0) {
    const pts = Math.min(30, shared * 10);
    score += pts;
    reasons.push(shared === 1 ? 'payee word matches' : `${shared} payee words match`);
  }
  return { candidate: c, score: Math.min(100, score), reasons };
}

/** Ranked candidates at or above the bar, best first. */
export function rankCandidates(txn: ReconTxn, candidates: ReconCandidate[], minScore = 55): ReconScore[] {
  return candidates
    .map((c) => scoreCandidate(txn, c))
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score);
}

/** Auto-match bar: only near-certain matches apply without a human. */
export const AUTO_MATCH_SCORE = 85;
