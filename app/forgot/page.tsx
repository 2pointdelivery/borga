'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/lib/toast-bus';

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong.');
        setLoading(false);
        return;
      }
      setSent(true);
      if (data.devResetUrl) setDevResetUrl(data.devResetUrl);
      toast({ title: 'Reset link sent', description: 'If that email exists, a reset link is on its way.', variant: 'success' });
      setLoading(false);
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

        {!sent ? (
          <>
            <h1 className="text-center text-2xl font-extrabold tracking-tight">Reset your password</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              Enter the email on your account and we&apos;ll send a reset link.
            </p>

            <form onSubmit={submit} className="mt-7 space-y-4">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus className="mt-1" />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{error}</div>
              )}

              <Button type="submit" disabled={loading} className="w-full gap-1.5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Send reset link
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-center text-2xl font-extrabold tracking-tight">Check your inbox</h1>
            <p className="mt-1 text-center text-sm text-muted-foreground">
              If an account exists for that email, a reset link is on its way.
            </p>
            {devResetUrl && (
              <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700">
                <p className="font-medium">Email isn&apos;t configured yet.</p>
                <p className="mt-1 text-amber-600/90">
                  Open this dev link to continue:{' '}
                  <Link href={devResetUrl} className="font-semibold underline break-all">{devResetUrl}</Link>
                </p>
              </div>
            )}
          </>
        )}

        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}

export default ForgotForm;
