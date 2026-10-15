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
  if (!social && !ads) {
    return <p className="p-10 text-center text-sm text-muted-foreground">All marketing features are switched off — enable them under Settings → Features.</p>;
  }
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
