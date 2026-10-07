import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { AgentationGuard } from '@/components/AgentationGuard';
import { HappySeedsWatermark } from '@/components/HappySeedsWatermark';
import { AnalyticsGate } from '@/components/AnalyticsGate';
import { effectiveConsent } from '@/lib/borga/consent-server';
import { Toaster } from '@/components/borga/Toaster';
import './globals.css';
import jsonMetadata from '../metadata.json';

export const metadata: Metadata = jsonMetadata;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const umamiUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
  const umamiEnabled = !!umamiUrl && umamiUrl.startsWith('http') && !umamiUrl.includes('your-umami-domain');
  // Vercel Web Analytics only resolves on a real Vercel deployment.
  const vercelAnalytics = !!process.env.VERCEL;
  // Analytics scripts need the visitor's consent (signed cookie + GPC override).
  const { choice } = await effectiveConsent().catch(() => ({ choice: null }) as never);
  const allowAnalytics = choice?.choices.analytics === true;

  return (
    <html lang="en">
      <head>
        {umamiEnabled && (
          <AnalyticsGate
            allowAnalytics={allowAnalytics}
            src={umamiUrl}
            websiteId={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
          />
        )}
      </head>
      <body className="antialiased">
        {children}
        <HappySeedsWatermark />
        <AgentationGuard />
        <Toaster />
        {vercelAnalytics && allowAnalytics && <Analytics />}
      </body>
    </html>
  );
}
