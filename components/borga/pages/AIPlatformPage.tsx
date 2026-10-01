'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AgentsTab } from '../panels/AgentsTab';
import { AgentRunnerTab } from '../panels/AgentRunnerTab';
import { OrchestrationTab } from '../panels/OrchestrationTab';
import { PlannerTab } from '../panels/PlannerTab';
import { ActivityTab } from '../panels/ActivityTab';

export function AIPlatformPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'agents');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="agents">Agents</TabsTrigger>
        <TabsTrigger value="runner">Agent Runner</TabsTrigger>
        <TabsTrigger value="engine">Company Engine</TabsTrigger>
        <TabsTrigger value="planner">Planner</TabsTrigger>
        <TabsTrigger value="activity">Activity Log</TabsTrigger>
      </TabsList>
      <TabsContent value="agents"><AgentsTab /></TabsContent>
      <TabsContent value="runner"><AgentRunnerTab /></TabsContent>
      <TabsContent value="engine"><OrchestrationTab /></TabsContent>
      <TabsContent value="planner"><PlannerTab /></TabsContent>
      <TabsContent value="activity"><ActivityTab /></TabsContent>
    </Tabs>
  );
}
