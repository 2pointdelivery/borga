'use client';

import { useMemo } from 'react';
import { ArrowRight, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { findCustomerDuplicates, findLeadDuplicates } from '@/lib/borga/duplicates';

/** Possible duplicates, side by side: keep one, merge the other into it. Nothing merges itself. */
export function LeadDedupeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { leads, customers, mergeLeads, mergeCustomers } = useBorga();
  const leadPairs = useMemo(() => findLeadDuplicates(leads), [leads]);
  const customerPairs = useMemo(() => findCustomerDuplicates(customers), [customers]);
  const nameOf = (kind: 'lead' | 'customer', id: string) => {
    const l = kind === 'lead' ? leads.find((x) => x.id === id) : customers.find((x) => x.id === id);
    return l?.name ?? id;
  };

  const mergeLead = (winnerId: string, loserId: string) => {
    if (mergeLeads(winnerId, loserId)) {
      toast({ title: 'Leads merged', description: `${nameOf('lead', loserId)} folded into ${nameOf('lead', winnerId)}.`, variant: 'success' });
    } else {
      toast({ title: 'Could not merge', variant: 'error' });
    }
  };

  const mergeCustomer = (winnerId: string, loserId: string) => {
    if (mergeCustomers(winnerId, loserId)) {
      toast({ title: 'Accounts merged', description: `Deals, quotes, invoices and projects moved to ${nameOf('customer', winnerId)}.`, variant: 'success' });
    } else {
      toast({ title: 'Could not merge', variant: 'error' });
    }
  };

  const empty = !leadPairs.length && !customerPairs.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Possible duplicates</DialogTitle>
          <DialogDescription>Same relationship entered twice — email, phone, or name. Merging fills blanks from the loser, moves its history, and deletes it.</DialogDescription>
        </DialogHeader>
        {empty && <p className="py-6 text-center text-sm text-muted-foreground">No duplicates found. Clean pipeline.</p>}
        {!empty && (
          <div className="space-y-4">
            {leadPairs.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">LEADS ({leadPairs.length})</p>
                {leadPairs.map((p) => (
                  <div key={`${p.aId}-${p.bId}`} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{nameOf('lead', p.aId)} <span className="font-normal text-muted-foreground">≈ {nameOf('lead', p.bId)}</span></p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => mergeLead(p.aId, p.bId)}>
                        <Copy className="h-3.5 w-3.5" /> Keep {nameOf('lead', p.aId)}
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => mergeLead(p.bId, p.aId)}>
                        Keep {nameOf('lead', p.bId)} <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {customerPairs.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">ACCOUNTS ({customerPairs.length})</p>
                {customerPairs.map((p) => (
                  <div key={`${p.aId}-${p.bId}`} className="rounded-lg border p-3">
                    <p className="text-sm font-medium">{nameOf('customer', p.aId)} <span className="font-normal text-muted-foreground">≈ {nameOf('customer', p.bId)}</span></p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => mergeCustomer(p.aId, p.bId)}>
                        <Copy className="h-3.5 w-3.5" /> Keep {nameOf('customer', p.aId)}
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => mergeCustomer(p.bId, p.aId)}>
                        Keep {nameOf('customer', p.bId)} <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
