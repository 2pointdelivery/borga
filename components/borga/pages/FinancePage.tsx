'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LedgerTab } from '../panels/LedgerTab';
import { AccountingTab } from '../panels/AccountingTab';
import { FixedAssetsTab } from '../panels/FixedAssetsTab';
import { BankingTab } from '../panels/BankingTab';
import { VendorsTab } from '../panels/VendorsTab';
import { ReportsCenter } from '../panels/ReportsCenter';
import { BookClosureTab } from '../panels/BookClosureTab';
import { TaxTab } from '../panels/TaxTab';
import { FilingTab } from '../panels/FilingTab';
import { BudgetTab } from '../panels/BudgetTab';
import { RevenueTrackerTab } from '../panels/RevenueTrackerTab';
import { RecurringBillsTab } from '../panels/RecurringBillsTab';
import { useFeature } from '@/lib/borga/features-client';

export function FinancePage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab === 'recurring-bills' ? 'vendors' : (initialTab ?? 'ledger'));
  // "Recurring bills" lives inside Vendors & AP now; an old `recurring-bills`
  // deep-link still lands on Vendors & AP with the Recurring sub-tab selected.
  const [vendorsSub, setVendorsSub] = useState(initialTab === 'recurring-bills' ? 'recurring-bills' : 'vendors');
  const banking = useFeature('banking');
  const revenue = useFeature('revenueTracker');
  const closures = useFeature('bookClosure');
  const assetsOn = useFeature('fixedAssets');
  const filingOn = useFeature('filings');
  const budgeting = useFeature('budgeting');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="ledger">Ledger</TabsTrigger>
        <TabsTrigger value="accounting">Accounting</TabsTrigger>
        {assetsOn && <TabsTrigger value="assets">Fixed Assets</TabsTrigger>}
        {banking && <TabsTrigger value="banking">Banking</TabsTrigger>}
        <TabsTrigger value="vendors">Vendors &amp; AP</TabsTrigger>
        <TabsTrigger value="tax">Tax</TabsTrigger>
        {budgeting && <TabsTrigger value="budgeting">Budgeting</TabsTrigger>}
        {revenue && <TabsTrigger value="revenue">Revenue Tracker</TabsTrigger>}
        <TabsTrigger value="reports">Reports</TabsTrigger>
        {closures && <TabsTrigger value="closures">Book Closure</TabsTrigger>}
        {filingOn && <TabsTrigger value="filing">Filing</TabsTrigger>}
      </TabsList>
      <TabsContent value="ledger"><LedgerTab /></TabsContent>
      <TabsContent value="accounting"><AccountingTab /></TabsContent>
      {assetsOn && <TabsContent value="assets"><FixedAssetsTab /></TabsContent>}
      {banking && <TabsContent value="banking"><BankingTab /></TabsContent>}
      <TabsContent value="vendors">
        <Tabs value={vendorsSub} onValueChange={setVendorsSub} className="space-y-4">
          <TabsList className="h-8">
            <TabsTrigger value="vendors" className="text-xs">Vendors &amp; AP</TabsTrigger>
            <TabsTrigger value="recurring-bills" className="text-xs">Recurring Bills</TabsTrigger>
          </TabsList>
          <TabsContent value="vendors"><VendorsTab /></TabsContent>
          <TabsContent value="recurring-bills"><RecurringBillsTab /></TabsContent>
        </Tabs>
      </TabsContent>
      <TabsContent value="tax"><TaxTab /></TabsContent>
      {budgeting && <TabsContent value="budgeting"><BudgetTab /></TabsContent>}
      {revenue && <TabsContent value="revenue"><RevenueTrackerTab /></TabsContent>}
      <TabsContent value="reports"><ReportsCenter /></TabsContent>
      {closures && <TabsContent value="closures"><BookClosureTab /></TabsContent>}
      {filingOn && <TabsContent value="filing"><FilingTab /></TabsContent>}
    </Tabs>
  );
}
