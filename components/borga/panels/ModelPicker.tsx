'use client';

import { useId, useMemo, useState } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { LlmModelInfo } from '@/lib/borga/data';
import { matchesModelSearch } from '@/lib/borga/model-catalog';

export interface PickerSection {
  key: string;
  label: string;
  models: LlmModelInfo[];
}

const TIER_LABEL: Record<LlmModelInfo['tier'], string> = { free: 'Free', credits: 'Free credits', paid: 'Paid' };
const TIER_STYLE: Record<LlmModelInfo['tier'], string> = {
  free: 'bg-emerald-500/10 text-emerald-600',
  credits: 'bg-amber-500/10 text-amber-600',
  paid: 'bg-muted text-muted-foreground',
};

/** Splits one provider's models into Free / Free credits / Paid sections (empty ones are dropped). */
export function tierSections(models: LlmModelInfo[]): PickerSection[] {
  return (['free', 'credits', 'paid'] as const)
    .map((t) => ({ key: t, label: TIER_LABEL[t], models: models.filter((m) => m.tier === t) }))
    .filter((s) => s.models.length > 0);
}

interface Props {
  sections: PickerSection[];
  /** The selected model id. It does not have to be in the list: it is then shown as a custom id instead of silently changing. */
  value: string;
  onChange: (id: string) => void;
  /** An extra choice shown first, for example "Workspace default" (its value is usually an empty string). */
  leading?: { value: string; label: string };
  allowCustom?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * Searchable, grouped model dropdown. Always usable (you can browse models before adding a key), keyboard friendly, and honest
 * about its value: a model id that is not in the list is shown as typed, so the screen never disagrees with what is saved.
 */
export function ModelPicker({ sections, value, onChange, leading, allowCustom = true, placeholder = 'Choose a model', className, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const listId = useId();

  const all = useMemo(() => sections.flatMap((s) => s.models), [sections]);
  const selected = all.find((m) => m.id === value);
  const total = all.length;
  const q = search.trim();
  const exact = q !== '' && all.some((m) => m.id.toLowerCase() === q.toLowerCase());

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch(''); // closing by choosing skips onOpenChange, so clear the search here or the next open starts filtered
  };

  const triggerText = leading && value === leading.value ? leading.label : selected ? selected.label : value ? value : placeholder;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-label={rest['aria-label']}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {selected && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', selected.tier === 'free' ? 'bg-emerald-500' : selected.tier === 'credits' ? 'bg-amber-500' : 'bg-muted-foreground')} />}
            <span className="truncate">{triggerText}</span>
            {!selected && value && !(leading && value === leading.value) && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">custom id</span>}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[19rem]">
        {/* Every typed word must appear in the model's name, id or tag. (cmdk's default is a fuzzy match, which lets unrelated
            ids through: "llama 70b" also matched "mistral-7b-instruct".) Equal scores keep the list in its own order. */}
        <Command
          loop
          filter={(itemValue, query) => (matchesModelSearch(itemValue, query) ? 1 : 0)}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder={total ? `Search ${total} models…` : 'Type a model id…'}
              className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List id={listId} className="max-h-72 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">
              {allowCustom ? 'No match. Type the exact model id to use it.' : 'No models match.'}
            </Command.Empty>

            {leading && (
              <Command.Item
                value={`__leading ${leading.label}`}
                onSelect={() => pick(leading.value)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs data-[selected=true]:bg-accent"
              >
                <span className="truncate">{leading.label}</span>
                {value === leading.value && <Check className="h-3.5 w-3.5 shrink-0" />}
              </Command.Item>
            )}

            {sections.map((s) => (
              <Command.Group
                key={s.key}
                heading={`${s.label} (${s.models.length})`}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {s.models.map((m) => (
                  <Command.Item
                    key={`${s.key}:${m.id}`}
                    value={`${s.key} ${m.id} ${m.label} ${m.tag ?? ''}`}
                    onSelect={() => pick(m.id)}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs data-[selected=true]:bg-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{m.label}</span>
                      {m.id !== m.label && <span className="block truncate font-mono text-[10px] text-muted-foreground">{m.id}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {m.contextK ? <span className="text-[10px] text-muted-foreground">{m.contextK >= 1000 ? `${Math.round(m.contextK / 1000)}M` : `${m.contextK}k`}</span> : null}
                      {m.tag && <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">{m.tag}</span>}
                      <span className={cn('rounded px-1 text-[10px]', TIER_STYLE[m.tier])}>{TIER_LABEL[m.tier]}</span>
                      {value === m.id && <Check className="h-3.5 w-3.5" />}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}

            {allowCustom && q !== '' && !exact && (
              <Command.Item
                forceMount
                value={`__custom ${q}`}
                onSelect={() => pick(q)}
                className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-xs data-[selected=true]:bg-accent"
              >
                Use <span className="truncate font-mono">{q}</span> as a custom model id
              </Command.Item>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
