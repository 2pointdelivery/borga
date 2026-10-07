import Link from 'next/link';
import { Boxes, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Borga API & Developers',
  description: 'Public REST API, webhooks, API keys and feature requests for the Borga AI Company OS.',
};

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

function Endpoint({ method, path, children }: { method: 'GET' | 'POST'; path: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${method === 'GET' ? 'bg-sky-500/10 text-sky-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{method}</span>
        <span className="break-all">{path}</span>
      </p>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

const SECTIONS = [
  { id: 'auth', label: 'Authentication' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'keys', label: 'API keys' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'requests', label: 'Feature requests' },
];

export default function DevelopersDocs() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <Boxes className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">Borga <span className="font-normal text-muted-foreground">/ Developers</span></span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/login" className="text-muted-foreground transition-colors hover:text-foreground">Sign in</Link>
          <Link href="/signup" className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground shadow transition hover:opacity-90">
            Get started
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-24">
        <h1 className="mt-8 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">Build on the company OS.</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Read and write your pipeline, customers, tickets and invoices over a small REST API, get signed
          HTTPS callbacks for engine events, and manage it all from the dashboard under Developers.
        </p>
        <nav className="mt-6 flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground">
              {s.label}
            </a>
          ))}
        </nav>

        <section id="auth" className="mt-12 scroll-mt-6">
          <h2 className="text-2xl font-bold tracking-tight">Authentication</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Every <code className="font-mono text-xs">/api/v1</code> call needs a workspace and a credential. Pass the
            workspace as <code className="font-mono text-xs">?ws=WORKSPACE_ID</code> (shown next to each workspace when you
            create a key). Authenticate with a Bearer API key — or, from a logged-in browser, your session cookie works too.
          </p>
          <div className="mt-4"><Code>{`curl "https://YOUR_HOST/api/v1/leads?ws=YOUR_WS_ID" \\
  -H "Authorization: Bearer borga_YOUR_KEY"`}</Code></div>
          <p className="mt-3 text-sm text-muted-foreground">
            Error responses always look like <code className="font-mono text-xs">{'{"ok": false, "error": "..."}'}</code> with
            HTTP <code className="font-mono text-xs">400</code> (bad input or workspace outside the key&apos;s scope),{' '}
            <code className="font-mono text-xs">401</code> (missing/invalid credential), <code className="font-mono text-xs">403</code> (a
            session-cookie write without the <code className="font-mono text-xs">X-Borga-Client: borga-dashboard</code> header — API keys are exempt),{' '}
            <code className="font-mono text-xs">404</code> (not found or already revoked) or <code className="font-mono text-xs">500</code> (server could not complete the write).
          </p>
        </section>

        <section id="endpoints" className="mt-12 scroll-mt-6">
          <h2 className="text-2xl font-bold tracking-tight">Endpoints</h2>
          <p className="mt-2 text-sm text-muted-foreground">Versioned under <code className="font-mono text-xs">/api/v1</code>. Lists return up to 100 items.</p>
          <div className="mt-4 grid gap-4">
            <Endpoint method="GET" path="/api/v1/leads?ws=…">
              <p>List pipeline leads (newest writes first).</p>
              <Code>{'{"ok": true, "leads": [{"id": "l-…", "name": "Ada", "company": "Acme", "email": "", "phone": "", "value": 5000, "stage": "new", "source": "API", "priority": "P2"}]}'}</Code>
            </Endpoint>
            <Endpoint method="POST" path="/api/v1/leads?ws=…">
              <p><code className="font-mono text-xs">name</code> is required. <code className="font-mono text-xs">stage</code> is one of new, qualified, proposal, won, lost (default new); <code className="font-mono text-xs">priority</code> is P0–P3 (default P2).</p>
              <Code>{`curl -X POST "https://YOUR_HOST/api/v1/leads?ws=YOUR_WS_ID" \\
  -H "Authorization: Bearer borga_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Ada", "company": "Acme", "email": "ada@acme.test", "value": 5000}'`}</Code>
            </Endpoint>
            <Endpoint method="GET" path="/api/v1/customers?ws=…">
              <p>List customer accounts: id, name, industry, email, phone, city, country, status, owner.</p>
            </Endpoint>
            <Endpoint method="GET" path="/api/v1/tickets?ws=…&status=open">
              <p>List support tickets (optional <code className="font-mono text-xs">status</code> filter). Requires the Support Desk feature.</p>
            </Endpoint>
            <Endpoint method="POST" path="/api/v1/tickets?ws=…">
              <p><code className="font-mono text-xs">subject</code> is required. <code className="font-mono text-xs">type</code> is incident, request, bug, task or question; <code className="font-mono text-xs">priority</code> is critical, high, medium or low. Tickets open in status <code className="font-mono text-xs">open</code> with SLA clocks running.</p>
              <Code>{`curl -X POST "https://YOUR_HOST/api/v1/tickets?ws=YOUR_WS_ID" \\
  -H "Authorization: Bearer borga_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"subject": "Printer down", "priority": "high", "requesterEmail": "ops@acme.test"}'`}</Code>
            </Endpoint>
            <Endpoint method="GET" path="/api/v1/invoices?ws=…&status=sent">
              <p>List non-voided invoices (optional <code className="font-mono text-xs">status</code> filter): id, number, client, amount, status, issued, due.</p>
            </Endpoint>
          </div>
        </section>

        <section id="keys" className="mt-12 scroll-mt-6">
          <h2 className="text-2xl font-bold tracking-tight">API keys</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create keys in the dashboard under <strong>Developers → API Keys</strong>. Each key is scoped to the
            workspaces you tick (unticked means every workspace you own). The secret starts with{' '}
            <code className="font-mono text-xs">borga_</code>, is shown <strong>exactly once</strong>, and is stored
            hashed — it can never be read back. Revoking takes effect immediately, and every call updates the key&apos;s
            last-used timestamp so stale keys are easy to spot.
          </p>
        </section>

        <section id="webhooks" className="mt-12 scroll-mt-6">
          <h2 className="text-2xl font-bold tracking-tight">Webhooks</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Subscribe an HTTPS endpoint to engine events under <strong>Developers → Webhooks</strong> (or Company → Company
            Engine). Send a test delivery any time; recent deliveries and their status stay visible in the dashboard.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {['booking.created', 'booking.updated', 'booking.delivered', 'driver.onboarded', 'client.created', 'sla.breached', 'tracking.updated', 'payment.received'].map((e) => (
              <code key={e} className="rounded-lg border border-border bg-card/50 px-3 py-2 font-mono text-xs">{e}</code>
            ))}
          </div>
          <h3 className="mt-6 font-semibold">Delivery contract</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li><code className="font-mono text-xs">POST</code> JSON to your URL with <code className="font-mono text-xs">User-Agent: Borga-Webhook/1.0</code>.</li>
            <li>Headers: <code className="font-mono text-xs">X-Borga-Event</code> (the event id), <code className="font-mono text-xs">X-Borga-Delivery-ID</code>, <code className="font-mono text-xs">X-Borga-Timestamp</code>, and — when you set a signing secret — <code className="font-mono text-xs">X-Borga-Signature: sha256=…</code> (HMAC-SHA256 of the raw body).</li>
            <li>Only public HTTPS URLs are called — loopback and private ranges are refused.</li>
            <li>Failed deliveries retry twice (after ~5s and ~15s); anything still not 2xx after 3 attempts counts as failed.</li>
          </ul>
          <div className="mt-4"><Code>{`import { createHmac, timingSafeEqual } from 'crypto';

const sig = req.headers['x-borga-signature']; // "sha256=…"
const expected = 'sha256=' + createHmac('sha256', process.env.WEBHOOK_SECRET)
  .update(rawBodyBuffer).digest('hex');
const valid = sig?.length === expected.length &&
  timingSafeEqual(Buffer.from(sig), Buffer.from(expected));`}</Code></div>
        </section>

        <section id="requests" className="mt-12 scroll-mt-6">
          <h2 className="text-2xl font-bold tracking-tight">Request a feature</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Signed-in owners can ask for product improvements under <strong>Developers → Feature Requests</strong> in the
            dashboard. Good requests name the job, not just the button — tell us what you are trying to do and what
            happens today instead.
          </p>
          <Link href="/signup" className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:opacity-90">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
        </section>

        <p className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          Fair use applies to the public API — automate sensibly and cache list responses. Borga — AI Company OS.
        </p>
      </div>
    </main>
  );
}
