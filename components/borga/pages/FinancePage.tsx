'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LedgerTab } from '../panels/LedgerTab';
import { AccountingTab } from '../panels/AccountingTab';
import { BankingTab } from '../panels/BankingTab';
import { VendorsTab } from '../panels/VendorsTab';
import { ReportsCenter } from '../panels/ReportsCenter';
import { BookClosureTab } from '../panels/BookClosureTab';
import { TaxTab } from '../panels/TaxTab';
import { BudgetTab } from '../panels/BudgetTab';

export function FinancePage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'ledger');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="ledger">Ledger</TabsTrigger>
        <TabsTrigger value="accounting">Accounting</TabsTrigger>
        <TabsTrigger value="banking">Banking</TabsTrigger>
        <TabsTrigger value="vendors">Vendors &amp; AP</TabsTrigger>
        <TabsTrigger value="tax">Tax</TabsTrigger>
        <TabsTrigger value="budgeting">Budgeting</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
        <TabsTrigger value="closures">Book Closure</TabsTrigger>
      </TabsList>
      <TabsContent value="ledger"><LedgerTab /></TabsContent>
      <TabsContent value="accounting"><AccountingTab /></TabsContent>
      <TabsContent value="banking"><BankingTab /></TabsContent>
      <TabsContent value="vendors"><VendorsTab /></TabsContent>
      <TabsContent value="tax"><TaxTab /></TabsContent>
      <TabsContent value="budgeting"><BudgetTab /></TabsContent>
      <TabsContent value="reports"><ReportsCenter /></TabsContent>
      <TabsContent value="closures"><BookClosureTab /></TabsContent>
    </Tabs>
  );
}
