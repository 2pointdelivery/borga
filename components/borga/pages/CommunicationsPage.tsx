'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { InboxTab } from '../panels/InboxTab';
import { SecureChatTab } from '../panels/SecureChatTab';
import { CallsTab } from '../panels/CallsTab';

export function CommunicationsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'inbox');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="inbox">Unified Inbox</TabsTrigger>
        <TabsTrigger value="securechat">Encrypted Chat</TabsTrigger>
        <TabsTrigger value="calls">Calls</TabsTrigger>
      </TabsList>
      <TabsContent value="inbox"><InboxTab /></TabsContent>
      <TabsContent value="securechat"><SecureChatTab /></TabsContent>
      <TabsContent value="calls"><CallsTab /></TabsContent>
    </Tabs>
  );
}
