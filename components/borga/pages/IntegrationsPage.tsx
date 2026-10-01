'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ToolsTab, type ToolsSection } from '../panels/ToolsTab';
import { ConnectionsTab } from '../panels/ConnectionsTab';
import { SupermemoryCard } from '../panels/SupermemoryCard';

const TAB_TO_SECTION: Record<string, ToolsSection> = {
  toolkits: 'composio',
  'ai-providers': 'ai-providers',
  connected: 'email',
};

export function IntegrationsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<string>(initialTab && (initialTab in TAB_TO_SECTION || initialTab === 'connections') ? initialTab : 'toolkits');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="toolkits">Composio Toolkits</TabsTrigger>
        <TabsTrigger value="ai-providers">AI &amp; Voice</TabsTrigger>
        <TabsTrigger value="connected">Connected Apps</TabsTrigger>
        <TabsTrigger value="connections">Connections</TabsTrigger>
      </TabsList>
      <TabsContent value="toolkits"><ToolsTab section={TAB_TO_SECTION.toolkits} /></TabsContent>
      <TabsContent value="ai-providers">
        <div className="space-y-5">
          <ToolsTab section={TAB_TO_SECTION['ai-providers']} />
          <SupermemoryCard />
        </div>
      </TabsContent>
      <TabsContent value="connected"><ToolsTab section={TAB_TO_SECTION.connected} /></TabsContent>
      <TabsContent value="connections"><ConnectionsTab /></TabsContent>
    </Tabs>
  );
}
