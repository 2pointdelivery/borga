'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Boxes, Briefcase, Building2, Loader2, ShieldCheck, Sliders } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  LOGIN_RAILS,
  normalizeLoginRail,
  resolveRailRedirect,
  type LoginRail,
} from '@/lib/auth/login-rails';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';

const RAIL_ICON: Record<LoginRail, typeof Building2> = {
  company: Building2,
  advisor: Briefcase,
  admin: Sliders,
};

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const { setUserName, setActiveWorkspace } = useBorga();
  const isSignup = mode === 'signup';
  const [rail, setRail] = useState<LoginRail>('company');
  const [nextParam, setNextParam] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agencyName, setAgencyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [needsInvite, setNeedsInvite] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const initialNext = q.get('next');
    setNextParam(initialNext);
    setRail(normalizeLoginRail(q.get('role'), initialNext));
    setResetDone(q.get('reset') === '1');

    if (!isSignup) return;
    if (q.get('invite')) setInviteCode(q.get('invite') ?? '');
    if (q.get('email')) setEmail(q.get('email') ?? '');
    fetch('/api/auth/signup', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { mode?: string }) => setNeedsInvite(d.mode === 'invite'))
      .catch(() => undefined);
  }, [isSignup]);

  const activeMeta = LOGIN_RAILS.find((r) => r.id === rail) ?? LOGIN_RAILS[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isSignup
            ? {
                name,
                agencyName: rail === 'advisor' && agencyName.trim() ? agencyName.trim() : undefined,
                email,
                password,
                role: rail,
                next: nextParam ?? undefined,
                inviteCode: inviteCode.trim() || undefined,
              }
            : {
                email,
                password,
                role: rail,
                next: nextParam ?? undefined,
              },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        redirectTo?: string;
        workspaceId?: string;
        user?: { name?: string };
      };
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
      if (data.user?.name) setUserName(data.user.name);
      if (data.workspaceId) setActiveWorkspace(data.workspaceId);
      toast({
        title: isSignup ? 'Account created' : 'Welcome back',
        description: `${isSignup ? 'Registered' : 'Signed in'} on ${activeMeta.label} rail.`,
        variant: 'success',
      });
      const destination = data.redirectTo || resolveRailRedirect(rail, mode, nextParam);
      router.push(destination);
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 opacity-30 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-emerald-500/20 opacity-30 blur-3xl" />
      </div>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur">
        <Link href="/" className="mb-5 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">Borga</span>
        </Link>
        <h1 className="text-center text-2xl font-extrabold tracking-tight">
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {isSignup ? 'Choose your portal rail to get started.' : 'Choose which portal rail you are signing into.'}
        </p>

        {/* Log in as > Rail Switcher */}
        <div className="mt-5 space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isSignup ? 'Sign up as ▸' : 'Log in as ▸'}
          </Label>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border bg-muted/40 p-1">
            {LOGIN_RAILS.map((r) => {
              const Icon = RAIL_ICON[r.id];
              const selected = r.id === rail;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setRail(r.id);
                    setError('');
                  }}
                  className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center text-xs font-medium transition ${
                    selected
                      ? 'bg-background text-foreground shadow-xs ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{r.shortLabel}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-start gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              <strong className="text-foreground">{activeMeta.label}:</strong> {activeMeta.description}
            </span>
          </div>
        </div>

        {resetDone && !isSignup && (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
            Password updated. You can sign in with your new password.
          </div>
        )}

        <form onSubmit={submit} className="mt-5 space-y-4">
          {isSignup && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground">
                {rail === 'advisor' ? 'Your name / Lead Partner' : 'Full name'}
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" autoFocus className="mt-1" />
            </div>
          )}
          {isSignup && rail === 'advisor' && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Agency / Firm name (optional)</Label>
              <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Apex CPA & Advisory" className="mt-1" />
            </div>
          )}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus={!isSignup} className="mt-1" />
          </div>
          {isSignup && needsInvite && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Invite code</Label>
              <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="inv_..." autoComplete="off" className="mt-1 font-mono text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">Signup is by invitation. Use the email address the invite was sent to.</p>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">Password</Label>
              {!isSignup && (
                <Link href="/forgot" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>
              )}
            </div>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isSignup ? 'At least 8 characters' : '••••••••'} autoComplete={isSignup ? 'new-password' : 'current-password'} className="mt-1" />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{error}</div>
          )}

          <Button type="submit" disabled={loading} className="w-full gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {isSignup ? `Create ${activeMeta.shortLabel} Account` : `Sign in to ${activeMeta.label}`}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {isSignup ? (
            <>Already have an account? <Link href={`/login?role=${rail}`} className="font-semibold text-primary hover:underline">Sign in</Link></>
          ) : (
            <>New here? <Link href={`/signup?role=${rail}`} className="font-semibold text-primary hover:underline">Create an account</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
