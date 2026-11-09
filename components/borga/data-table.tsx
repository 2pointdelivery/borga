'use client';

import { Children, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Shared Hemrock-inspired CRUD table & toolbar kit:
 * - Segmented FilterPills with hairline border and crisp active state
 * - Interactive sortable column headers in CrudTable (auto-extracts text/numbers from cells)
 * - Automatic row count footer bar
 * - Tabular-num monospace AmountCell, refined StatusBadge, and bordered hover IconBtn
 */

// ── Toolbar ──────────────────────────────────────────────────────────────────

export function FilterPills<T extends string>(props: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border/80 bg-muted/35 p-0.5 text-xs">
      {props.options.map((f) => {
        const active = props.value === f;
        return (
          <button
            key={f}
            type="button"
            onClick={() => props.onChange(f)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium capitalize transition-all',
              active
                ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        );
      })}
    </div>
  );
}

export function TableSearch(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative ml-auto w-full sm:w-60">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="h-8 rounded-lg border-border/80 bg-background pl-8 text-xs shadow-2xs"
      />
    </div>
  );
}

export function TableToolbar(props: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{props.children}</div>;
}

// ── Helpers for automatic client-side sorting ────────────────────────────────

function extractNodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join(' ');
  if (isValidElement<{ children?: ReactNode; value?: string }>(node)) {
    if (typeof node.props.value === 'string') return node.props.value;
    return extractNodeText(node.props.children);
  }
  return '';
}

function parseSortableValue(raw: string): { num: number | null; str: string } {
  const trimmed = raw.trim();
  // Match currency / numbers like "$12,450.00", "-$300", "45.2%"
  const cleaned = trimmed.replace(/^[^\d\-+]+/, '').replace(/[,%\s].*$/, (m) => m.replace(/,/g, '').trim());
  const numCandidate = Number(trimmed.replace(/[^0-9.\-]/g, ''));
  if (/^[\s$€£¥₵₦+\-]*\d[\d,.]*%?(\s|$)/.test(trimmed) && !Number.isNaN(numCandidate)) {
    return { num: numCandidate, str: trimmed.toLowerCase() };
  }
  void cleaned;
  return { num: null, str: trimmed.toLowerCase() };
}

// ── Table ────────────────────────────────────────────────────────────────────

export function CrudTable(props: {
  headers: ReactNode[];
  children: ReactNode;
  actionCol?: boolean;
  footerRight?: ReactNode;
}) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (idx: number) => {
    if (sortCol === idx) {
      if (sortDir === 'asc') setSortDir('desc');
      else setSortCol(null);
    } else {
      setSortCol(idx);
      setSortDir('asc');
    }
  };

  const { sortedChildren, dataRowCount } = useMemo(() => {
    const arr = Children.toArray(props.children);
    // Filter out EmptyRow when counting real data rows
    const realRows = arr.filter((child) => {
      if (!isValidElement<{ colSpan?: number }>(child)) return false;
      if (child.type === EmptyRow) return false;
      return true;
    });

    if (sortCol === null || realRows.length <= 1) {
      return { sortedChildren: arr, dataRowCount: realRows.length };
    }

    const sortable = [...arr].sort((a, b) => {
      if (!isValidElement<{ children?: ReactNode }>(a) || !isValidElement<{ children?: ReactNode }>(b)) return 0;
      const cellsA = Children.toArray(a.props.children);
      const cellsB = Children.toArray(b.props.children);
      const textA = extractNodeText(cellsA[sortCol]);
      const textB = extractNodeText(cellsB[sortCol]);
      const valA = parseSortableValue(textA);
      const valB = parseSortableValue(textB);
      let cmp = 0;
      if (valA.num !== null && valB.num !== null) {
        cmp = valA.num - valB.num;
      } else {
        cmp = valA.str.localeCompare(valB.str, undefined, { numeric: true });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return { sortedChildren: sortable, dataRowCount: realRows.length };
  }, [props.children, sortCol, sortDir]);

  return (
    <Card className="overflow-hidden border-border/85 py-0 shadow-2xs">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-border/80 bg-muted/30 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <tr>
              {props.headers.map((h, i) => {
                const labelText = extractNodeText(h).trim();
                const isSortable = labelText.length > 0;
                const isActive = sortCol === i;
                return (
                  <th key={i} className="px-4 py-2.5 font-medium select-none">
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(i)}
                        className={cn(
                          'inline-flex items-center gap-1 text-left uppercase tracking-wider transition-colors hover:text-foreground',
                          isActive && 'text-foreground',
                        )}
                      >
                        <span>{h}</span>
                        {isActive ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-foreground" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-foreground" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-35 hover:opacity-75" />
                        )}
                      </button>
                    ) : (
                      h
                    )}
                  </th>
                );
              })}
              {props.actionCol !== false && <th className="w-40 px-3 py-2.5 text-right font-medium" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 text-[13px] [&_tr]:transition-colors [&_tr:hover]:bg-muted/25">
            {sortedChildren}
          </tbody>
        </table>
      </div>
      {dataRowCount > 0 && (
        <div className="flex items-center justify-between border-t border-border/70 bg-muted/15 px-4 py-2 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {dataRowCount} {dataRowCount === 1 ? 'record' : 'records'}
            {sortCol !== null ? ` · sorted by column #${sortCol + 1} (${sortDir})` : ''}
          </span>
          {props.footerRight && <div className="font-mono tabular-nums">{props.footerRight}</div>}
        </div>
      )}
    </Card>
  );
}

