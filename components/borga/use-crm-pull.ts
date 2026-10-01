'use client';

import { useCallback } from 'react';
import { useBorga } from '@/lib/borga/store';
import type { CrmCustomer, CrmLead, MergeSummary } from '@/lib/borga/crm-core';

interface PullResponse {
  ok: boolean;
  error?: string;
  customers?: { records: CrmCustomer[]; skipped: number; truncated: boolean };
  leads?: { records: CrmLead[]; skipped: number; truncated: boolean };
  errors?: Record<string, string>;
}

export interface PullOutcome {
  ok: boolean;
  customers?: MergeSummary;
  leads?: MergeSummary;
  skipped: number;
  truncated: boolean;
  error?: string;
}

/** Pulls customers and deals from the Company Engine and merges them into Borga. Records the result in settings. */
export function useCrmPull() {
  const activeWorkspaceId = useBorga((s) => s.activeWorkspaceId);
  const importCrmRecords = useBorga((s) => s.importCrmRecords);
  const setSettings = useBorga((s) => s.setSettings);
  const log = useBorga((s) => s.log);

  return useCallback(async (): Promise<PullOutcome> => {
    const at = new Date().toISOString();
    try {
      const res = await fetch('/api/borga/engine?ws=' + encodeURIComponent(activeWorkspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'pull', resources: ['customers', 'leads'] }),
      });
      const j = (await res.json()) as PullResponse;
      const errs = Object.entries(j.errors ?? {}).map(([k, v]) => k + ': ' + v);
      if (!j.customers && !j.leads) {
        const error = errs.join('; ') || j.error || 'Pull failed';
        setSettings({ crmLastPull: { at, error } });
        return { ok: false, skipped: 0, truncated: false, error };
      }
      const merged = importCrmRecords(j.customers?.records ?? null, j.leads?.records ?? null);
      const skipped = (j.customers?.skipped ?? 0) + (j.leads?.skipped ?? 0);
      const error = errs.length ? errs.join('; ') : undefined;
      setSettings({ crmLastPull: { at, customers: merged.customers, leads: merged.leads, skipped, error } });
      const changed = (merged.customers?.added ?? 0) + (merged.customers?.updated ?? 0) + (merged.leads?.added ?? 0) + (merged.leads?.updated ?? 0);
      if (changed) {
        log({
          agentId: 'a-integrations', agentName: 'Iris', actor: 'system', kind: 'sync',
          message: 'Company Engine pull: customers +' + (merged.customers?.added ?? 0) + ' / ~' + (merged.customers?.updated ?? 0) + ', deals +' + (merged.leads?.added ?? 0) + ' / ~' + (merged.leads?.updated ?? 0) + '.',
        });
      }
      return { ok: !error, customers: merged.customers, leads: merged.leads, skipped, truncated: !!(j.customers?.truncated || j.leads?.truncated), error };
    } catch (e) {
      const error = (e as Error).message;
      setSettings({ crmLastPull: { at, error } });
      return { ok: false, skipped: 0, truncated: false, error };
    }
  }, [activeWorkspaceId, importCrmRecords, setSettings, log]);
}
