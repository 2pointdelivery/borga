'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Boxes, Check, FileText, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Login-free customer portal: one token, one account — its invoices and
 * quotes, nothing else. No dashboard chrome, no session, no navigation out.
 */

interface QuoteView {
  id: string;
  number: string;
  total: number;
  status: string;
  validUntil: string;
  acceptable: boolean;
  lines: Array<{ label: string; qty: number; unitPrice: number }>;
}

interface PortalState {
  company: string;
  customer: string;
  invoices: Array<{ id: string; number: string; amount: number; status: string; issued: string; due: string }>;
  quotes: QuoteView[];
}

export default function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [s, setS] = useState<(PortalState & { ok: true }) | { ok: false; error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/borga/portal/${encodeURIComponent(token)}`, { cache: 'no-store' });
      setS(await r.json());
    } catch {
      setS({ ok: false, error: 'Could not load this portal. Check your connection.' });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (q: QuoteView) => {
    if (!window.confirm(`Accept quote ${q.number} for ${q.total}? This tells ${s && 'company' in s ? s.company : 'your vendor'} to start the work.`)) return;
    setBusy(q.id);
    try {
      const r = await fetch(`/api/borga/portal/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', quoteId: q.id }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      setMsg(j.ok ? 'Accepted — thank you. Your vendor has been notified.' : `Could not accept: ${j.error ?? 'unknown error'}`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-5 pb-20">
        <header className="flex items-center gap-2 py-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            {s && s.ok ? s.company : 'Borga'} <span className="font-normal text-muted-foreground">/ Client portal</span>
          </span>
        </header>

        {!s && <p className="text-sm text-muted-foreground">Loading…</p>}
        {s && !s.ok && (
          <Card className="p-8 text-center">
            <p className="text-sm font-medium">This link did not work</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.error} Ask your vendor for a fresh portal link.</p>
          </Card>
        )}
        {s && s.ok && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold">Hello, {s.customer}</h1>
              <p className="mt-1 text-sm text-muted-foreground">Your invoices and quotes with {s.company}, in one place.</p>
            </div>
            {msg && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{msg}</p>}

            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-4 w-4 text-primary" /> Invoices ({s.invoices.length})</h2>
              {s.invoices.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No invoices yet.</p>}
              <div className="mt-2 space-y-2">
                {s.invoices.map((i) => (
                  <Card key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-semibold">{i.number}</p>
                      <p className="text-xs text-muted-foreground">Issued {i.issued} · due {i.due}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={i.status === 'paid' ? 'secondary' : 'outline'}>{i.status}</Badge>
                      <p className="text-sm font-bold">{i.amount}</p>
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-primary" /> Quotes ({s.quotes.length})</h2>
              {s.quotes.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No quotes yet.</p>}
              <div className="mt-2 space-y-2">
                {s.quotes.map((q) => (
                  <Card key={q.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{q.number}</p>
                        <p className="text-xs text-muted-foreground">{q.status} · valid until {q.validUntil}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold">{q.total}</p>
                        {q.acceptable && (
                          <Button size="sm" className="gap-1" disabled={busy === q.id} onClick={() => void accept(q)}>
                            <Check className="h-3.5 w-3.5" /> {busy === q.id ? 'Accepting…' : 'Accept'}
                          </Button>
                        )}
                      </div>
                    </div>
                    <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                      {q.lines.map((l, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="truncate">{l.label} × {l.qty}</span>
                          <span>{l.unitPrice}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ))}
              </div>
            </section>

            <p className="text-center text-[11px] text-muted-foreground">
              Private link for {s.customer} — do not share it. Powered by <Link href="/" className="underline">Borga</Link>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
