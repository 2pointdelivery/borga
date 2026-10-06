'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ToolsTab, type ToolsSection } from '../panels/ToolsTab';
import { ConnectionsTab } from '../panels/ConnectionsTab';
import { SupermemoryCard } from '../panels/SupermemoryCard';
import { LlmFallbackCard } from '../panels/LlmFallbackCard';
import { useFeature } from '@/lib/borga/features-client';

const TAB_TO_SECTION: Record<string, ToolsSection> = {
  toolkits: 'composio',
  'ai-providers': 'ai-providers',
  connected: 'email',
};

export function IntegrationsPage({ initialTab }: { initialTab?: string }) {
  const composio = useFeature('composio');
  const known = (t?: string) => !!t && (t in TAB_TO_SECTION || t === 'connections') && (t !== 'toolkits' || composio);
  const [tab, setTab] = useState<string>(known(initialTab) ? (initialTab as string) : composio ? 'toolkits' : 'ai-providers');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        {composio && <TabsTrigger value="toolkits">Composio Toolkits</TabsTrigger>}
        <TabsTrigger value="ai-providers">AI &amp; Voice</TabsTrigger>
        <TabsTrigger value="connected">Connected Apps</TabsTrigger>
        <TabsTrigger value="connections">Connections</TabsTrigger>
      </TabsList>
      {composio && <TabsContent value="toolkits"><ToolsTab section={TAB_TO_SECTION.toolkits} /></TabsContent>}
      <TabsContent value="ai-providers">
        <div className="space-y-5">
          <LlmFallbackCard />
          <ToolsTab section={TAB_TO_SECTION['ai-providers']} />
          <SupermemoryCard />
        </div>
      </TabsContent>
      <TabsContent value="connected"><ToolsTab section={TAB_TO_SECTION.connected} /></TabsContent>
      <TabsContent value="connections"><ConnectionsTab /></TabsContent>
    </Tabs>
  );
}
