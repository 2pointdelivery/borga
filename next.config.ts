import type { NextConfig } from 'next';
import dotenv from 'dotenv';

// Load .env into process.env (dotenv.populate is used internally to inject)
dotenv.config({ path: '.env', override: true });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {},
  typescript: {
    ignoreBuildErrors: false,
  },
  env: {
    PROJECT_ID: process.env.HAPPYSEEDS_PROJECT_ID ?? '',
    REACTUS_BASE_URL: process.env.REACTUS_BASE_URL ?? '',
  },
  serverExternalPackages: [],
  // Dev-only origin allow-list for the preview panel (not applied in production).
  allowedDevOrigins: [
    '**.*.*',
  ],
  async headers() {
    const isDev = process.env.NODE_ENV === 'development';

    // Allow a configured Umami analytics host in the CSP (only when set).
    let umamiHost = '';
    try {
      const u = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
      if (u && u.startsWith('http') && !u.includes('your-umami-domain')) {
        umamiHost = new URL(u).host;
      }
    } catch {
      umamiHost = '';
    }
    // Vercel Web Analytics is only present on real Vercel deployments.
    const vercelAnalytics = !!process.env.VERCEL;
    const scriptExtra = [
      umamiHost ? `https://${umamiHost}` : '',
      vercelAnalytics ? 'https://va.vercel-analytics.com https://*.vercel-insights.com' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const connectExtra = [
      umamiHost ? `https://${umamiHost}` : '',
      vercelAnalytics ? 'https://va.vercel-analytics.com https://*.vercel-insights.com' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=()' },
          { key: 'X-XSS-Protection', value: '0' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-eval' is required by Turbopack/Next.js in development; removed in production.
              isDev
                ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${scriptExtra}`.trim()
                : `script-src 'self' 'unsafe-inline' ${scriptExtra}`.trim(),
              "style-src 'self' 'unsafe-inline'",
              // happyseeds.ai required for the watermark logo image.
              "img-src 'self' data: blob: https://happyseeds.ai https://*.happyseeds.ai",
              "font-src 'self' data:",
              // *.happyseeds.ai required for the watermark API; 2pointlogistics.com for the engine API.
              // Composio calls are proxied through our own API routes, so no direct browser→composio connection needed.
              `connect-src 'self' https://2pointlogistics.com https://*.happyseeds.ai ${connectExtra}`.trim(),
              "object-src 'none'",
              "base-uri 'self'",
              // No other site may frame the app (clickjacking), and forms may only post back to it.
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
