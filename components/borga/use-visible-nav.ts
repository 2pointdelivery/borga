'use client';

import { useMemo } from 'react';
import { featureForTab } from '@/lib/borga/features';
import { useFeatures } from '@/lib/borga/features-client';
import { NAV_PAGES, type NavPage } from './nav';

/**
 * NAV_PAGES minus any page or tab whose feature flag is off. A page whose tabs are all switched off (Marketing, when both
 * Social and Advertising are off) disappears too, instead of showing an empty screen.
 */
export function useVisibleNav(): NavPage[] {
  const flags = useFeatures((s) => s.flags);
  return useMemo(
    () =>
      NAV_PAGES.filter((p) => {
        const f = featureForTab(p.id);
        return !f || flags[f];
      }).flatMap((p) => {
        const tabs = p.tabs?.filter((t) => {
          const f = featureForTab(p.id, t.id);
          return !f || flags[f];
        });
        if (p.tabs?.length && !tabs?.length) return [];
        return [{ ...p, tabs }];
      }),
    [flags],
  );
}
