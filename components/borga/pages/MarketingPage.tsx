'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SocialMediaTab } from '../panels/SocialMediaTab';
import { AdvertisingTab } from '../panels/AdvertisingTab';

export function MarketingPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'social');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="social">Social Media</TabsTrigger>
        <TabsTrigger value="advertising">Advertising</TabsTrigger>
      </TabsList>
      <TabsContent value="social"><SocialMediaTab /></TabsContent>
      <TabsContent value="advertising"><AdvertisingTab /></TabsContent>
    </Tabs>
  );
}
