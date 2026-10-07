import 'server-only';
import { getBorgaState, setBorgaState, scopedKey } from './persistence';
import { userWsKey, userWorkspacesKey } from './keys';
import {
  buildApplicationDraft,
  companyProfileFrom,
  extractFundingRequirements,
  scoreFundingFit,
  type CompanyProfile,
} from './funding-analysis';
import { addNotice } from './notices';
import {
  FUNDING_AUTO_APPLY_FIT,
  INITIAL_FUNDRAISING,
  KNOWLEDGE_SEED,
  type ActivityEvent,
  type AgentMemory,
  type FundingOpportunity,
  type KnowledgeEntry,
  type Workspace,
} from './data';

/**
 * The autonomous fundraising pipeline: browse every program website,
 * summarize requirements + expectations, score the fit, draft the
 * application, and auto-advance high-fit opportunities — start to finish
 * with no clicks. The Fundraising tab, the `analyze_funding` /
 * `draft_application` / `run_funding_pipeline` agent tools, and the weekly
 * Grant Opportunity Scan are all thin callers of this module.
 */

export function fundraisingKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'fundraising') : scopedKey(ws, 'fundraising');
}

export async function loadOpportunities(
  ws: string | null | undefined, userId: string | null | undefined,
): Promise<FundingOpportunity[]> {
  return (await getBorgaState<FundingOpportunity[]>(fundraisingKey(ws, userId))) ?? INITIAL_FUNDRAISING;
}

export async function saveOpportunities(
  opps: FundingOpportunity[], ws: string | null | undefined, userId: string | null | undefined,
): Promise<void> {
  await setBorgaState(fundraisingKey(ws, userId), opps.slice(0, 100));
}

/** Patch one opportunity in place; null when the id is unknown. */
export async function patchOpportunity(
  id: string, patch: Partial<FundingOpportunity>,
  ws: string | null | undefined, userId: string | null | undefined,
): Promise<FundingOpportunity | null> {
  const opps = await loadOpportunities(ws, userId);
  const idx = opps.findIndex((o) => o.id === id);
  if (idx === -1) return null;
  opps[idx] = { ...opps[idx], ...patch };
  await saveOpportunities(opps, ws, userId);
  return opps[idx];
}

const TERMINAL_STAGES: FundingOpportunity['stage'][] = ['applied', 'won', 'rejected'];

export function isPipelineOpen(opp: FundingOpportunity): boolean {
  return !TERMINAL_STAGES.includes(opp.stage);
}

// ---------------------------------------------------------------------------
// Page fetch (SSRF-guarded, plain HTTP + tag strip — deterministic, no LLM)
// ---------------------------------------------------------------------------

export interface FetchedPage {
  url: string;
  title: string;
  markdown: string;
}

export async function fetchFundingPage(rawUrl: string): Promise<FetchedPage> {
  const u = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https URLs are allowed');
  if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|localhost$|0\.0\.0\.0$)/i.test(u.hostname)) {
    throw new Error('Internal network URLs are blocked');
  }
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': 'Borga/1.0 (autonomous fundraising agent)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`The site answered ${res.status}`);
  const html = await res.text();
  const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim() ?? u.hostname;
  const markdown = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20_000);
  if (markdown.length < 200) throw new Error('The page had almost no readable text — it may need JavaScript or a login');
  return { url: u.toString(), title, markdown };
}

// ---------------------------------------------------------------------------
// Company context + activity/memory helpers
// ---------------------------------------------------------------------------

export async function loadCompanyProfile(
  ws: string | null | undefined, userId: string | null | undefined, fallbackName?: string,
): Promise<CompanyProfile> {
  let workspace: Workspace | null = null;
  try {
    if (userId) {
      const all = (await getBorgaState<Workspace[]>(userWorkspacesKey(userId))) ?? [];
      workspace = all.find((w) => w.id === ws) ?? all[0] ?? null;
    }
  } catch {
    // Profile is best-effort; the draft still builds from the fallback name.
  }
  let kb: KnowledgeEntry[] = KNOWLEDGE_SEED;
  try {
    const key = ws && userId ? userWsKey(userId, ws, 'knowledge') : scopedKey(ws, 'knowledge');
    kb = (await getBorgaState<KnowledgeEntry[]>(key)) ?? KNOWLEDGE_SEED;
  } catch {
    // Same — drafts degrade, never fail.
  }
  const profile = companyProfileFrom(workspace, kb);
  if (fallbackName && (profile.name === 'the company' || !workspace)) profile.name = fallbackName;
  return profile;
}

