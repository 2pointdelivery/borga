import type { Agent } from './data';

/**
 * What an agent is doing right now. Pure so it is unit-tested.
 *
 * An agent is active only while it has a run going or waiting; with nothing assigned it is idle. (An agent's saved status used to
 * say "active" for nearly everyone whatever they were doing, which made an idle company look busy.) Offline stays offline: that is a
 * choice someone made, not a measurement.
 */
export type Busy = 'running' | 'queued';

export function agentStatusNow(agent: Pick<Agent, 'id' | 'status'>, busy: Record<string, Busy | undefined>): Agent['status'] {
  if (agent.status === 'offline') return 'offline';
  return busy[agent.id] ? 'active' : 'idle';
}

/** Who has work, from the run queue's jobs. A run in progress outranks one still waiting. */
export function busyFromJobs(jobs: Array<{ agentId: string; status: string }>): Record<string, Busy> {
  const out: Record<string, Busy> = {};
  for (const j of jobs) {
    if (j.status === 'running') out[j.agentId] = 'running';
    else if (j.status === 'queued' && out[j.agentId] !== 'running') out[j.agentId] = 'queued';
  }
  return out;
}
