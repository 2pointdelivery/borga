/**
 * Guarded authentication rails ("Log in as >"):
 *   - company : Company Workspace (/app)
 *   - advisor : Shared Services Advisor & Agency Portal (/services)
 *   - admin   : Deployment System Administrator (/admin)
 *
 * Pure rules (no I/O) shared by the login/signup UI, the auth API routes, and tests.
 */

export type LoginRail = 'company' | 'advisor' | 'admin';

export interface LoginRailMeta {
  id: LoginRail;
  label: string;
  shortLabel: string;
  description: string;
  defaultLoginPath: string;
  defaultSignupPath: string;
}

export const LOGIN_RAILS: readonly LoginRailMeta[] = [
  {
    id: 'company',
    label: 'Company Workspace',
    shortLabel: 'Company',
    description: 'Manage your clients, pipeline, projects, accounting, and AI agents ($2/user/mo).',
    defaultLoginPath: '/app',
    defaultSignupPath: '/app/onboarding?step=profile',
  },
  {
    id: 'advisor',
    label: 'Advisor & Agency Portal',
    shortLabel: 'Advisor / Agency',
    description: 'Take discovery calls, send proposals or packages, and work inside client workspaces (85/15 split).',
    defaultLoginPath: '/services',
    defaultSignupPath: '/services',
  },
  {
    id: 'admin',
    label: 'System Administrator',
    shortLabel: 'Admin',
    description: 'Configure platform pricing, feature flags, advisor vetting, and company analytics.',
    defaultLoginPath: '/admin',
    defaultSignupPath: '/admin',
  },
] as const;

export function isLoginRail(v: unknown): v is LoginRail {
  return v === 'company' || v === 'advisor' || v === 'admin';
}

/** Resolves the active login rail from an explicit role choice or the `?next=` destination path. */
export function normalizeLoginRail(rawRole?: unknown, nextPath?: unknown): LoginRail {
  if (isLoginRail(rawRole)) return rawRole;
  if (typeof nextPath === 'string') {
    const clean = nextPath.trim();
    if (clean === '/admin' || clean.startsWith('/admin/') || clean.startsWith('/admin?')) return 'admin';
    if (clean === '/services' || clean.startsWith('/services/') || clean.startsWith('/services?')) return 'advisor';
  }
  return 'company';
}

/**
 * Ensures the post-login redirect stays on a safe internal path matching the guarded rail.
 * Blocks open redirects (`//evil.com`, `https://...`) and cross-rail mismatches.
 */
export function resolveRailRedirect(
  rail: LoginRail,
  mode: 'login' | 'signup',
  rawNext?: unknown,
): string {
  const meta = LOGIN_RAILS.find((r) => r.id === rail) ?? LOGIN_RAILS[0];
  const fallback = mode === 'signup' ? meta.defaultSignupPath : meta.defaultLoginPath;
  if (typeof rawNext !== 'string' || !rawNext.trim()) return fallback;
  const next = rawNext.trim();
  if (!next.startsWith('/') || next.startsWith('//') || /[\r\n\\]/.test(next)) return fallback;

  if (rail === 'admin') {
    return next === '/admin' || next.startsWith('/admin/') || next.startsWith('/admin?') ? next : fallback;
  }
  if (rail === 'advisor') {
    return next === '/services' || next.startsWith('/services/') || next.startsWith('/services?') ? next : fallback;
  }
  return next === '/app' || next.startsWith('/app/') || next.startsWith('/app?') ? next : fallback;
}

export type RailGuardResult =
  | { allowed: true }
  | { allowed: false; status: number; error: string };

/**
 * Enforces role eligibility before a session is granted on a specific login rail:
 * - `admin` rail requires `isOperator === true` (listed in BORGA_OPERATOR_EMAILS).
 * - `advisor` rail refuses profiles that have been rejected or suspended by an administrator.
 * - `company` rail is open to any valid account.
 */
export function evaluateLoginRailGuard(input: {
  rail: LoginRail;
  isOperator: boolean;
  advisorStatus?: 'pending' | 'approved' | 'rejected' | 'suspended' | null;
}): RailGuardResult {
  if (input.rail === 'admin') {
    if (!input.isOperator) {
      return {
        allowed: false,
        status: 403,
        error: 'Access denied: this account is not an authorized System Administrator.',
      };
    }
    return { allowed: true };
  }

  if (input.rail === 'advisor') {
    if (input.advisorStatus === 'rejected' || input.advisorStatus === 'suspended') {
      return {
        allowed: false,
        status: 403,
        error: `Access denied: your advisor account is ${input.advisorStatus}. Contact the platform administrator.`,
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
