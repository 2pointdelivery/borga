'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch('/api/diag', {
      method: 'POST',
      body: `boundary(app): ${error?.stack || error?.message || 'unknown'}`,
      keepalive: true,
    }).catch(() => {});
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
      <div className="max-w-2xl rounded-xl border border-red-500/30 bg-red-500/5 p-6">
        <h1 className="text-lg font-bold text-red-600">Something went wrong in the dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error?.message}</p>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/80 p-3 text-xs text-red-300">
          {error?.stack}
        </pre>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
