'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBorga } from '@/lib/borga/store';

const LABELS: Record<string, string> = {
  finance: 'the ledger', journals: 'the journal', bankTxns: 'bank transactions', bankAccounts: 'bank accounts', taxProfiles: 'tax profiles',
  knowledge: 'the knowledge base', kbquestions: 'knowledge questions', workspaces: 'the company list', scheduledTasks: 'scheduled tasks',
  agentRuns: 'agent runs', recurringInvoices: 'recurring invoices', recurringBills: 'recurring bills', timeEntries: 'time entries',
  revenueTracks: 'revenue lines', reconciliationRules: 'reconciliation rules', mcpServers: 'MCP servers', messagingChannels: 'messaging channels',
};

/** "bankTxns" -> "bank transactions"; unknown names fall back to their words ("secureChats" -> "secure chats"). */
const label = (entity: string) => LABELS[entity] ?? entity.replace(/([A-Z])/g, ' $1').toLowerCase();

/**
 * Shown when a save was refused because the data changed elsewhere (another tab or device, or an agent). The refused edit is
 * NOT written, so newer data is never overwritten; until the latest copy is loaded, further edits to that data stay on this device.
 */
export function SaveConflictBanner() {
  const { saveConflicts, loadLatest } = useBorga();
  const [busy, setBusy] = useState(false);
  if (!saveConflicts.length) return null;

  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-3 border-b border-amber-500/40 bg-amber-100 px-4 py-2.5 text-sm text-amber-950 shadow dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="max-w-3xl">
        <strong>Your last change to {saveConflicts.map(label).join(', ')} was not saved.</strong> It was changed in another tab, on another device or by an agent, and saving yours would have overwritten that. Load the latest and make the change again.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-amber-600/50 bg-white/70 text-amber-950 hover:bg-white dark:bg-amber-900 dark:text-amber-100"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await loadLatest();
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Load latest
      </Button>
    </div>
  );
}
