import type { LeadAssignmentRule, LeadStage } from './data';

/**
 * Lead assignment rules: first matching rule owns the lead. A rule names one
 * owner outright, or a round-robin pool where the least-loaded owner wins
 * (open-lead count). Pure; the store applies them on capture and on demand.
 */

export function ruleSummary(r: LeadAssignmentRule): string {
  const bits: string[] = [];
  if (r.stage && r.stage !== 'any') bits.push(`stage is ${r.stage}`);
  if (r.sourceContains?.trim()) bits.push(`source contains "${r.sourceContains.trim()}"`);
  if (typeof r.minValue === 'number' && r.minValue > 0) bits.push(`value ≥ ${r.minValue.toLocaleString()}`);
  const who = r.roundRobin?.length ? `round-robin ${r.roundRobin.join(', ')}` : r.assignee || 'unassigned';
  return `${bits.length ? bits.join(' + ') : 'every lead'} → ${who}`;
}

export function ruleMatches(rule: LeadAssignmentRule, lead: { stage: string; source: string; value: number }): boolean {
  if (rule.stage && rule.stage !== 'any' && lead.stage !== (rule.stage as LeadStage)) return false;
  const needle = (rule.sourceContains ?? '').trim().toLowerCase();
  if (needle && !lead.source.toLowerCase().includes(needle)) return false;
  if (typeof rule.minValue === 'number' && rule.minValue > 0 && !(lead.value >= rule.minValue)) return false;
  return true;
}

/** Open (new/qualified/proposal) leads per owner: the load a round-robin balances. */
export function openLoad(leads: Array<{ ownerId: string; stage: string }>): Map<string, number> {
  const load = new Map<string, number>();
  for (const l of leads) {
    if (l.stage === 'won' || l.stage === 'lost') continue;
    const owner = (l.ownerId ?? '').trim();
    if (!owner) continue;
    load.set(owner, (load.get(owner) ?? 0) + 1);
  }
  return load;
}

/**
 * The owner for a lead: first matching rule wins. A round-robin pool picks
 * the least-loaded member (ties go to pool order, so the rota is stable).
 * Null when nothing matches or the rule names nobody.
 */
export function assignOwner(
  rules: LeadAssignmentRule[],
  lead: { stage: string; source: string; value: number },
  openLeads: Array<{ ownerId: string; stage: string }>,
): string | null {
  const rule = rules.find((r) => ruleMatches(r, lead));
  if (!rule) return null;
  if (rule.roundRobin?.length) {
    const load = openLoad(openLeads);
    let best = rule.roundRobin[0];
    for (const member of rule.roundRobin.slice(1)) {
      if ((load.get(member) ?? 0) < (load.get(best) ?? 0)) best = member;
    }
    return best;
  }
  return rule.assignee.trim() || null;
}
