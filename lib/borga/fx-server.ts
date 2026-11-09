import 'server-only';
import { setBorgaState, listBorgaKeys } from './persistence';
import { userWsKey } from './keys';
import { fetchPublic, readTextCapped } from './safe-url';
import { parseBocValetJson, parseEcbXml, type FxRates } from './fx';

/** Bank of Canada Valet API — Daily Exchange Rates group (`https://www.bankofcanada.ca/rates/exchange/`). */
export const BOC_VALET_URL = 'https://www.bankofcanada.ca/valet/observations/group/FX_RATES_DAILY/json?recent=1';
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/**
 * Refresh the workspace FX table from the Bank of Canada Valet API (free, no key, official daily rates),
 * falling back to ECB reference rates only if Bank of Canada is temporarily unreachable.
 */
export async function refreshFx(): Promise<FxRates> {
  try {
    const res = await fetchPublic(BOC_VALET_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Bank of Canada API answered HTTP ${res.status}`);
    const body = await readTextCapped(res, 250_000);
    return parseBocValetJson(body);
  } catch (bocErr) {
    try {
      const res = await fetchPublic(ECB_URL, { signal: AbortSignal.timeout(12_000) });
      if (res.ok) return parseEcbXml(await readTextCapped(res, 200_000));
    } catch {
      // Throw original Bank of Canada error below
    }
    throw bocErr instanceof Error ? bocErr : new Error('Bank of Canada FX API unreachable.');
  }
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
