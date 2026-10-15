'use client';

import { useMemo } from 'react';
import { FileText, FolderKanban, ReceiptText, User, Users, MessageSquare } from 'lucide-react';
import { useBorga } from '@/lib/borga/store';
import { collectTimeline, type TimelineTarget } from '@/lib/borga/timeline';
import { cn } from '@/lib/utils';

const ICON = {
  lead: User,
  customer: Users,
  quote: FileText,
  invoice: ReceiptText,
  project: FolderKanban,
  note: MessageSquare,
} as const;

/** Everything one lead, account, quote or invoice touched — documents newest-first, then notes. */
export function RecordTimeline({ target }: { target: TimelineTarget }) {
  const leads = useBorga((s) => s.leads);
  const customers = useBorga((s) => s.customers);
  const quotes = useBorga((s) => s.quotes);
  const invoices = useBorga((s) => s.invoices);
  const projects = useBorga((s) => s.projects);
  const activity = useBorga((s) => s.activity);
  const entries = useMemo(
    () => collectTimeline({ leads, customers, quotes, invoices, projects, activity }, target),
    [leads, customers, quotes, invoices, projects, activity, target],
  );
  if (!entries.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">Timeline</p>
      <ol className="space-y-2">
        {entries.map((e, i) => {
          const Icon = ICON[e.kind];
          return (
            <li key={`${e.kind}-${e.title}-${i}`} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[e.sub, e.at ? new Date(e.at).toLocaleDateString() : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              {e.link && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('borga:nav', { detail: e.link!.tab ? { page: e.link!.page, tab: e.link!.tab } : e.link!.page }))}
                  className={cn('shrink-0 text-xs text-primary hover:underline')}
                >
                  Open
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
