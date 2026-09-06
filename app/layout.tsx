import type { Metadata } from 'next';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { AgentationGuard } from '@/components/AgentationGuard';
import { HappySeedsWatermark } from '@/components/HappySeedsWatermark';
import { Toaster } from '@/components/borga/Toaster';
import './globals.css';
import jsonMetadata from '../metadata.json';

export const metadata: Metadata = jsonMetadata;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const umamiUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
  const umamiEnabled = !!umamiUrl && umamiUrl.startsWith('http') && !umamiUrl.includes('your-umami-domain');
  // Vercel Web Analytics only resolves on a real Vercel deployment.
  const vercelAnalytics = !!process.env.VERCEL;

  return (
    <html lang="en">
      <head>
        {umamiEnabled && (
          <Script
            async
            src={umamiUrl}
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
          />
        )}
      </head>
      <body className="antialiased">
        {children}
        <HappySeedsWatermark />
        <AgentationGuard />
        <Toaster />
        {vercelAnalytics && <Analytics />}
      </body>
    </html>
  );
}
