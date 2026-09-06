'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SalesPipelineTab } from '../panels/SalesPipelineTab';
import { CustomerTab } from '../panels/CustomerTab';
import { InvoiceTab } from '../panels/InvoiceTab';

export function SalesPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'pipeline');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        <TabsTrigger value="customers">Customers</TabsTrigger>
        <TabsTrigger value="invoices">Invoicing</TabsTrigger>
      </TabsList>
      <TabsContent value="pipeline"><SalesPipelineTab /></TabsContent>
      <TabsContent value="customers"><CustomerTab /></TabsContent>
      <TabsContent value="invoices"><InvoiceTab /></TabsContent>
    </Tabs>
  );
}
