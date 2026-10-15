'use client';

import { InboxWorkspace } from '../InboxWorkspace';
import { useFeature } from '@/lib/borga/features-client';

/**
 * The Inbox page — every communication in one three-pane inbox: email, SMS,
 * WhatsApp and call history are channels on one timeline, grouped one thread
 * per contact. (The old separate Secure-chat and Calls screens were removed
 * with the unified-inbox rework; the secureChat/calls flags keep their data.)
 */
export function CommunicationsPage({ initialTab }: { initialTab?: string }) {
  void initialTab;
  const inbox = useFeature('inbox');
  const secure = useFeature('secureChat');
  const calls = useFeature('calls');
  if (!inbox && !secure && !calls) {
    return <p className="p-10 text-center text-sm text-muted-foreground">All inbox features are switched off — enable them under Settings → Features.</p>;
  }
  return <InboxWorkspace mode="full" />;
}
