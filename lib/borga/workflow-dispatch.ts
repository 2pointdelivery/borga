/**
 * Workflow → AI worker dispatch. When a company has no remote Company Engine,
 * "run workflow" puts real agents to work through the run queue: this pure
 * module picks the right specialist and writes the goal the agent will execute.
 * Unit-tested; the orchestrate route only relays its decision.
 */

export interface WorkflowDispatch {
  agentId: string;
  agentName: string;
  /** The concrete instruction the AI worker executes (bounded length). */
  goal: string;
}

const GOAL_LIMIT = 2000;

const RULES: Array<{ re: RegExp; agentId: string; agentName: string; brief: string }> = [
  {
    re: /lead|outreach|sales|prospect|pipeline|deal/i,
    agentId: 'a-sales',
    agentName: 'Atlas',
    brief: 'read the open pipeline with query_state (entity "leads"), pick the neglected or highest-value deals, and create_task with the concrete next step for each (a personal, specific follow-up draft in the task detail).',
  },
  {
    re: /content|social|post|linkedin|twitter|blog|seo|marketing/i,
    agentId: 'a-marketing',
    agentName: 'Nova',
    brief: 'read the current posts and KPIs with query_state (entities "posts" and "kpis"), then create_task for each piece this workflow should produce (title states the platform and angle; detail carries the working outline).',
  },
  {
    re: /ad[s]?|campaign|paid.?media|budget/i,
    agentId: 'a-paidmedia',
    agentName: 'Paige',
    brief: 'read the ad campaigns with query_state (entity "ads"), flag anything overspending or underperforming, and create_task with the specific fix (audience, creative or budget change) for each.',
  },
  {
    re: /fundrais|grant|investor|pitch|capital/i,
    agentId: 'a-fundraising',
    agentName: 'Nadia',
    brief: 'read the fundraising board with query_state (entity "fundraising"), advance the opportunities that need action this week, and create_task with the concrete step (application section, investor update, deadline prep) for each.',
  },
  {
    re: /ops|dispatch|driver|route|delivery|inventory|stock|warehouse/i,
    agentId: 'a-pm',
    agentName: 'Rigby',
    brief: 'read operations state with query_state (entities "tasks" and "inventory"), find the blocked or unowned work, and create_task with an owner and a due date for each item this workflow covers.',
  },
  {
    re: /sync|crm|data|import|export|integration|pipeline.?run/i,
    agentId: 'a-integrations',
    agentName: 'Iris',
    brief: 'read the connected apps and recent sync state with query_state (entities "mcpServers" and "notices"), identify the stale or failing data flows, and create_task with the exact repair for each.',
  },
  {
    re: /finance|invoice|payment|billing|cash|expense|tax|payroll/i,
    agentId: 'a-finance',
    agentName: 'Sage',
    brief: 'read the books with query_state (entities "finance" and "kpis"), find overdue receivables, unbilled work or budget overruns, and create_task with the specific follow-up for each (no amounts may be changed; money moves need a human approval).',
  },
  {
    re: /support|ticket|customer|churn|success/i,
    agentId: 'a-support',
    agentName: 'Spectra',
    brief: 'read open tickets and customers with query_state (entities "notices" and "customers"), find unanswered or at-risk accounts, and create_task with the concrete save or reply for each.',
  },
  {
    re: /brief|fleet|morning|daily|standup|overview|report/i,
    agentId: 'a-borga',
    agentName: 'Borga',
    brief: 'read the whole company with query_state (entities "kpis", "tasks", "finance" and "notices"), write a short briefing with log_activity, and create_task for each action that needs an owner today.',
  },
];

const DEFAULT_RULE = {
  agentId: 'a-borga',
  agentName: 'Borga',
  brief: 'decide what this workflow means for this company by reading state with query_state, then create_task for each concrete piece of work it should produce and log_activity with what you set up.',
};

const SAFETY = 'Do not send email, message anyone, or spend money — outward actions need a human approval. Store what you learned with store_memory. Finish with a SUMMARY of exactly what you did.';

/** Pick the AI worker and goal for a named workflow. */
export function workflowDispatch(workflowName: string): WorkflowDispatch {
  const name = String(workflowName ?? '').trim().slice(0, 100) || 'unnamed workflow';
  const rule = RULES.find((r) => r.re.test(name)) ?? DEFAULT_RULE;
  const goal = `Run the "${name}" workflow. ${rule.brief} ${SAFETY}`;
  return { agentId: rule.agentId, agentName: rule.agentName, goal: goal.slice(0, GOAL_LIMIT) };
}
