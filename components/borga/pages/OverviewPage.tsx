'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CommandCenter } from '../panels/CommandCenter';
import { AnalyticsTab } from '../panels/AnalyticsTab';
import { KpisTab } from '../panels/KpisTab';

export function OverviewPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'command');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="command">Command Center</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
        <TabsTrigger value="kpis">KPIs &amp; Reports</TabsTrigger>
      </TabsList>
      <TabsContent value="command"><CommandCenter /></TabsContent>
      <TabsContent value="analytics"><AnalyticsTab /></TabsContent>
      <TabsContent value="kpis"><KpisTab /></TabsContent>
    </Tabs>
  );
}
