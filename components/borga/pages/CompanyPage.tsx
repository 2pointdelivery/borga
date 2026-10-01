'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WorkspacesTab } from '../panels/WorkspacesTab';
import { ValuationTab } from '../panels/ValuationTab';
import { FundraisingTab } from '../panels/FundraisingTab';
import { KnowledgeBaseTab } from '../panels/KnowledgeBaseTab';
import { useFeature } from '@/lib/borga/features-client';

export function CompanyPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'workspaces');
  const valuation = useFeature('valuation');
  const fundraising = useFeature('fundraising');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="workspaces">Companies</TabsTrigger>
        {valuation && <TabsTrigger value="valuation">Valuation</TabsTrigger>}
        {fundraising && <TabsTrigger value="fundraising">Fundraising</TabsTrigger>}
        <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
      </TabsList>
      <TabsContent value="workspaces"><WorkspacesTab /></TabsContent>
      {valuation && <TabsContent value="valuation"><ValuationTab /></TabsContent>}
      {fundraising && <TabsContent value="fundraising"><FundraisingTab /></TabsContent>}
      <TabsContent value="knowledge"><KnowledgeBaseTab /></TabsContent>
    </Tabs>
  );
}
