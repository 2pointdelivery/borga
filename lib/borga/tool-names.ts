/**
 * Canonical tool-name list for client surfaces (the Planner's step editor).
 * tools.ts is `server-only`, so the browser cannot read TOOL_DEFS; this list
 * is the public mirror. tools.ts guards at module load that every registered
 * tool appears here — adding a tool without mirroring it logs loudly.
 */
export const TOOL_NAMES: string[] = [
  'create_task',
  'update_task',
  'update_lead',
  'store_memory',
  'search_knowledge',
  'browse_web',
  'web_search',
  'web_crawl',
  'web_research',
  'analyze_funding',
  'draft_application',
  'run_funding_pipeline',
  'list_tickets',
  'find_similar_tickets',
  'create_ticket',
  'update_ticket',
  'draft_ticket_reply',
  'run_workflow',
  'query_state',
  'schedule_check',
  'log_activity',
  'create_approval',
  'handoff',
  'list_composio_actions',
  'composio_action',
  'mcp_call',
  'delegate',
];
