'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2, Star, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TAX_CATEGORY_LABEL,
  type TaxCategory,
  type TaxProfile,
  TAX_PRESETS,
  taxRegionFor,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';

interface ProfileForm {
  id: string;
  name: string;
  rate: string;
  category: TaxCategory;
  description: string;
}

const CATEGORY_ORDER: TaxCategory[] = ['vat', 'gst', 'sales', 'income', 'withholding', 'custom'];

export function TaxTab() {
  const {
    taxProfiles, defaultTaxProfileId,
    addTaxProfile, updateTaxProfile, deleteTaxProfile, setDefaultTaxProfile,
    log, activeWorkspace,
  } = useBorga();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaxProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    id: '', name: '', rate: '0', category: 'vat', description: '',
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ id: '', name: '', rate: '0', category: 'vat', description: '' });
    setDialogOpen(true);
  };

  const openEdit = (p: TaxProfile) => {
    setEditing(p);
    setForm({ id: p.id, name: p.name, rate: String(p.rate), category: p.category, description: p.description ?? '' });
    setDialogOpen(true);
  };

  const submit = () => {
    const rate = Number(form.rate) || 0;
    if (!form.name.trim()) return;
    if (editing) {
      updateTaxProfile(editing.id, { name: form.name.trim(), rate, category: form.category, description: form.description.trim() || undefined });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Tax profile updated: ${form.name.trim()} (${rate}%).` });
    } else {
      const id = `tax-${Date.now().toString(36)}`;
      addTaxProfile({ id, name: form.name.trim(), rate, category: form.category, description: form.description.trim() || undefined });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Tax profile created: ${form.name.trim()} (${rate}%).` });
    }
    setDialogOpen(false);
  };

  const handleDelete = (p: TaxProfile) => {
    if (taxProfiles.length <= 1) return; // keep at least one profile
    deleteTaxProfile(p.id);
    if (defaultTaxProfileId === p.id && taxProfiles.length > 1) {
      const next = taxProfiles.find((t) => t.id !== p.id);
      if (next) setDefaultTaxProfile(next.id);
    }
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Tax profile removed: ${p.name}.` });
  };

  const defaultProfile = taxProfiles.find((t) => t.id === defaultTaxProfileId);

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Tax configuration"
          sub={`${taxProfiles.length} tax profile(s) — applied to invoices, bills, ledgers & journals`}
        />
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> New tax profile
        </Button>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
        {TAX_PRESETS[taxRegionFor(activeWorkspace()?.country)].note}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">Tax profiles</p>
          <p className="text-[11px] text-muted-foreground">
            The default profile ({defaultProfile ? `${defaultProfile.name} — ${defaultProfile.rate}%` : '…'}) is pre-selected on new invoices & bills.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Profile</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium">Rate</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Notes</th>
              <th className="px-4 py-2 font-medium">Default</th>
              <th className="w-20 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {taxProfiles.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">{p.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{TAX_CATEGORY_LABEL[p.category]}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{p.rate}%</td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{p.description ?? '…'}</td>
                <td className="px-4 py-2.5">
                  {defaultTaxProfileId === p.id ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 ring-1 ring-amber-500/30">
                      <Star className="h-3 w-3 fill-amber-500" /> Default
                    </span>
                  ) : (
                    <button
                      onClick={() => { setDefaultTaxProfile(p.id); log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Default tax set to ${p.name}.` }); }}
                      className="text-xs text-muted-foreground enabled:hover:text-amber-600"
                      title="Make default"
                    >
                      Set default
                    </button>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    <button
                      onClick={() => openEdit(p)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      title="Edit profile"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
                      disabled={taxProfiles.length <= 1}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-destructive/10 enabled:hover:text-destructive disabled:opacity-30"
                      title={taxProfiles.length <= 1 ? 'Keep at least one profile' : 'Delete profile'}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit tax profile' : 'New tax profile'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name *</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. VAT (Standard)"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as TaxCategory })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>{TAX_CATEGORY_LABEL[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Rate (%)</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.name.trim()}>
              <Check className="mr-1 h-3.5 w-3.5" /> {editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
