'use client';

import { useEffect, useMemo, useState } from 'react';
import { useBorga } from '@/lib/borga/store';
import type { OnboardingStepId } from '@/lib/borga/data';

export interface OptionalSetupItem {
  id: Extract<OnboardingStepId, 'website' | 'ai' | 'email' | 'voice'>;
  title: string;
  /** What "configured" means, shown as a hint. */
  hint: string;
  configured: boolean;
}

/**
 * Which of the optional setup items (website, AI model, email, voice) the company has actually configured. It looks at the real
 * settings rather than at whether a wizard step was clicked, so something set up in Settings or Integrations counts, and something
 * undone stops counting. Email is a server-side setting, so it is asked for once per company and again when the window regains focus.
 */
export function useOptionalSetup(): { items: OptionalSetupItem[]; pending: OptionalSetupItem[]; ready: boolean } {
  const { activeWorkspaceId: ws, loadedWorkspaceId, knowledge, llm, settings, elevenlabs, activeWorkspace } = useBorga();
  const [smtp, setSmtp] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ws || loadedWorkspaceId !== ws) return;
    let alive = true;
    const load = () => {
      void fetch(`/api/borga/connections?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j: { statuses?: Array<{ provider: string; configured: boolean }> }) => { if (alive) setSmtp(!!j.statuses?.find((s) => s.provider === 'smtp')?.configured); })
        .catch(() => { if (alive) setSmtp(false); });
    };
    load();
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { alive = false; document.removeEventListener('visibilitychange', onFocus); };
  }, [ws, loadedWorkspaceId]);

  const websiteStep = activeWorkspace()?.onboarding?.steps.find((s) => s.id === 'website');
  const items = useMemo<OptionalSetupItem[]>(() => [
    { id: 'website', title: 'Website knowledge', hint: 'Entries read from your website', configured: knowledge.some((k) => /^Website/i.test(k.source)) || !!websiteStep?.completed },
    { id: 'ai', title: 'AI model', hint: 'Pollinations works out of the box — pick another any time', configured: !!llm.providerId },
    { id: 'email', title: 'Email (SMTP)', hint: 'Your own mail server', configured: smtp === true },
    { id: 'voice', title: 'Voice', hint: 'Always listening or an agent voice', configured: !!settings.notifications.voice || !!elevenlabs.connected },
  ], [knowledge, llm.providerId, smtp, settings.notifications.voice, elevenlabs.connected, websiteStep?.completed]);

  // until the server has answered about email, do not claim it is missing
  const ready = loadedWorkspaceId === ws && smtp !== null;
  return { items, pending: items.filter((i) => !i.configured), ready };
}
