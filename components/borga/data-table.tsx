'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Shared invoice-style list kit: status filter pills + search toolbar, a card
 * table with uppercase headers and mono right-aligned amounts, icon-only row
 * actions, and a pill status badge. Used by Quotes, Payroll, Cap table,
 * Purchase orders and Comps so every list feels like Invoicing.
 */

// ── Toolbar ──────────────────────────────────────────────────────────────────

export function FilterPills<T extends string>(props: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg bg-muted p-1 text-xs">
      {props.options.map((f) => (
        <button
          key={f}
          onClick={() => props.onChange(f)}
          className={cn('rounded-md px-4 py-1.5 font-medium capitalize', props.value === f ? 'bg-background shadow-sm' : 'text-muted-foreground')}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

export function TableSearch(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative ml-auto w-full sm:w-56">
      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
      <Input value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.placeholder} className="pl-8 text-xs" />
    </div>
  );
}

export function TableToolbar(props: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{props.children}</div>;
}

// ── Table ────────────────────────────────────────────────────────────────────

export function CrudTable(props: { headers: ReactNode[]; children: ReactNode; actionCol?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {props.headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium">{h}</th>
            ))}
            {props.actionCol !== false && <th className="w-44 px-2 py-2.5" />}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </Card>
  );
}

/** Right-aligned mono amount cell with an optional grey sub-line. */
export function AmountCell(props: { value: string; sub?: string }) {
  return (
    <td className="px-4 py-2.5 text-right font-mono text-xs">
      {props.value}
      {props.sub && <span className="block text-[10px] font-normal text-muted-foreground">{props.sub}</span>}
    </td>
  );
}

/** Primary cell: bold line + grey sub-line (e.g. INV-1 / ext ref). */
export function IdCell(props: { children: ReactNode; sub?: string }) {
  return (
    <td className="px-4 py-2.5 font-medium">
      {props.children}
      {props.sub && <span className="block text-[10px] font-normal text-muted-foreground">{props.sub}</span>}
    </td>
  );
}

export function TextCell(props: { children: ReactNode; sub?: string; className?: string }) {
  return (
    <td className={cn('px-4 py-2.5 text-muted-foreground', props.className)}>
      {props.children}
      {props.sub && <span className="block text-[10px]">{props.sub}</span>}
    </td>
  );
}

export function StatusBadge(props: { className?: string; children: ReactNode }) {
  return (
    <td className="px-4 py-2.5">
      <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', props.className)}>{props.children}</span>
    </td>
  );
}

export function EmptyRow(props: { colSpan: number; children: ReactNode }) {
  return (
    <tr><td colSpan={props.colSpan} className="px-4 py-8 text-center text-xs text-muted-foreground">{props.children}</td></tr>
  );
}

// ── Icon actions ─────────────────────────────────────────────────────────────

type Tone = 'primary' | 'green' | 'red' | 'amber';

const TONE: Record<Tone, string> = {
  primary: 'hover:bg-primary/10 hover:text-primary',
  green: 'hover:bg-emerald-500/10 hover:text-emerald-600',
  red: 'hover:bg-destructive/10 hover:text-destructive',
  amber: 'hover:bg-amber-500/10 hover:text-amber-600',
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
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground disabled:opacity-30',
        TONE[props.tone ?? 'primary'],
      )}
    >
      {props.children}
    </button>
  );
}

export function RowActions(props: { children: ReactNode }) {
  return <div className="flex justify-end gap-0.5">{props.children}</div>;
}
