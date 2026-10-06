'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { InboxTab } from '../panels/InboxTab';
import { SecureChatTab } from '../panels/SecureChatTab';
import { CallsTab } from '../panels/CallsTab';
import { useFeature } from '@/lib/borga/features-client';

export function CommunicationsPage({ initialTab }: { initialTab?: string }) {
  const inbox = useFeature('inbox');
  const calls = useFeature('calls');
  const secure = useFeature('secureChat');
  const first = inbox ? 'inbox' : secure ? 'securechat' : 'calls';
  const [tab, setTab] = useState(initialTab && (initialTab === 'inbox' ? inbox : initialTab === 'securechat' ? secure : initialTab === 'calls' ? calls : false) ? initialTab : first);
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        {inbox && <TabsTrigger value="inbox">Unified Inbox</TabsTrigger>}
        {secure && <TabsTrigger value="securechat">Encrypted Chat</TabsTrigger>}
        {calls && <TabsTrigger value="calls">Calls</TabsTrigger>}
      </TabsList>
      {inbox && <TabsContent value="inbox"><InboxTab /></TabsContent>}
      {secure && <TabsContent value="securechat"><SecureChatTab /></TabsContent>}
      {calls && <TabsContent value="calls"><CallsTab /></TabsContent>}
    </Tabs>
  );
}
