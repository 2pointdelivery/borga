import { checkBootEnv } from './lib/borga/boot-checks';

/** Node-only startup work. Exits non-zero so Docker/systemd see a crash instead of a half-working server. */
export function runBootChecks(): void {
  const { errors, warnings } = checkBootEnv(process.env);
  for (const w of warnings) console.warn(`[borga boot] warning: ${w}`);
  if (errors.length) {
    console.error(`[borga boot] Refusing to start in production:\n - ${errors.join('\n - ')}`);
    process.exit(1);
  }
}
