'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { ConfirmDialog } from './ConfirmDialog';

const LABELS: Record<string, string> = {
  finance: 'the ledger', journals: 'the journal', bankTxns: 'bank transactions', bankAccounts: 'bank accounts', taxProfiles: 'tax profiles',
  knowledge: 'the knowledge base', kbquestions: 'knowledge questions', workspaces: 'the company list', scheduledTasks: 'scheduled tasks',
  agentRuns: 'agent runs', recurringInvoices: 'recurring invoices', recurringBills: 'recurring bills', timeEntries: 'time entries',
  revenueTracks: 'revenue lines', reconciliationRules: 'reconciliation rules', mcpServers: 'MCP servers', filings: 'tax filings', fixedAssets: 'the fixed asset register', messagingChannels: 'messaging channels', payrollRuns: 'payroll runs',
};

/** "bankTxns" -> "bank transactions"; unknown names fall back to their words ("secureChats" -> "secure chats"). */
const label = (entity: string) => LABELS[entity] ?? entity.replace(/([A-Z])/g, ' $1').toLowerCase();

/**
 * Shown when a save was refused because the data changed elsewhere (another tab or device, or an agent). The refused edit is
 * NOT written, so newer data is never overwritten; until the latest copy is loaded, further edits to that data stay on this device.
 * The user can load the server copy (discarding their edit) or keep their own (overwriting the server copy).
 */
export function SaveConflictBanner() {
  const { saveConflicts, loadLatest, forceSaveEntity } = useBorga();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmKeep, setConfirmKeep] = useState<string | null>(null);
  if (!saveConflicts.length && !confirmKeep) return null;

  const doKeepMine = async (entity: string) => {
    setConfirmKeep(null);
    setBusy(`keep-${entity}`);
    const ok = await forceSaveEntity(entity as Parameters<typeof forceSaveEntity>[0]);
    if (!ok) toast({ title: `Could not save ${label(entity)}`, description: 'Check your connection and try again.', variant: 'error' });
    setBusy(null);
  };

  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b border-amber-500/40 bg-amber-100 px-4 py-2.5 text-sm text-amber-950 shadow dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="max-w-3xl">
        <strong>Your last change to {saveConflicts.map(label).join(', ')} was not saved.</strong> It was changed in another tab, on another device or by an agent, and saving yours would have overwritten that. Load the latest and make the change again — or keep your own copy.
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {saveConflicts.map((e) => (
          <Button
            key={e}
            size="sm"
            variant="outline"
            className="gap-1.5 border-amber-600/50 bg-white/70 text-amber-950 hover:bg-white dark:bg-amber-900 dark:text-amber-100"
            disabled={busy !== null}
            onClick={() => setConfirmKeep(e)}
          >
            {busy === `keep-${e}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Keep my {label(e)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-amber-600/50 bg-white/70 text-amber-950 hover:bg-white dark:bg-amber-900 dark:text-amber-100"
          disabled={busy !== null}
          onClick={async () => {
            setBusy('latest');
            await loadLatest();
            setBusy(null);
          }}
        >
          {busy === 'latest' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Load latest
        </Button>
      </span>

      <ConfirmDialog
        open={!!confirmKeep}
        onOpenChange={(o) => { if (!o) setConfirmKeep(null); }}
        title={`Overwrite the saved copy of ${confirmKeep ? label(confirmKeep) : ''} with your edits?`}
        description="The other tab's (or agent's) newer changes will be lost."
        confirmLabel="Keep my copy"
        onConfirm={() => { if (confirmKeep) void doKeepMine(confirmKeep); }}
      />
    </div>
  );
}
