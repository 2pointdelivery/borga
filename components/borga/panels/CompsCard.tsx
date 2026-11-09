'use client';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionTitle } from '../bits';
import { useBorga } from '@/lib/borga/store';
import { FormDialog, FieldGrid, TextField } from '../form-kit';
import { TableSearch, TableToolbar, CrudTable, IdCell, AmountCell, TextCell, EmptyRow, IconBtn, RowActions } from '../data-table';
import { peerMedian, type ValuationPeer } from '@/lib/borga/valuation-history';

/** Native comps engine: hand-kept peer multiples (offline) + optional SEC EDGAR enrichment. */
export function CompsCard() {
  const { valuationPeers, upsertValuationPeer, deleteValuationPeer, activeWorkspaceId } = useBorga();
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [evRev, setEvRev] = useState('');
  const [note, setNote] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ValuationPeer | null>(null);
  const [extraTickers, setExtraTickers] = useState('');
  const [extraCik, setExtraCik] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ comps: Array<{ ticker: string; name: string; revenue: number | null; evRev: number | null; source: string; asOf: string }>; medianEvRev: number | null; source: string; asOf: string; sampleSize: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const median = peerMedian(valuationPeers);
  const visible = valuationPeers.filter((p) => (query ? `${p.ticker} ${p.name}`.toLowerCase().includes(query.toLowerCase()) : true));

  const openAdd = () => {
    setEditing(null); setTicker(''); setName(''); setEvRev(''); setNote(''); setShowAdd(true);
  };
  const openEdit = (p: ValuationPeer) => {
    setEditing(p); setTicker(p.ticker); setName(p.name); setEvRev(String(p.evRev)); setNote(p.note ?? ''); setShowAdd(true);
  };

  const save = () => {
    if (!ticker.trim() || !(Number(evRev) > 0)) { setMsg('A short code and a positive multiple are required.'); return; }
    const p: ValuationPeer = {
      id: editing?.id ?? `peer-${Date.now().toString(36)}`, ticker: ticker.trim().toUpperCase(),
      name: name.trim() || ticker.trim().toUpperCase(), evRev: Number(evRev),
      note: note.trim() || undefined, updatedAt: new Date().toISOString(),
    };
    upsertValuationPeer(p);
    setShowAdd(false); setEditing(null); setMsg(null);
  };

  const compute = async () => {
    setMsg(null);
    const params = new URLSearchParams({ ws: activeWorkspaceId ?? '' });
    for (const p of valuationPeers) params.append(`evrev_${p.ticker}`, String(p.evRev));
    if (extraTickers.trim()) params.append('tickers', extraTickers.trim().toUpperCase());
    if (extraCik.trim()) {
      for (const part of extraCik.split(',')) {
        const [t, cik] = part.split(':').map((s) => s.trim());
        if (t && cik) params.append(`cik_${t.toUpperCase()}`, cik);
      }
    }
    const r = await fetch(`/api/borga/valuation/comps?${params.toString()}`);
    const d = await r.json() as { ok?: boolean; error?: string; comps?: []; medianEvRev?: number | null; source?: string; asOf?: string; sampleSize?: number };
    if (!d.ok) { setMsg(`Failed: ${d.error}`); return; }
    setResult({ comps: d.comps ?? [], medianEvRev: d.medianEvRev ?? null, source: d.source ?? '', asOf: d.asOf ?? '', sampleSize: d.sampleSize ?? 0 });
  };

  return (
    <Card className="p-4">
      <SectionTitle title="Market comps" sub="What are similar companies worth? Add a few you admire — the middle value (median) is a reality check on your own valuation." />
      <p className="text-xs text-muted-foreground">💡 Tip: EV/Revenue of 2× means “this company is worth twice its yearly sales”. Ask your accountant, or look at sold businesses in your industry. Your entries work fully offline — the optional extras below pull public data.</p>
      {median !== null && <p className="mt-1 text-sm">Peer median EV/Revenue: <strong>{median.toFixed(2)}×</strong> (n={valuationPeers.length}, manual)</p>}
      <TableToolbar>
        <TableSearch value={query} onChange={setQuery} placeholder="Search companies…" />
        <Button size="sm" variant="outline" onClick={openAdd}>＋ Add a comparable company</Button>
      </TableToolbar>
      <CrudTable headers={['Company', <span key="m" className="block text-right">Worth × sales</span>, 'Multiple from']}>
        {visible.map((p) => (
          <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
            <IdCell sub={p.name}>{p.ticker}</IdCell>
            <AmountCell value={`${p.evRev.toFixed(2)}×`} />
            <TextCell sub={p.updatedAt ? `kept ${p.updatedAt.slice(0, 10)}` : undefined}>{p.note ?? 'hand-entered'}</TextCell>
            <td className="px-2 py-2.5">
              <RowActions>
                <IconBtn title={`Edit ${p.ticker}`} onClick={() => openEdit(p)}>
                  <Pencil className="h-3 w-3" />
                </IconBtn>
                <IconBtn title={`Remove ${p.ticker}`} tone="red" onClick={() => deleteValuationPeer(p.id)}>
                  <Trash2 className="h-3 w-3" />
                </IconBtn>
              </RowActions>
            </td>
          </tr>
        ))}
        {visible.length === 0 && <EmptyRow colSpan={4}>{valuationPeers.length === 0 ? 'No peers yet — e.g. a competitor at 2.5×. Two or three is enough to start.' : 'No companies match this search.'}</EmptyRow>}
      </CrudTable>
      <FormDialog
        open={showAdd}
        onOpenChange={(o) => { setShowAdd(o); if (!o) setEditing(null); }}
        title={editing ? `Edit ${editing.ticker}` : 'Add a comparable company'}
        description="A similar business whose value you know. The middle value across all of them keeps your valuation honest."
        submitLabel={editing ? 'Save changes' : 'Add company'}
        onSubmit={save}
      >
        <FieldGrid cols={2}>
          <TextField label="Short code" value={ticker} onChange={setTicker} placeholder="e.g. JUMIA" hint="Any short name you'll recognize." />
          <TextField label="EV ÷ yearly sales" value={evRev} onChange={setEvRev} placeholder="e.g. 2.5" type="number" hint="2.5× = worth two-and-a-half yearly sales." />
        </FieldGrid>
        <TextField label="Company name" value={name} onChange={setName} placeholder="Full name (optional — code is used if empty)" />
        <TextField label="Where did this number come from?" value={note} onChange={setNote} placeholder="e.g. sold last year, accountant's estimate" />
      </FormDialog>
      <div className="mt-2 flex gap-1">
        <Input placeholder="Extra tickers for EDGAR (optional, e.g. AAPL,MSFT)" value={extraTickers} onChange={(e) => setExtraTickers(e.target.value)} />
        <Input placeholder="CIKs TICKER:cik,… (optional)" value={extraCik} onChange={(e) => setExtraCik(e.target.value)} />
        <Button size="sm" variant="outline" onClick={compute}>Compute comps</Button>
      </div>
      {msg && <p className="mt-1 text-sm text-muted-foreground">{msg}</p>}
      {result && (
        <div className="mt-2 text-sm text-muted-foreground">
          <p>Median EV/Revenue: <strong>{result.medianEvRev !== null ? `${result.medianEvRev.toFixed(2)}×` : '—'}</strong> · n={result.sampleSize} · as of {result.asOf}</p>
          {result.comps.map((c) => (
            <p key={c.ticker}>{c.ticker} ({c.source}): revenue {c.revenue !== null ? `$${Math.round(c.revenue).toLocaleString()}` : '—'} · EV/Rev {c.evRev !== null ? `${c.evRev.toFixed(2)}×` : '—'}</p>
          ))}
          <p className="mt-1 text-xs">{result.source}</p>
        </div>
      )}
    </Card>
  );
}
