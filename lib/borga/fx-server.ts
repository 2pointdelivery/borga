import 'server-only';
import { setBorgaState, listBorgaKeys } from './persistence';
import { userWsKey } from './keys';
import { fetchPublic, readTextCapped } from './safe-url';
import { parseEcbXml, type FxRates } from './fx';

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** Refresh the workspace FX table from the ECB euro reference rates (free, no key, fixed host). */
export async function refreshFx(): Promise<FxRates> {
  const res = await fetchPublic(ECB_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ECB answered ${res.status}`);
  return parseEcbXml(await readTextCapped(res, 200_000));
}

/** Daily cron: refresh every workspace's FX table that has one (best-effort per workspace). */
export async function sweepFxRates(): Promise<Record<string, unknown>> {
  const done: Record<string, unknown> = {};
  for (const k of await listBorgaKeys('u::%::ws::%::fxRates').catch(() => [] as string[])) {
    const m = /^u::([^:]+)::ws::([^:]+)::fxRates$/.exec(k);
    if (!m) continue;
    try {
      await setBorgaState(userWsKey(m[1], m[2], 'fxRates'), await refreshFx());
      done[`${m[1]}/${m[2]}`] = { refreshed: true };
    } catch (e) {
      done[`${m[1]}/${m[2]}`] = { ok: false, error: (e as Error).message };
    }
  }
  return done;
}
