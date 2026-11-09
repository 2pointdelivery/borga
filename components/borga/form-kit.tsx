'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * Shared CRUD dialog kit — every create/edit dialog in the app follows a
 * clean, structured Hemrock-inspired layout: hairline header separator,
 * crisp field labels, tabular-num money inputs, and separated footer actions.
 */

// ── Dialog shell ─────────────────────────────────────────────────────────────

export function FormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Left side of the footer (e.g. an Active toggle). */
  footerLeft?: ReactNode;
  submitLabel: string;
  /** Prefix before the submit label — defaults to ＋; pass "" for Close/Print style actions. */
  submitPrefix?: string;
  /** Hide the Cancel button (for view-only dialogs with a single Close action). */
  hideCancel?: boolean;
  onSubmit: () => void;
  submitDisabled?: boolean;
  wide?: boolean;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className={props.wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}>
        <DialogHeader className="border-b border-border/70 pb-3">
          <DialogTitle className="text-base font-semibold tracking-tight">{props.title}</DialogTitle>
          {props.description && <DialogDescription className="text-xs">{props.description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3.5 py-0.5">{props.children}</div>
        <DialogFooter className="items-center border-t border-border/70 pt-3.5">
          <div className="mr-auto">{props.footerLeft}</div>
          {!props.hideCancel && (
            <Button variant="ghost" size="sm" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={props.onSubmit} disabled={props.submitDisabled}>
            {props.submitPrefix ?? '＋ '}
            {props.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Labeled field ────────────────────────────────────────────────────────────

export function Field(props: { label: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={props.className}>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-[11px] font-medium tracking-tight text-muted-foreground">{props.label}</Label>
        {props.action}
      </div>
      {props.children}
      {props.hint && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/85">{props.hint}</p>}
    </div>
  );
}

/** Responsive grid for side-by-side fields (2–4 columns, stacks on mobile). */
export function FieldGrid(props: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const cols = props.cols ?? 2;
  return (
    <div
      className={cn(
        'grid gap-3',
        cols === 2 && 'grid-cols-2',
        cols === 3 && 'grid-cols-2 sm:grid-cols-3',
        cols === 4 && 'grid-cols-2 sm:grid-cols-4',
      )}
    >
      {props.children}
    </div>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export function TextField(props: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; type?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <Input
        type={props.type ?? 'text'}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

export function MoneyField(props: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; symbol?: string; type?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <div className="relative">
        {props.symbol && (
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
            {props.symbol}
          </span>
        )}
        <Input
          type={props.type ?? 'text'}
          inputMode="decimal"
          className={cn('font-mono tabular-nums', props.symbol && 'pl-7')}
          placeholder={props.placeholder ?? '0.00'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      </div>
    </Field>
  );
}

export function NotesField(props: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; action?: ReactNode }) {
  return (
    <Field label={props.label ?? 'Notes'} action={props.action}>
      <Textarea rows={3} placeholder={props.placeholder} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </Field>
  );
}

/** Native select styled like an input — dependency-free and keyboard accessible. */
export function SelectField(props: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>; hint?: string; placeholder?: string;
}) {
  return (
    <Field label={props.label} hint={props.hint}>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-2xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">{props.placeholder ?? 'Select…'}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Switch + label row for the dialog footer (e.g. “Active — sellable at the POS”). */
export function ToggleRow(props: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
      <Switch checked={props.checked} onCheckedChange={props.onChange} />
      <span>{props.children}</span>
    </label>
  );
}

/** Two-option segmented toggle (Product | Service style) with an optional icon per side. */
export function TypeToggle<T extends string>(props: {
  value: T; onChange: (v: T) => void;
  left: { value: T; label: string; icon?: ReactNode };
  right: { value: T; label: string; icon?: ReactNode };
}) {
  const btn = (o: { value: T; label: string; icon?: ReactNode }) => (
    <button
      key={o.value}
      type="button"
      onClick={() => props.onChange(o.value)}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
        props.value === o.value
          ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {o.icon}
      {o.label}
    </button>
  );
  return <div className="flex gap-1 rounded-lg border border-border/80 bg-muted/35 p-0.5">{[btn(props.left), btn(props.right)]}</div>;
}