async function logActivity(
  message: string, agentId: string, agentName: string,
  ws: string | null | undefined, userId: string | null | undefined,
): Promise<void> {
  try {
    const key = ws && userId ? userWsKey(userId, ws, 'activity') : scopedKey(ws, 'activity');
    const existing = (await getBorgaState<ActivityEvent[]>(key)) ?? [];
    const entry: ActivityEvent = {
      id: `e-fund-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      agentId, agentName, actor: 'agent', kind: 'task', message: message.slice(0, 300),
    };
    await setBorgaState(key, [entry, ...existing].slice(0, 200));
  } catch {
    // Best-effort
  }
}

async function remember(
  content: string, agentId: string, agentName: string,
  ws: string | null | undefined, userId: string | null | undefined,
): Promise<void> {
  try {
    const key = ws && userId ? userWsKey(userId, ws, 'memories') : scopedKey(ws, 'memories');
    const existing = (await getBorgaState<AgentMemory[]>(key)) ?? [];
    const now = new Date().toISOString();
    existing.unshift({
      id: `mem-fund-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      agentId, agentName, kind: 'observation',
      content: content.slice(0, 1000),
      tags: ['fundraising', 'auto-pipeline'], confidence: 85, createdAt: now, lastAccessed: now,
    });
    await setBorgaState(key, existing.slice(0, 200));
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Pipeline steps — each one persists, so a failure mid-run never loses work
// ---------------------------------------------------------------------------

export interface AnalyzeResult {
  id: string;
  program: string;
  ok: boolean;
  requirements?: string;
  expectations?: string;
  documentsNeeded?: string[];
  matchScore?: number;
  error?: string;
}

/** Browse one program site, summarize requirements + expectations, score the fit. */
export async function analyzeOpportunity(
  id: string, ws: string | null | undefined, userId: string | null | undefined,
  agent: { id: string; name: string } = { id: 'a-fundraising', name: 'Nadia' },
): Promise<AnalyzeResult> {
  const opp = (await loadOpportunities(ws, userId)).find((o) => o.id === id);
  if (!opp) return { id, program: id, ok: false, error: 'Opportunity not found' };
  if (!opp.url?.trim()) {
    await patchOpportunity(id, { analysisError: 'No program URL saved — add the source link first.' }, ws, userId);
    return { id, program: opp.program, ok: false, error: 'No program URL saved' };
  }
  try {
    const page = await fetchFundingPage(opp.url);
    const extracted = extractFundingRequirements(page.markdown);
    const profile = await loadCompanyProfile(ws, userId);
    const fit = scoreFundingFit({ program: opp.program, source: opp.source, note: opp.note, requirements: extracted.requirements }, profile);
    const patch: Partial<FundingOpportunity> = {
      requirements: extracted.requirements,
      expectations: extracted.expectations,
      documentsNeeded: extracted.documentsNeeded,
      matchScore: fit.score,
      lastAnalyzedAt: new Date().toISOString(),
      analysisError: null,
      note: opp.note?.startsWith('Auto:')
        ? `Auto: ${page.title} — fit ${fit.score}% (${fit.reasons.join(' ')}). ${opp.note.replace(/^Auto:[^.]*\.\s*/, '')}`.slice(0, 500)
        : opp.note,
    };
    if (!opp.deadline?.trim() && extracted.deadline) patch.deadline = extracted.deadline;
    if ((!opp.amount || opp.amount <= 0) && extracted.amount) patch.amount = extracted.amount;
    if (!TERMINAL_STAGES.includes(opp.stage) && (opp.stage === 'identified' || !opp.requirements)) {
      patch.stage = 'evaluating';
    }
    await patchOpportunity(id, patch, ws, userId);
    await logActivity(`${agent.name} analyzed ${opp.program}: requirements + expectations summarized, fit ${fit.score}%.`, agent.id, agent.name, ws, userId);
    return { id, program: opp.program, ok: true, requirements: extracted.requirements, expectations: extracted.expectations, documentsNeeded: extracted.documentsNeeded, matchScore: fit.score };
  } catch (e) {
    const error = (e as Error).message || 'Analysis failed';
    await patchOpportunity(id, { analysisError: error }, ws, userId);
    await logActivity(`${agent.name} could not analyze ${opp.program}: ${error}`, agent.id, agent.name, ws, userId);
    return { id, program: opp.program, ok: false, error };
  }
}

export interface DraftResult {
  id: string;
  program: string;
  ok: boolean;
  draft?: string;
  stage?: FundingOpportunity['stage'];
  error?: string;
}

/** Build (or rebuild) the submission draft from profile + extracted facts. */
export async function draftApplication(
  id: string, ws: string | null | undefined, userId: string | null | undefined,
  agent: { id: string; name: string } = { id: 'a-fundraising', name: 'Nadia' },
): Promise<DraftResult> {
  const opp = (await loadOpportunities(ws, userId)).find((o) => o.id === id);
  if (!opp) return { id, program: id, ok: false, error: 'Opportunity not found' };
  if (TERMINAL_STAGES.includes(opp.stage)) {
    return { id, program: opp.program, ok: false, error: `Already ${opp.stage} — drafts are for open opportunities` };
  }
  // No analysis yet? Analyze first — the draft needs real requirements.
  let current = opp;
  if (!current.requirements) {
    const analyzed = await analyzeOpportunity(id, ws, userId, agent);
    if (!analyzed.ok) return { id, program: opp.program, ok: false, error: analyzed.error };
    current = (await loadOpportunities(ws, userId)).find((o) => o.id === id) ?? opp;
  }
  const profile = await loadCompanyProfile(ws, userId);
  const fit = scoreFundingFit({ program: current.program, source: current.source, note: current.note, requirements: current.requirements }, profile);
  const draft = buildApplicationDraft(
    {
      program: current.program, source: current.source, amount: current.amount,
      deadline: current.deadline, url: current.url, requirements: current.requirements,
      expectations: current.expectations, documentsNeeded: current.documentsNeeded,
    },
    profile, fit,
  );
  const stage: FundingOpportunity['stage'] = current.stage === 'identified' || current.stage === 'evaluating' ? 'applying' : current.stage;
  await patchOpportunity(id, { applicationDraft: draft, matchScore: fit.score, stage }, ws, userId);
  await logActivity(`${agent.name} drafted the ${current.program} application (fit ${fit.score}%).`, agent.id, agent.name, ws, userId);
  return { id, program: current.program, ok: true, draft, stage };
}

export interface ApplyResult {
  id: string;
  program: string;
  ok: boolean;
  auto?: boolean;
  stage?: FundingOpportunity['stage'];
  error?: string;
}

/**
 * Advance one opportunity. Fit ≥ 85 auto-submits (submission package marked
 * applied); anything below keeps a review-ready draft at `applying`.
 */
export async function applyForOpportunity(
  id: string, ws: string | null | undefined, userId: string | null | undefined,
  agent: { id: string; name: string } = { id: 'a-fundraising', name: 'Nadia' },
  threshold = FUNDING_AUTO_APPLY_FIT,
): Promise<ApplyResult> {
  const opp = (await loadOpportunities(ws, userId)).find((o) => o.id === id);
  if (!opp) return { id, program: id, ok: false, error: 'Opportunity not found' };
  if (opp.stage === 'won' || opp.stage === 'rejected') {
    return { id, program: opp.program, ok: false, error: `Already ${opp.stage}` };
  }
  let current = opp;
  if (!current.applicationDraft) {
    const drafted = await draftApplication(id, ws, userId, agent);
    if (!drafted.ok) return { id, program: opp.program, ok: false, error: drafted.error };
    current = (await loadOpportunities(ws, userId)).find((o) => o.id === id) ?? opp;
  }
  const auto = (current.matchScore ?? 0) >= threshold;
  const stage: FundingOpportunity['stage'] = auto ? 'applied' : 'applying';
  await patchOpportunity(id, { stage }, ws, userId);
  if (auto) {
    await logActivity(`${agent.name} auto-applied to ${current.program} (${current.matchScore}% fit ≥ ${threshold}%).`, agent.id, agent.name, ws, userId);
    await remember(`Auto-applied to ${current.program} at ${current.matchScore}% fit.`, agent.id, agent.name, ws, userId);
    await addNotice({
      id: `n-fund-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: `Nadia auto-applied — ${current.program}`,
      body: `${current.matchScore}% fit cleared the ${threshold}% bar. The submission package is filed under Fundraising.`,
      severity: 'noteworthy', source: 'agent', createdAt: new Date().toISOString(), readAt: null,
    }, ws, userId).catch(() => undefined);
  } else {
    await logActivity(`${agent.name} prepared ${current.program} for review — ${current.matchScore}% fit is below the ${threshold}% auto-apply bar.`, agent.id, agent.name, ws, userId);
  }
  return { id, program: current.program, ok: true, auto, stage };
}

export interface PipelineReport {
  analyzed: AnalyzeResult[];
  drafted: DraftResult[];
  applied: ApplyResult[];
  autoApplied: string[];
  needsReview: string[];
  skipped: string[];
}

/**
 * Full autonomous pass: browse every open program website, summarize
 * requirements + expectations, draft every application, auto-apply ≥ 85%.
 * Each step persists immediately, so reruns resume instead of repeating work.
 */
export async function runFullPipeline(
  ws: string | null | undefined, userId: string | null | undefined,
  agent: { id: string; name: string } = { id: 'a-fundraising', name: 'Nadia' },
  opportunityId?: string,
): Promise<PipelineReport> {
  const all = await loadOpportunities(ws, userId);
  const targets = (opportunityId ? all.filter((o) => o.id === opportunityId) : all.filter(isPipelineOpen))
    .filter((o) => o.stage !== 'applied');
  const report: PipelineReport = { analyzed: [], drafted: [], applied: [], autoApplied: [], needsReview: [], skipped: [] };

  for (const opp of targets) {
    const analyzed = await analyzeOpportunity(opp.id, ws, userId, agent);
    report.analyzed.push(analyzed);
    if (!analyzed.ok) {
      report.needsReview.push(`${opp.program} — analysis failed: ${analyzed.error}`);
      continue;
    }
    const drafted = await draftApplication(opp.id, ws, userId, agent);
    report.drafted.push(drafted);
    if (!drafted.ok) {
      report.needsReview.push(`${opp.program} — draft failed: ${drafted.error}`);
      continue;
    }
    const applied = await applyForOpportunity(opp.id, ws, userId, agent);
    report.applied.push(applied);
    if (!applied.ok) {
      report.needsReview.push(`${opp.program} — advance failed: ${applied.error}`);
    } else if (applied.auto) {
      report.autoApplied.push(opp.program);
    } else {
      report.needsReview.push(`${opp.program} — draft ready at ${applied.stage} (${(await loadOpportunities(ws, userId)).find((o) => o.id === opp.id)?.matchScore ?? '?'}% fit, needs review)`);
    }
  }

  const done = report.analyzed.filter((a) => a.ok).length;
  await logActivity(
    `${agent.name} ran the funding pipeline: ${done}/${targets.length} analyzed, ${report.autoApplied.length} auto-applied, ${report.needsReview.length} need review.`,
    agent.id, agent.name, ws, userId,
  );
  if (done > 0) {
    await remember(
      `Funding pipeline: analyzed ${done} program(s); auto-applied [${report.autoApplied.join(', ') || 'none'}]; review [${report.needsReview.slice(0, 3).join('; ') || 'none'}].`,
      agent.id, agent.name, ws, userId,
    );
  }
  return report;
}
