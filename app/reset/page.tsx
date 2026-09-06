'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Boxes, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast-bus';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('Missing reset token. Use the link from your email.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not reset password.');
        setLoading(false);
        return;
      }
      setDone(true);
      setLoading(false);
      toast({ title: 'Password updated', description: 'You can now sign in with your new password.', variant: 'success' });
      setTimeout(() => router.push('/login?reset=1'), 1200);
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

        {!done ? (
          <>
            <h1 className="text-center text-2xl font-extrabold tracking-tight">Choose a new password</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Enter a new password for your account.
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">New password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" autoFocus className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Confirm password</Label>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" className="mt-1" />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{error}</div>
              )}

              <Button type="submit" disabled={loading} className="w-full gap-1.5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Reset password
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Password updated</h1>
              <p className="mt-1 text-sm text-muted-foreground">Redirecting you to sign in…</p>
            </div>
          </>
        )}

        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
