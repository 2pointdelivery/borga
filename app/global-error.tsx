'use client';

import { useEffect } from 'react';

/**
 * Catches errors thrown by the root layout itself — the one place app/error.tsx
 * (scoped to app/app/) can't reach. Must render its own <html>/<body> since it
 * replaces the root layout when it fires. Inline styles only: globals.css may
 * not have loaded if the failure happened this early.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch('/api/diag', {
      method: 'POST',
      body: `boundary(global): ${error?.stack || error?.message || 'unknown'}`,
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#f5f5f5' }}>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
          <div style={{ maxWidth: 640, borderRadius: 12, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', padding: 24 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f87171', margin: 0 }}>Borga failed to load</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: '#a3a3a3' }}>{error?.message ?? 'An unexpected error occurred.'}</p>
            <button
              onClick={reset}
              style={{ marginTop: 16, borderRadius: 8, background: '#6366f1', color: '#fff', padding: '8px 16px', fontSize: 14, fontWeight: 500, border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
