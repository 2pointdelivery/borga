// Runs once when the server starts, before it accepts requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `next build` imports routes but must not need production secrets or start loops.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  if (process.env.NODE_ENV === 'production') {
    const { runBootChecks } = await import('./instrumentation-node');
    runBootChecks();
  }

  // Always-on autopilot: the heartbeat beats without a browser tab or external
  // cron. BORGA_AUTOPILOT_OFF=1 turns it off; each workspace's own pause,
  // autonomous-mode and subscription switches still apply per tick.
  if ((process.env.BORGA_AUTOPILOT_OFF ?? '').trim() !== '1') {
    const { startAutopilot } = await import('./lib/borga/autopilot');
    startAutopilot();
  }
}
