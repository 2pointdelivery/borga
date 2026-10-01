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
  INDUSTRY_OPTIONS,
  TIMEZONE_OPTIONS,
  type TaxProfile,
  type AccountType,
} from '@/lib/borga/data';
import { findCountry, type GeoCountry } from '@/lib/borga/geo';
import { ALL_CURRENCIES, currencyLabel, currencySymbol } from '@/lib/borga/currencies';
import { SearchSelect, type SearchOption } from './SearchSelect';
import { useCities, useCountries, useStates } from './use-geo';
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

/** Every country (ISO 3166-1), searchable. The value is the country NAME, which is what the rest of the app stores and matches on. */
export function CountrySelect({ value, onChange, onPick, id }: { value: string; onChange: (v: string) => void; onPick?: (country: GeoCountry) => void; id?: string }) {
  const { data: countries, loading } = useCountries();
  const options = useMemo<SearchOption[]>(() => countries.map((c) => ({ value: c.n, label: c.n, detail: c.c })), [countries]);
  return (
    <SearchSelect
      id={id}
      aria-label="Country"
      options={options}
      value={value}
      loading={loading}
      placeholder="Select country"
      searchPlaceholder="Search countries"
      allowCustom
      onChange={(v) => {
        onChange(v);
        const c = findCountry(countries, v);
        if (c) onPick?.(c);
      }}
    />
  );
}

/** State / province / region of the chosen country, searchable. Countries without a list let you type your own. */
export function RegionSelect({ country, value, onChange }: { country: string; value: string; onChange: (v: string) => void }) {
  const { data: states, loading } = useStates(country);
  const options = useMemo<SearchOption[]>(() => states.map((s) => ({ value: s.n, label: s.n })), [states]);
  return (
    <SearchSelect
      aria-label="State or province"
      options={options}
      value={value}
      loading={loading}
      disabled={!country}
      placeholder={country ? 'Select state / province' : 'Select country first'}
      searchPlaceholder="Search states and provinces"
      allowCustom
      onChange={(v) => onChange(v)}
    />
  );
}

/** Cities of the chosen state (or the country's biggest cities when no state is chosen), searchable. Any other place can be typed. */
export function CityInput({ country, state = '', value, onChange }: { country: string; state?: string; value: string; onChange: (v: string) => void }) {
  const { data: cities, loading, hasStates } = useCities(country, state);
  const options = useMemo<SearchOption[]>(() => cities.map((c) => ({ value: c, label: c })), [cities]);
  return (
    <SearchSelect
      aria-label="City"
      options={options}
      value={value}
      loading={loading}
      disabled={!country}
      placeholder={!country ? 'Select country first' : hasStates && !state ? 'Select state first (or type a city)' : 'Select city'}
      searchPlaceholder="Search cities"
      allowCustom
      onChange={(v) => onChange(v)}
    />
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

const CURRENCY_OPTIONS: SearchOption[] = ALL_CURRENCIES.map((c) => ({
  value: c.code,
  label: currencyLabel(c),
  detail: currencySymbol(c.code),
  group: c.kind === 'currency' ? 'Currencies' : 'Other ISO 4217 codes (metals, funds, special)',
}));

/** Every ISO 4217 currency, searchable by code, name or symbol ("ghs", "cedi", "naira"). The value is the 3-letter code. */
export function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <SearchSelect
      aria-label="Currency"
      options={CURRENCY_OPTIONS}
      value={value}
      placeholder="Select currency"
      searchPlaceholder="Search currencies"
      clearable={false}
      limit={200}
      onChange={(v) => v && onChange(v)}
    />
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
