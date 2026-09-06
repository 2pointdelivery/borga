'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const { setUserName, setActiveWorkspace } = useBorga();
  const isSignup = mode === 'signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const resetDone = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reset') === '1';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isSignup ? { name, email, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
      // Scope the store to the real user identity and their workspace immediately,
      // so the greeting uses the user's name and onboarding targets the right company.
      if (data.user?.name) setUserName(data.user.name);
      if (data.workspaceId) setActiveWorkspace(data.workspaceId);
      toast({
        title: isSignup ? 'Account created' : 'Welcome back',
        description: isSignup ? 'Your Borga workspace is ready.' : `Signed in as ${data.user?.name || email}.`,
        variant: 'success',
      });
      const next = new URLSearchParams(window.location.search).get('next');
      if (isSignup) router.push(next || '/app/onboarding?step=profile');
      else router.push(next || '/app');
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/20 opacity-30 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-emerald-500/20 opacity-30 blur-3xl" />
      </div>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">Borga</span>
        </Link>
        <h1 className="text-center text-2xl font-extrabold tracking-tight">
          {isSignup ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {isSignup ? 'Spin up your first company workspace.' : 'Sign in to your company OS.'}
        </p>

        {resetDone && !isSignup && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
            Password updated. You can sign in with your new password.
          </div>
        )}

        <form onSubmit={submit} className="mt-7 space-y-4">
          {isSignup && (
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" autoFocus className="mt-1" />
            </div>
          )}
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus={!isSignup} className="mt-1" />
          </div>
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
            {isSignup ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {isSignup ? (
            <>Already have an account? <Link href="/login" className="font-semibold text-primary hover:underline">Sign in</Link></>
          ) : (
            <>New here? <Link href="/signup" className="font-semibold text-primary hover:underline">Create an account</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
