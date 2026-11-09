'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, FileCode2, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useBorga } from '@/lib/borga/store';
import {
  BORGA_API_RELEASE_DATE,
  BORGA_API_VERSION,
  BORGA_OPENAPI_SEMVER,
  V1_ENDPOINT_CATALOG,
  type ApiEndpointDoc,
  type ApiTag,
} from '@/lib/borga/openapi-spec';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

const METHOD_BADGE: Record<ApiEndpointDoc['method'], string> = {
  GET: 'bg-sky-500/10 text-sky-600 ring-sky-500/25',
  POST: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/25',
  PATCH: 'bg-amber-500/10 text-amber-600 ring-amber-500/25',
};

export function ApiReferenceTab() {
  const activeWorkspaceId = useBorga((s) => s.activeWorkspaceId);
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<ApiTag | 'All'>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const tags = useMemo(() => {
    const s = new Set<ApiTag>();
    for (const ep of V1_ENDPOINT_CATALOG) s.add(ep.tag);
    return ['All', ...s] as const;
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return V1_ENDPOINT_CATALOG.filter((ep) => {
      if (selectedTag !== 'All' && ep.tag !== selectedTag) return false;
      if (!q) return true;
      return `${ep.method} ${ep.path} ${ep.summary} ${ep.description} ${ep.tag}`.toLowerCase().includes(q);
    });
  }, [query, selectedTag]);

  const host = typeof window !== 'undefined' ? window.location.origin : 'https://app.borga.ai';
  const wsParam = activeWorkspaceId || 'YOUR_WS_ID';

  const buildCurl = (ep: ApiEndpointDoc) => {
    const qs = ep.queryParams
      .filter((p) => p.required)
      .map((p) => `${p.name}=${p.name === 'ws' ? wsParam : 'ID'}`)
      .join('&');
    const url = `${host}${ep.path}${qs ? `?${qs}` : ''}`;
    if (ep.path === '/api/v1' || ep.path === '/api/v1/openapi') {
      return `curl "${url}"`;
    }
    if (ep.method === 'GET') {
      return `curl "${url}" \\\n  -H "Authorization: Bearer borga_YOUR_KEY"`;
    }
    return `curl -X ${ep.method} "${url}" \\\n  -H "Authorization: Bearer borga_YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(ep.requestExample ?? {})}'`;
  };

  const copyCurl = (ep: ApiEndpointDoc) => {
    void navigator.clipboard?.writeText(buildCurl(ep));
    setCopiedId(ep.id);
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title={`API Reference & OpenAPI (${BORGA_API_VERSION} · v${BORGA_OPENAPI_SEMVER})`}
          sub={`Versioned REST endpoints (${V1_ENDPOINT_CATALOG.length} operations) · Release ${BORGA_API_RELEASE_DATE}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            X-Borga-API-Version: {BORGA_API_VERSION} ({BORGA_OPENAPI_SEMVER})
          </Badge>
          <a
            href="/api/v1/openapi"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/85 bg-background px-3 text-xs font-medium shadow-2xs transition-colors hover:bg-muted"
          >
            <FileCode2 className="h-3.5 w-3.5 text-primary" /> OpenAPI 3.1 JSON
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
          <a
            href="/developers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/85 bg-background px-3 text-xs font-medium shadow-2xs transition-colors hover:bg-muted"
          >
            Public Docs (/developers)
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg border border-border/80 bg-muted/30 p-1">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedTag(t)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                selectedTag === t
                  ? 'bg-background text-foreground shadow-2xs ring-1 ring-border/70'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search endpoints (invoices, quotes…)"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Endpoints List */}
      <div className="space-y-3">
        {filtered.map((ep) => (
          <Card key={ep.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 font-mono text-[11px] font-bold ring-1 ring-inset',
                      METHOD_BADGE[ep.method],
                    )}
                  >
                    {ep.method}
                  </span>
                  <code className="font-mono text-xs font-semibold text-foreground">{ep.path}</code>
                  <Badge variant="secondary" className="text-[10px]">
                    {ep.tag}
                  </Badge>
                  {ep.featureFlag && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      flag: {ep.featureFlag}
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium text-foreground">{ep.summary}</p>
                <p className="text-xs text-muted-foreground">{ep.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => copyCurl(ep)}
              >
                {copiedId === ep.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                {copiedId === ep.id ? 'Copied cURL' : 'Copy cURL'}
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  cURL Request (workspace: {wsParam})
                </p>
                <pre className="overflow-x-auto rounded-lg border border-border/80 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                  {buildCurl(ep)}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Response Example (200 / 201)
                </p>
                <pre className="overflow-x-auto rounded-lg border border-border/80 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {JSON.stringify(ep.responseExample, null, 2)}
                </pre>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
