'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TicketsTab } from '../panels/TicketsTab';
import { TicketSettingsTab } from '../panels/TicketSettingsTab';

export function SupportPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'tickets');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="tickets">Tickets</TabsTrigger>
        <TabsTrigger value="settings">SLA &amp; Mailbox</TabsTrigger>
      </TabsList>
      <TabsContent value="tickets"><TicketsTab /></TabsContent>
      <TabsContent value="settings"><TicketSettingsTab /></TabsContent>
    </Tabs>
  );
}
