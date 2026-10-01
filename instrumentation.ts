// Runs once when the server starts, before it accepts requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV !== 'production') return;
  // `next build` imports routes but must not need production secrets.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { runBootChecks } = await import('./instrumentation-node');
  runBootChecks();
}
