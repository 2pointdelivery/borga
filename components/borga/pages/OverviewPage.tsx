'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CommandCenter } from '../panels/CommandCenter';
import { AnalyticsTab } from '../panels/AnalyticsTab';
import { KpisTab } from '../panels/KpisTab';
import { useFeature } from '@/lib/borga/features-client';

export function OverviewPage({ initialTab }: { initialTab?: string }) {
  const kpis = useFeature('kpis');
  const analytics = useFeature('analytics');
  // a deep link to a tab that is switched off lands on the Command Center instead of an empty page
  const allowed = (t?: string) => t === 'kpis' ? kpis : t === 'analytics' ? analytics : true;
  const [tab, setTab] = useState(initialTab && allowed(initialTab) ? initialTab : 'command');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="command">Command Center</TabsTrigger>
        {analytics && <TabsTrigger value="analytics">Analytics</TabsTrigger>}
        {kpis && <TabsTrigger value="kpis">KPIs</TabsTrigger>}
      </TabsList>
      <TabsContent value="command"><CommandCenter /></TabsContent>
      {analytics && <TabsContent value="analytics"><AnalyticsTab /></TabsContent>}
      {kpis && <TabsContent value="kpis"><KpisTab /></TabsContent>}
    </Tabs>
  );
}
