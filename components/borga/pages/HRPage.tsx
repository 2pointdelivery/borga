'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { HRDirectoryTab, HRTimeOffTab, HRTeamsTab, HROrgChartTab } from '../panels/HRTab';
import { TimeClockTab } from '../panels/TimeClockTab';
import { InvitesTab } from '../panels/InvitesTab';

export function HRPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'directory');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="directory">Directory</TabsTrigger>
        <TabsTrigger value="timeclock">Time Clock</TabsTrigger>
        <TabsTrigger value="timeoff">Time Off</TabsTrigger>
        <TabsTrigger value="invites">Team Invites</TabsTrigger>
        <TabsTrigger value="teams">Teams</TabsTrigger>
        <TabsTrigger value="org">Organogram</TabsTrigger>
      </TabsList>
      <TabsContent value="directory"><HRDirectoryTab /></TabsContent>
      <TabsContent value="timeclock"><TimeClockTab /></TabsContent>
      <TabsContent value="timeoff"><HRTimeOffTab /></TabsContent>
      <TabsContent value="invites"><InvitesTab /></TabsContent>
      <TabsContent value="teams"><HRTeamsTab /></TabsContent>
      <TabsContent value="org"><HROrgChartTab /></TabsContent>
    </Tabs>
  );
}
