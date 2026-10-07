'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AgentsTab } from '../panels/AgentsTab';
import { RunsQueueTab } from '../panels/RunsQueueTab';
import { PlannerTab } from '../panels/PlannerTab';
import { ActivityTab } from '../panels/ActivityTab';

export function AIPlatformPage({ initialTab }: { initialTab?: string }) {
  // Legacy deep-links keep working: the Company Engine moved to the Company
  // menu, and the old "runner" tab id was renamed "runs" with the queue rework.
  const LEGACY: Record<string, string> = { engine: 'agents', runner: 'runs' };
  const [tab, setTab] = useState(initialTab ? (LEGACY[initialTab] ?? initialTab) : 'agents');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="runs">Runs & Queue</TabsTrigger>
        <TabsTrigger value="planner">Planner</TabsTrigger>
        <TabsTrigger value="activity">Activity Log</TabsTrigger>
      </TabsList>
      <TabsContent value="agents"><AgentsTab /></TabsContent>
      <TabsContent value="runs"><RunsQueueTab /></TabsContent>
      <TabsContent value="planner"><PlannerTab /></TabsContent>
      <TabsContent value="activity"><ActivityTab /></TabsContent>
    </Tabs>
  );
}
