'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ApiKeysTab } from '../panels/ApiKeysTab';
import { WebhookManager } from '../WebhookManager';
import { FeatureRequestsTab } from '../panels/FeatureRequestsTab';

export function DevelopersPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'api-keys');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="api-keys">API Keys</TabsTrigger>
        <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        <TabsTrigger value="requests">Feature Requests</TabsTrigger>
      </TabsList>
      <TabsContent value="api-keys"><ApiKeysTab /></TabsContent>
      <TabsContent value="webhooks"><WebhookManager /></TabsContent>
      <TabsContent value="requests"><FeatureRequestsTab /></TabsContent>
    </Tabs>
  );
}
