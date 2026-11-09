'use client';

import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useBorga } from '@/lib/borga/store';

interface AuditRow {
  at: string;
  entity: string;
  version: number | null;
  by: string;
}

/** Workspace save audit: newest saves first, so "did my edit land?" is one glance away. */
export function AuditCard() {
  const { activeWorkspaceId: ws } = useBorga();
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/borga/audit?ws=${encodeURIComponent(ws)}`, { headers: { 'X-Borga-Client': 'borga-dashboard' } });
      const j = (await r.json()) as { ok: boolean; audit?: AuditRow[] };
      if (j.ok) setRows(j.audit ?? []);
    } catch {
      /* card shows the empty state */
    }
  }, [ws]);

  useEffect(() => {
    setRows(null);
  }, [ws]);

  return (
    <Card className="p-5">
      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && rows === null) void load(); }}>
        <summary className="cursor-pointer">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-primary" /> Data changes
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">Every save to this company — what, when, at which version. Useful after a merge notice or when two people edit together.</span>
        </summary>
        <div className="mt-3">
          {rows === null && <p className="text-xs text-muted-foreground">Open to load…</p>}
          {rows !== null && rows.length === 0 && <p className="text-xs text-muted-foreground">No saves recorded yet for this company.</p>}
          {rows !== null && rows.length > 0 && (
            <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-xs">
              {rows.map((r, i) => (
                <li key={`${r.at}-${r.entity}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate font-medium">{r.entity}</span>
                  <span className="shrink-0 text-muted-foreground">{new Date(r.at).toLocaleString()}{r.version !== null ? ` · v${r.version}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </Card>
  );
}
