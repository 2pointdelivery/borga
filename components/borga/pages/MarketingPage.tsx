'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SocialMediaTab } from '../panels/SocialMediaTab';
import { AdvertisingTab } from '../panels/AdvertisingTab';
import { useFeature } from '@/lib/borga/features-client';

export function MarketingPage({ initialTab }: { initialTab?: string }) {
  const social = useFeature('social');
  const ads = useFeature('advertising');
  const [tab, setTab] = useState(initialTab ?? (social ? 'social' : 'advertising'));
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        {social && <TabsTrigger value="social">Social Media</TabsTrigger>}
        {ads && <TabsTrigger value="advertising">Advertising</TabsTrigger>}
      </TabsList>
      {social && <TabsContent value="social"><SocialMediaTab /></TabsContent>}
      {ads && <TabsContent value="advertising"><AdvertisingTab /></TabsContent>}
    </Tabs>
  );
}
