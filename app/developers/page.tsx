import Link from 'next/link';
import { Boxes, ArrowRight, FileCode2, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import {
  BORGA_API_RELEASE_DATE,
  BORGA_API_VERSION,
  BORGA_OPENAPI_SEMVER,
  V1_ENDPOINT_CATALOG,
  type ApiEndpointDoc,
} from '@/lib/borga/openapi-spec';

export const metadata: Metadata = {
  title: `Borga API (${BORGA_API_VERSION}) & Developers`,
  description: `Versioned REST API (${BORGA_API_VERSION}, OpenAPI 3.1.0 v${BORGA_OPENAPI_SEMVER}), webhooks, API keys, and client portal for the Borga AI Company OS.`,
};

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border/85 bg-muted/35 p-3.5 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

function Endpoint({ ep }: { ep: ApiEndpointDoc }) {
  const qs = ep.queryParams.map((p) => `${p.name}=…`).join('&');
  const fullPath = `${ep.path}${qs ? `?${qs}` : ''}`;
  const methodStyle =
    ep.method === 'GET'
      ? 'bg-sky-500/10 text-sky-600 ring-sky-500/25'
      : ep.method === 'PATCH'
        ? 'bg-amber-500/10 text-amber-600 ring-amber-500/25'
        : 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/25';

  return (
    <div className="rounded-xl border border-border/85 bg-card p-5 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 font-mono text-sm">
          <span className={`rounded px-2 py-0.5 text-xs font-bold ring-1 ring-inset ${methodStyle}`}>
            {ep.method}
          </span>
          <span className="break-all font-semibold text-foreground">{fullPath}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-border/80 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {ep.tag}
          </span>
          {ep.featureFlag && (
            <span className="rounded border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
              flag: {ep.featureFlag}
            </span>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">{ep.summary}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ep.description}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {ep.requestExample ? (
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Request Payload
            </p>
            <Code>{JSON.stringify(ep.requestExample, null, 2)}</Code>
          </div>
        ) : null}
        <div className={ep.requestExample ? '' : 'lg:col-span-2'}>
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Response Example
          </p>
          <Code>{JSON.stringify(ep.responseExample, null, 2)}</Code>
        </div>
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: 'versioning', label: 'Versioning & OpenAPI' },
  { id: 'auth', label: 'Authentication' },
  { id: 'endpoints', label: `Endpoints (${V1_ENDPOINT_CATALOG.length})` },
  { id: 'keys', label: 'API Keys' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'portal', label: 'Client Portal' },
  { id: 'requests', label: 'Feature Requests' },
];

export default function DevelopersDocs() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-border/75 px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="text-base font-bold tracking-tight">
            Borga <span className="font-normal text-muted-foreground">/ Developers</span>
          </span>
          <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {BORGA_API_VERSION} · v{BORGA_OPENAPI_SEMVER}
          </span>
        </Link>
        <div className="flex items-center gap-3 text-xs font-medium">
          <Link
            href="/api/v1/openapi"
            className="inline-flex items-center gap-1 rounded-md border border-border/85 bg-card px-2.5 py-1.5 text-foreground shadow-2xs hover:bg-muted"
          >
            <FileCode2 className="h-3.5 w-3.5 text-primary" /> OpenAPI 3.1 JSON
          </Link>
          <Link href="/login" className="text-muted-foreground transition-colors hover:text-foreground">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-primary px-3.5 py-1.5 font-semibold text-primary-foreground shadow-2xs transition hover:opacity-90"
          >
            Get started
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 pb-24">
        <h1 className="mt-10 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
          Build on the Borga Company OS.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Read and write your pipeline leads, customers, quotes, invoices, vendor bills, purchase orders, inventory,
          projects, support tickets, cap table, payroll runs, knowledge base, shared services, and outbound communications
          over our versioned REST API (<code className="font-mono text-xs">/api/{BORGA_API_VERSION}</code>).
        </p>

        <nav className="mt-6 flex flex-wrap gap-1.5">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-md border border-border/85 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-2xs transition hover:border-primary hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Versioning & OpenAPI */}
        <section id="versioning" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">API Versioning &amp; OpenAPI 3.1 Specification</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            All public REST endpoints are explicitly versioned under the URL prefix{' '}
            <code className="font-mono text-xs">/api/{BORGA_API_VERSION}</code> (current specification release:{' '}
            <code className="font-mono text-xs">
              {BORGA_OPENAPI_SEMVER} · {BORGA_API_RELEASE_DATE}
            </code>
            ). Every response from <code className="font-mono text-xs">{`/api/${BORGA_API_VERSION}/*`}</code> includes the{' '}
            <code className="font-mono text-xs">
              X-Borga-API-Version: {BORGA_API_VERSION} ({BORGA_OPENAPI_SEMVER})
            </code>{' '}
            header.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/api/v1/openapi"
              className="inline-flex items-center gap-1.5 rounded-md border border-border/85 bg-card px-3.5 py-2 text-xs font-semibold shadow-2xs hover:bg-muted"
            >
              <FileCode2 className="h-4 w-4 text-primary" /> View OpenAPI 3.1.0 Spec (/api/v1/openapi)
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </Link>
            <Link
              href="/api/v1"
              className="inline-flex items-center gap-1.5 rounded-md border border-border/85 bg-card px-3.5 py-2 text-xs font-semibold shadow-2xs hover:bg-muted"
            >
              API Discovery Index (/api/v1)
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </Link>
          </div>
        </section>

        {/* Authentication */}
        <section id="auth" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">Authentication</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Every workspace-scoped <code className="font-mono text-xs">/api/v1</code> call requires{' '}
            <code className="font-mono text-xs">?ws=WORKSPACE_ID</code> and either a Bearer API key (
            <code className="font-mono text-xs">Authorization: Bearer borga_YOUR_KEY</code>) or a signed browser session
            cookie.
          </p>
          <div className="mt-4">
            <Code>{`curl "https://YOUR_HOST/api/v1/leads?ws=YOUR_WS_ID" \\
  -H "Authorization: Bearer borga_YOUR_KEY"`}</Code>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Error responses follow a consistent envelope{' '}
            <code className="font-mono text-xs">{'{"ok": false, "error": "..."}'}</code> with HTTP{' '}
            <code className="font-mono text-xs">400</code> (validation error or workspace outside key scope),{' '}
            <code className="font-mono text-xs">401</code> (missing/invalid/expired credential),{' '}
            <code className="font-mono text-xs">403</code> (session-cookie write without{' '}
            <code className="font-mono text-xs">X-Borga-Client: borga-dashboard</code> — Bearer keys are exempt),{' '}
            <code className="font-mono text-xs">404</code> (feature disabled or record not found), or{' '}
            <code className="font-mono text-xs">429</code> (rate limit: 120 req/min per credential).
          </p>
        </section>

        {/* All Versioned Endpoints */}
        <section id="endpoints" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">
            Versioned Endpoints (<code className="font-mono text-base">/api/{BORGA_API_VERSION}</code>)
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            All {V1_ENDPOINT_CATALOG.length} operations in the {BORGA_API_VERSION} specification (`v{BORGA_OPENAPI_SEMVER}`).
            List endpoints return up to 100 items.
          </p>
          <div className="mt-4 grid gap-4">
            {V1_ENDPOINT_CATALOG.map((ep) => (
              <Endpoint key={ep.id} ep={ep} />
            ))}
          </div>
        </section>

        {/* API Keys */}
        <section id="keys" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">API Keys</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Create keys in the dashboard under <strong>Developers → API Keys</strong>. Each key is scoped to the
            workspaces you select (or all workspaces you own when left unticked). Secrets start with{' '}
            <code className="font-mono text-xs">borga_</code>, are shown once, and are stored as SHA-256 hashes.
          </p>
        </section>

        {/* Webhooks */}
        <section id="webhooks" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">Webhooks</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Subscribe an HTTPS endpoint to engine events under <strong>Developers → Webhooks</strong>. Deliveries carry{' '}
            <code className="font-mono text-xs">X-Borga-Event</code>,{' '}
            <code className="font-mono text-xs">X-Borga-Delivery-ID</code>,{' '}
            <code className="font-mono text-xs">X-Borga-Timestamp</code>, and{' '}
            <code className="font-mono text-xs">X-Borga-Signature: sha256=…</code> (HMAC-SHA256 of the raw body).
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {[
              'booking.created',
              'booking.updated',
              'booking.delivered',
              'driver.onboarded',
              'client.created',
              'sla.breached',
              'tracking.updated',
              'payment.received',
              'invoice.paid',
              'bill.due',
              'bank.synced',
              'equity.updated',
              'payroll.posted',
              'quote.accepted',
              'purchase-order.received',
            ].map((e) => (
              <code
                key={e}
                className="rounded-md border border-border/85 bg-card px-3 py-1.5 font-mono text-xs text-foreground"
              >
                {e}
              </code>
            ))}
          </div>
        </section>

        {/* Client Portal */}
        <section id="portal" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">Client Portal Tokens</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Mint login-free customer portal links under <strong>Sales → Customers → Client portal</strong> (
            <code className="font-mono text-xs">GET/POST /api/borga/portal/bpt_TOKEN</code>). Tokens are scoped to a
            single customer account, expire after 90 days by default, and allow viewing invoices/quotes and accepting
            sent quotes.
          </p>
        </section>

        {/* Feature Requests */}
        <section id="requests" className="mt-12 scroll-mt-6">
          <h2 className="text-xl font-bold tracking-tight">Feature Requests</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Signed-in workspace owners can submit and track product requests under{' '}
            <strong>Developers → Feature Requests</strong>.
          </p>
          <Link
            href="/signup"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-2xs transition hover:opacity-90"
          >
            Get started <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        <p className="mt-12 border-t border-border/75 pt-6 text-xs text-muted-foreground">
          Borga Public API {BORGA_API_VERSION} (OpenAPI 3.1.0 · v{BORGA_OPENAPI_SEMVER}). Fair use and per-key rate limits
          apply.
        </p>
      </div>
    </main>
  );
}
