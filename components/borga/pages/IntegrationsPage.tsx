'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ToolsTab, type ToolsSection } from '../panels/ToolsTab';

const TAB_TO_SECTION: Record<string, ToolsSection> = {
  toolkits: 'composio',
  'ai-providers': 'ai-providers',
  connected: 'email',
};

export function IntegrationsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<string>(initialTab && initialTab in TAB_TO_SECTION ? initialTab : 'toolkits');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="toolkits">Composio Toolkits</TabsTrigger>
        <TabsTrigger value="ai-providers">AI &amp; Voice</TabsTrigger>
        <TabsTrigger value="connected">Connected Apps</TabsTrigger>
      </TabsList>
      <TabsContent value="toolkits"><ToolsTab section={TAB_TO_SECTION.toolkits} /></TabsContent>
      <TabsContent value="ai-providers"><ToolsTab section={TAB_TO_SECTION['ai-providers']} /></TabsContent>
      <TabsContent value="connected"><ToolsTab section={TAB_TO_SECTION.connected} /></TabsContent>
    </Tabs>
  );
}
