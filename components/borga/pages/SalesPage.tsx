'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SalesPipelineTab } from '../panels/SalesPipelineTab';
import { CustomerTab } from '../panels/CustomerTab';
import { InvoiceTab } from '../panels/InvoiceTab';
import { RecurringInvoicesTab } from '../panels/RecurringInvoicesTab';
import { QuotesTab } from '../panels/QuotesTab';
import { InboxWorkspace } from '../InboxWorkspace';
import { useFeature } from '@/lib/borga/features-client';

export function SalesPage({ initialTab, initialContactKey }: { initialTab?: string; initialContactKey?: string }) {
  // "Recurring" lives inside Invoicing now; an old `recurring` deep-link still
  // lands on the Invoicing tab with the Recurring sub-tab selected.
  const [tab, setTab] = useState(initialTab === 'recurring' ? 'invoices' : (initialTab ?? 'pipeline'));
  const [invoicingSub, setInvoicingSub] = useState(initialTab === 'recurring' ? 'recurring' : 'invoices');
  const quotes = useFeature('quotes');
  const inbox = useFeature('inbox');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        {inbox && <TabsTrigger value="inbox">Inbox</TabsTrigger>}
        <TabsTrigger value="customers">Customers</TabsTrigger>
        <TabsTrigger value="invoices">Invoicing</TabsTrigger>
        {quotes && <TabsTrigger value="quotes">Quotes</TabsTrigger>}
      </TabsList>
      <TabsContent value="pipeline"><SalesPipelineTab /></TabsContent>
      {inbox && <TabsContent value="inbox"><InboxWorkspace mode="sales" initialContactKey={initialContactKey} /></TabsContent>}
      <TabsContent value="customers"><CustomerTab /></TabsContent>
      <TabsContent value="invoices">
        <Tabs value={invoicingSub} onValueChange={setInvoicingSub} className="space-y-4">
          <TabsList className="h-8">
            <TabsTrigger value="invoices" className="text-xs">Invoices</TabsTrigger>
            <TabsTrigger value="recurring" className="text-xs">Recurring</TabsTrigger>
          </TabsList>
          <TabsContent value="invoices"><InvoiceTab /></TabsContent>
          <TabsContent value="recurring"><RecurringInvoicesTab /></TabsContent>
        </Tabs>
      </TabsContent>
      {quotes && <TabsContent value="quotes"><QuotesTab /></TabsContent>}
    </Tabs>
  );
}
