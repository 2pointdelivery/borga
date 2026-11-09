'use client';

import { InboxWorkspace } from '../InboxWorkspace';
import { useFeature } from '@/lib/borga/features-client';
import { ConfigDeepLinkButton } from '../ConfigDeepLink';

export function CommunicationsPage({ initialTab }: { initialTab?: string }) {
  void initialTab;
  const inbox = useFeature('inbox');
  const secure = useFeature('secureChat');
  const calls = useFeature('calls');
  if (!inbox && !secure && !calls) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-muted-foreground">
        <p>All inbox features are switched off — enable them under Settings → Features.</p>
        <ConfigDeepLinkButton target="features" />
      </div>
    );
  }
  return <InboxWorkspace mode="full" />;
}
