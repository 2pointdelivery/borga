/**
 * Client-supplied privilege fields are dropped before anything is saved.
 *
 * Operator rights come from the signed session and BORGA_OPERATOR_EMAILS, and
 * billing entitlement is computed server-side — never from a payload. These
 * keys do not exist in the stored types; accepting them would let a crafted
 * save create fields that a later reader might trust. Stripping is the cheap
 * belt to that suspenders.
 */

import type { WorkspacePlan } from './data';

const ALWAYS_STRIP = new Set(['role', 'ispro', 'isoperator', 'comped', 'billing', 'entitlements', 'permissions', 'admin', 'superuser']);

/**
 * Every plan the product actually offers, tied to the `WorkspacePlan` union:
 * adding a member to the type without listing it here — or listing something
 * that is not a plan — fails typecheck, so the two cannot drift apart.
 * Workspace creation seeds `trial`, so dropping an unlisted real plan would
 * silently erase it on the first save.
 */
export const WORKSPACE_PLANS = {
  trial: true,
  growth: true,
  scale: true,
  enterprise: true,
} satisfies Record<WorkspacePlan, true>;

export function isWorkspacePlan(value: unknown): value is WorkspacePlan {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WORKSPACE_PLANS, value);
}

function scrub(value: unknown, depth: number): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (ALWAYS_STRIP.has(k.toLowerCase())) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

export function stripClientPrivileges(entity: string, value: unknown): unknown {
  if (entity !== 'workspaces' && entity !== 'settings') return value;
  const clean = scrub(value, 0);
  if (entity === 'settings' && clean && typeof clean === 'object' && !Array.isArray(clean)) {
    // Settings has no plan or pro flag; a payload claiming one is an entitlement
    // assertion, not configuration, so it never reaches storage.
    delete (clean as Record<string, unknown>).plan;
    delete (clean as Record<string, unknown>).isPro;
  }
  if (entity === 'workspaces' && Array.isArray(clean)) {
    for (const w of clean) {
      if (!w || typeof w !== 'object') continue;
      const ws = w as Record<string, unknown>;
      // Legitimate plans are preserved exactly as the model defines them. An
      // unknown value is not a plan the product offers, so it is dropped
      // deliberately rather than stored and trusted by a reader later.
      if (ws.plan !== undefined && !isWorkspacePlan(ws.plan)) delete ws.plan;
    }
  }
  return clean;
}
