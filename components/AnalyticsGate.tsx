'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';

/**
 * Analytics loads only with consent. The server decides (HttpOnly signed
 * cookie + GPC override); this gate just obeys the verdict, so tracking
 * scripts can never run before — or against — the visitor's choice.
 */
export function AnalyticsGate({ allowAnalytics, src, websiteId, nonce }: { allowAnalytics: boolean; src?: string; websiteId?: string; nonce?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || !allowAnalytics || !src) return null;
  return <Script async src={src} data-website-id={websiteId} nonce={nonce} />;
}