/** Right-aligned mono amount cell with an optional grey sub-line. */
export function AmountCell(props: { value: string; sub?: string }) {
  return (
    <td className="px-4 py-2.5 text-right font-mono text-xs font-medium tabular-nums tracking-tight text-foreground">
      {props.value}
      {props.sub && (
        <span className="mt-0.5 block font-sans text-[10px] font-normal text-muted-foreground">{props.sub}</span>
      )}
    </td>
  );
}

/** Primary cell: bold line + grey sub-line (e.g. INV-1 / ext ref). */
export function IdCell(props: { children: ReactNode; sub?: string }) {
  return (
    <td className="px-4 py-2.5 font-medium tracking-tight text-foreground">
      {props.children}
      {props.sub && (
        <span className="mt-0.5 block font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
          {props.sub}
        </span>
      )}
    </td>
  );
}

export function TextCell(props: { children: ReactNode; sub?: string; className?: string }) {
  return (
    <td className={cn('px-4 py-2.5 text-muted-foreground', props.className)}>
      {props.children}
      {props.sub && <span className="mt-0.5 block text-[10px] text-muted-foreground/80">{props.sub}</span>}
    </td>
  );
}

export function StatusBadge(props: { className?: string; children: ReactNode }) {
  return (
    <td className="px-4 py-2.5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset',
          props.className,
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        {props.children}
      </span>
    </td>
  );
}

export function EmptyRow(props: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={props.colSpan} className="px-4 py-10 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/80 bg-muted/30 text-muted-foreground">
            <Inbox className="h-4 w-4" />
          </span>
          <span className="leading-relaxed">{props.children}</span>
        </div>
      </td>
    </tr>
  );
}

// ── Icon actions ─────────────────────────────────────────────────────────────

type Tone = 'primary' | 'green' | 'red' | 'amber';

const TONE: Record<Tone, string> = {
  primary: 'hover:border-border hover:bg-accent hover:text-foreground',
  green: 'hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-600',
  red: 'hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive',
  amber: 'hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-600',
};

export function IconBtn(props: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-all disabled:opacity-30',
        TONE[props.tone ?? 'primary'],
      )}
    >
      {props.children}
    </button>
  );
}

export function RowActions(props: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-0.5 pr-1">{props.children}</div>;
}

export type { ReactElement };
