import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey, isValidUserId, isValidWsId } from './keys';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { invalidateSmContext } from './sm-cache';
import { parseEnvOff, resolveFeatures, type FeatureId, type FeatureOverrides, type ResolvedFeatures } from './features';

export function featuresKey(userId: string, ws: string): string {
  return userWsKey(userId, ws, 'features');
}

export async function loadFeatures(userId: string, ws: string): Promise<ResolvedFeatures> {
  const stored = await getBorgaState<FeatureOverrides>(featuresKey(userId, ws));
  return resolveFeatures(stored, parseEnvOff(process.env.BORGA_FEATURES_OFF));
}

export async function setFeatureOverride(userId: string, ws: string, id: FeatureId, enabled: boolean): Promise<boolean> {
  const stored = (await getBorgaState<FeatureOverrides>(featuresKey(userId, ws))) ?? {};
  const ok = await setBorgaState(featuresKey(userId, ws), { ...stored, [id]: enabled });
  if (id === 'supermemory') invalidateSmContext(userId, ws); // after the write, so a concurrent read cannot re-cache the old value
  return ok;
}

export async function sessionUserId(req: NextRequest): Promise<string | null> {
  const token = req.cookies.get(sessionCookieName())?.value;
  const uid = await verifySessionToken(token);
  return uid && isValidUserId(uid) ? uid : null;
}

/**
 * Route guard: returns a 404 response when the feature is switched off for the
 * workspace (or the deployment), otherwise null. A missing/invalid ws skips the
 * workspace lookup and only honours the deployment-level kill list.
 */
export async function featureGate(id: FeatureId, userId: string | null, ws: string | null | undefined): Promise<NextResponse | null> {
  const off = userId && isValidWsId(ws)
    ? !(await loadFeatures(userId, ws)).flags[id]
    : parseEnvOff(process.env.BORGA_FEATURES_OFF).includes(id);
  return off ? NextResponse.json({ ok: false, error: `Feature "${id}" is turned off.` }, { status: 404 }) : null;
}
