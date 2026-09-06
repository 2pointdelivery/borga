'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CITIES_BY_COUNTRY,
  COUNTRY_OPTIONS,
  INDUSTRY_OPTIONS,
  REGIONS_BY_COUNTRY,
  TIMEZONE_OPTIONS,
  type Workspace,
  type TaxProfile,
  type AccountType,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { cn } from '@/lib/utils';

/**
 * Shared, polished form widgets — every geographic / categorical / temporal
 * field in the suite uses a real dropdown or datalist widget instead of a
 * bare text input.
 */

const NO_PROJECT = '__none__';

/** Shared project picker for any record that can be attributed to a Project (invoices, bills, journal entries, ledger entries, expenses, tasks). */
export function ProjectSelect({ value, onChange, placeholder = 'No project' }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  const { projects } = useBorga();
  return (
    <Select value={value || NO_PROJECT} onValueChange={(v) => onChange(v === NO_PROJECT ? undefined : v)}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PROJECT}>{placeholder}</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const NO_ACCOUNT = '__none__';

/** Shared chart-of-accounts picker — links a transaction (invoice, bill, ledger entry) to a GL account, filterable by type. */
export function AccountSelect({
  value, onChange, types, placeholder = 'No account',
}: { value?: string; onChange: (v: string | undefined) => void; types?: AccountType[]; placeholder?: string }) {
  const { coa } = useBorga();
  const accounts = types ? coa.filter((a) => types.includes(a.type)) : coa;
  return (
    <Select value={value || NO_ACCOUNT} onValueChange={(v) => onChange(v === NO_ACCOUNT ? undefined : v)}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_ACCOUNT}>{placeholder}</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Multi-tax picker — many jurisdictions stack more than one tax on a single
 * transaction (e.g. GST + PST). Lets a document apply several tax profiles
 * at once; the combined rate is the sum of every selected profile's rate.
 */
export function TaxProfilesMultiSelect({
  taxProfiles, selectedIds, onChange,
}: { taxProfiles: TaxProfile[]; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  const totalRate = taxProfiles.filter((t) => selectedIds.includes(t.id)).reduce((s, t) => s + t.rate, 0);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {taxProfiles.map((t) => {
          const active = selectedIds.includes(t.id);
          return (
            <button
              type="button"
              key={t.id}
              onClick={() => toggle(t.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                active ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:border-primary/40',
              )}
            >
              {t.name} ({t.rate}%)
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Combined rate: {totalRate}%{selectedIds.length > 1 ? ` — ${selectedIds.length} taxes stacked` : ''}
      </p>
    </div>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function CountrySelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder="Select country…" /></SelectTrigger>
      <SelectContent>
        {COUNTRY_OPTIONS.map((c) => (
          <SelectItem key={c} value={c}>{c}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RegionSelect({ country, value, onChange }: { country: string; value: string; onChange: (v: string) => void }) {
  const regions = country ? REGIONS_BY_COUNTRY[country] : undefined;
  if (regions) {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select state / province…" /></SelectTrigger>
        <SelectContent>
          {regions.map((r) => (
            <SelectItem key={r} value={r}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  // Free-text fallback for countries without a curated region list.
  return (
    <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={country ? 'State / province' : 'Select country first'} disabled={!country} />
  );
}

export function CityInput({ country, value, onChange }: { country: string; value: string; onChange: (v: string) => void }) {
  const listId = useMemo(() => `cities-${country.replace(/\W+/g, '-').toLowerCase() || 'none'}`, [country]);
  const cities = country ? CITIES_BY_COUNTRY[country] ?? [] : [];
  return (
    <>
      <Input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={country ? 'City' : 'Select country first'} disabled={!country} autoComplete="off" />
      <datalist id={listId}>
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}

export function IndustryInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const listId = id ?? 'industry-options';
  return (
    <>
      <Input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Select or type an industry…" autoComplete="off" />
      <datalist id={listId}>
        {INDUSTRY_OPTIONS.map((i) => (
          <option key={i} value={i} />
        ))}
      </datalist>
    </>
  );
}

const CURRENCIES: { code: Workspace['currency']; label: string }[] = [
  { code: 'USD', label: 'USD — US Dollar' },
  { code: 'CAD', label: 'CAD — Canadian Dollar' },
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'GBP', label: 'GBP — British Pound' },
];

export function CurrencySelect({ value, onChange }: { value: string; onChange: (v: Workspace['currency']) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Workspace['currency'])}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value || 'UTC'} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {TIMEZONE_OPTIONS.map((t) => (
          <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DateInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={className} />;
}

export function TimeInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <Input type="time" value={value} onChange={(e) => onChange(e.target.value)} className={className} />;
}
