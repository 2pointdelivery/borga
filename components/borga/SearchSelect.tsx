'use client';

import { useId, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { matchesSearch } from '@/lib/borga/geo';
import { cn } from '@/lib/utils';

export interface SearchOption {
  value: string;
  label: string;
  /** Small grey text on the right (a symbol, a code, a country). Also searched. */
  detail?: string;
  /** Options with the same group are listed under one heading. */
  group?: string;
}

interface Props {
  options: SearchOption[];
  value: string;
  onChange: (value: string, option?: SearchOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Let the user keep a value that is not in the list (a small town, an unusual state). */
  allowCustom?: boolean;
  /** Show a clear button when a value is set. */
  clearable?: boolean;
  /** Render at most this many matches (the rest are reached by typing), so a 17,000-row list stays fast. */
  limit?: number;
  emptyText?: string;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

/**
 * A dropdown with a search box: type to filter (accent- and case-insensitive, every word must match), arrow keys and Enter to pick.
 * Used for country, state, city and currency. A saved value that is not in the list is shown as it is, never silently changed.
 */
export function SearchSelect({
  options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…', disabled, loading, allowCustom, clearable = true,
  limit = 100, emptyText = 'No match.', id, className, ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();

  const q = query.trim();
  const { shown, total } = useMemo(() => {
    const hits = q ? options.filter((o) => matchesSearch(`${o.label} ${o.detail ?? ''}`, q)) : options;
    return { shown: hits.slice(0, limit), total: hits.length };
  }, [options, q, limit]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchOption[]>();
    for (const o of shown) {
      const g = o.group ?? '';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return [...map.entries()];
  }, [shown]);

  const selected = options.find((o) => o.value === value);
  const exact = q !== '' && options.some((o) => o.label.toLowerCase() === q.toLowerCase() || o.value.toLowerCase() === q.toLowerCase());

  const pick = (v: string, o?: SearchOption) => {
    onChange(v, o);
    setOpen(false);
    setQuery(''); // closing by choosing skips onOpenChange, so clear the search here or the next open starts filtered
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-label={rest['aria-label']}
          disabled={disabled}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{selected ? selected.label : value || placeholder}</span>
          <span className="flex shrink-0 items-center gap-1">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-60" />}
            {clearable && value && !disabled && (
              <span
                role="button"
                aria-label="Clear"
                tabIndex={-1}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(''); }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[16rem]">
        <Command loop shouldFilter={false}>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={options.length ? `${searchPlaceholder} (${options.length.toLocaleString()})` : searchPlaceholder}
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List id={listId} className="max-h-72 overflow-y-auto p-1">
            {loading && !options.length ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
            ) : (
              !shown.length && !(allowCustom && q) && <div className="px-3 py-4 text-center text-xs text-muted-foreground">{allowCustom ? 'Nothing in the list yet. Type to enter your own.' : emptyText}</div>
            )}
            {groups.map(([group, items]) => (
              <Command.Group
                key={group || '_'}
                heading={group || undefined}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {items.map((o) => (
                  <Command.Item
                    key={o.value}
                    value={o.value}
                    onSelect={() => pick(o.value, o)}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
                  >
                    <span className="truncate">{o.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {o.detail && <span className="text-[11px] text-muted-foreground">{o.detail}</span>}
                      {o.value === value && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
            {total > shown.length && (
              <div className="px-3 py-2 text-center text-[11px] text-muted-foreground">Showing {shown.length} of {total.toLocaleString()}. Type to narrow the list.</div>
            )}
            {allowCustom && q !== '' && !exact && (
              <Command.Item
                forceMount
                value={`__custom ${q}`}
                onSelect={() => pick(q)}
                className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-sm data-[selected=true]:bg-accent"
              >
                Use <span className="truncate font-medium">&ldquo;{q}&rdquo;</span>
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
