/**
 * Goal → structured fallback plan. Pure (no I/O, no server-only) so the
 * Planner tab can preview a plan in the browser and the runner can execute
 * the same steps server-side — one plan shape everywhere.
 */

export interface PlanStep {
  thought: string;
  toolName: string;
  params: Record<string, unknown>;
}

// Generate a goal-driven fallback plan when no LLM is configured.
// Still executes REAL tool calls against real data.
export function planFromGoal(goal: string): PlanStep[] {
  const g = goal.toLowerCase();
  const steps: PlanStep[] = [];

  if (/kpi|brief|review|metric|flag|below/.test(g)) {
    steps.push({ thought: 'Querying current KPI state to find below-target metrics.', toolName: 'query_state', params: { entity: 'kpis' } });
    steps.push({ thought: 'Logging morning brief activity to keep the team informed.', toolName: 'log_activity', params: { message: 'Agent performed KPI review — checked all departments for below-target metrics.', kind: 'sync' } });
    steps.push({ thought: 'Storing key KPI findings as an observation for future reference.', toolName: 'store_memory', params: { content: `KPI review completed. Logged observations for ${new Date().toDateString()}.`, kind: 'observation', tags: ['kpi', 'daily-review'], confidence: 85 } });
  } else if (/lead|pipeline|follow.?up|qualify|stage/.test(g)) {
    steps.push({ thought: 'Querying current leads to assess pipeline health.', toolName: 'query_state', params: { entity: 'leads' } });
    steps.push({ thought: 'Creating a follow-up task for the highest-priority leads.', toolName: 'create_task', params: { title: 'Follow up on P0 leads in pipeline', detail: 'Scheduled follow-up: review open proposals and send updated contact.', priority: 'P0', bucket: 'today', assignee: 'Atlas', tags: ['sales', 'pipeline'], due: 'Today 5pm' } });
    steps.push({ thought: 'Logging pipeline review activity.', toolName: 'log_activity', params: { message: 'Lead pipeline review completed — follow-up tasks created for P0 leads.', kind: 'task' } });
  } else if (/grant|fund|opport|sbir|pitch/.test(g)) {
    steps.push({ thought: 'Querying existing funding opportunities to assess current pipeline.', toolName: 'query_state', params: { entity: 'fundraising' } });
    steps.push({ thought: 'Browsing every open program site to summarize requirements, expectations and fit.', toolName: 'analyze_funding', params: { analyzeAll: true } });
    steps.push({ thought: 'Running the full funding pipeline: drafts for all, auto-apply at 85%+ fit.', toolName: 'run_funding_pipeline', params: {} });
    steps.push({ thought: 'Logging the pipeline outcome to the activity feed.', toolName: 'log_activity', params: { message: 'Funding pipeline run completed — sites analyzed, drafts ready, high-fit applications advanced.', kind: 'task' } });
    steps.push({ thought: 'Storing observation about funding scan.', toolName: 'store_memory', params: { content: 'Ran autonomous funding pipeline: browsed program sites, summarized requirements, drafted applications.', kind: 'observation', tags: ['fundraising', 'grants'], confidence: 80 } });
  } else if (/content|social|post|linkedin|twitter/.test(g)) {
    steps.push({ thought: 'Querying recent social posts to assess engagement.', toolName: 'query_state', params: { entity: 'tasks', filter: 'marketing' } });
    steps.push({ thought: 'Creating content calendar task.', toolName: 'create_task', params: { title: 'Draft Q3 social content calendar', detail: 'Create 3 LinkedIn posts and 2 Twitter threads based on the latest company insights.', priority: 'P1', bucket: 'week', assignee: 'Nova', tags: ['marketing', 'content'], due: 'This week' } });
    steps.push({ thought: 'Logging content workflow initiation.', toolName: 'log_activity', params: { message: 'Content calendar workflow initiated — drafting 5 posts for multi-channel distribution.', kind: 'task' } });
  } else if (/research|market|competitor|industry trend|benchmark|landscape/.test(g)) {
    steps.push({ thought: `Researching the web for: ${goal.slice(0, 100)}`, toolName: 'web_research', params: { question: goal.slice(0, 300) } });
    steps.push({ thought: 'Storing the research findings for future reference.', toolName: 'store_memory', params: { content: `Web research completed for: "${goal.slice(0, 200)}"`, kind: 'fact', tags: ['research', 'web'], confidence: 70 } });
    steps.push({ thought: 'Logging this research run.', toolName: 'log_activity', params: { message: `Completed web research on: "${goal.slice(0, 100)}"`, kind: 'learn' } });
  } else if (/ops|booking|dispatch|driver|route|deliver/.test(g)) {
    steps.push({ thought: 'Checking current ops state for pending bookings.', toolName: 'query_state', params: { entity: 'ops' } });
    steps.push({ thought: 'Creating dispatch task for pending bookings.', toolName: 'create_task', params: { title: 'Assign drivers to pending bookings', detail: 'Review pending bookings without driver assignments and dispatch optimally.', priority: 'P0', bucket: 'today', assignee: 'Borga', tags: ['ops', 'dispatch'], due: 'Today' } });
    steps.push({ thought: 'Logging ops review.', toolName: 'log_activity', params: { message: 'Ops dispatch review completed — pending booking tasks created.', kind: 'sync' } });
  } else {
    // Generic goal — query state, create task, log, store memory
    steps.push({ thought: `Checking current state to understand the context for: ${goal.slice(0, 100)}`, toolName: 'query_state', params: { entity: 'tasks' } });
    steps.push({ thought: 'Creating an action task for this goal.', toolName: 'create_task', params: { title: goal.slice(0, 100), detail: 'Task generated by autonomous agent run.', priority: 'P1', bucket: 'week', assignee: 'Borga', tags: ['agent-run'], due: 'This week' } });
    steps.push({ thought: 'Logging this goal to the activity feed.', toolName: 'log_activity', params: { message: `Agent initiated autonomous run for: "${goal.slice(0, 100)}"`, kind: 'task' } });
    steps.push({ thought: 'Storing this context for future reference.', toolName: 'store_memory', params: { content: `Ran autonomous goal: "${goal.slice(0, 200)}"`, kind: 'context', tags: ['agent-run'], confidence: 75 } });
  }

  return steps;
}
