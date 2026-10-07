'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import type { LlmProvider, LlmModelInfo, LlmModelTier } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { ConfirmDialog } from '../ConfirmDialog';

/**
 * Company-specific AI model catalog editor.
 * Edits write straight to the per-workspace `llmCatalog` entity (DB-backed),
 * which the chat route, agent runner and every model picker read at runtime.
 */
export function ModelCatalogEditor() {
  const { llmCatalog, setLlmCatalog } = useBorga();
  const catalog = llmCatalog && llmCatalog.length ? llmCatalog : [];
  const [confirmDelete, setConfirmDelete] = useState<{ kind: 'provider'; id: string } | { kind: 'model'; pid: string; mid: string } | null>(null);

  const update = (next: LlmProvider[]) => setLlmCatalog(next);

  const updateProvider = (id: string, patch: Partial<LlmProvider>) =>
    update(catalog.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addProvider = () =>
    update([
      ...catalog,
      { id: `llm-${Date.now().toString(36)}`, label: 'New Provider', baseUrl: '', accent: '#64748B', envVar: '', models: [] },
    ]);

  const doRemoveProvider = (id: string) => {
    update(catalog.filter((p) => p.id !== id));
    setConfirmDelete(null);
  };

  const updateModel = (pid: string, mid: string, patch: Partial<LlmModelInfo>) => {
    const provider = catalog.find((p) => p.id === pid);
    if (patch.id !== undefined && patch.id !== mid && provider?.models.some((m) => m.id === patch.id)) {
      toast({ title: 'Model id already exists', description: `"${patch.id}" is already used by another model in this provider.`, variant: 'warning' });
      return;
    }
    update(
      catalog.map((p) =>
        p.id === pid ? { ...p, models: p.models.map((m) => (m.id === mid ? { ...m, ...patch } : m)) } : p,
      ),
    );
  };

  const addModel = (pid: string) =>
    update(
      catalog.map((p) =>
        p.id === pid
          ? { ...p, models: [...p.models, { id: `model-${Date.now().toString(36)}`, label: 'New model', tier: 'free' as LlmModelTier }] }
          : p,
      ),
    );

  const doRemoveModel = (pid: string, mid: string) => {
    update(
      catalog.map((p) => (p.id === pid ? { ...p, models: p.models.filter((m) => m.id !== mid) } : p)),
    );
    setConfirmDelete(null);
  };

  return (
    <div className="max-w-4xl space-y-4">
      <SectionTitle
        title="AI Model Catalog"
        sub="Company-specific providers & models. Saved per workspace and used by chat, agents and the model picker."
      />
      <div className="flex justify-end">
        <Button onClick={addProvider} className="gap-1.5" size="sm">
          <Plus className="h-4 w-4" /> Add provider
        </Button>
      </div>
      {catalog.map((p) => (
        <Card key={p.id} className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.accent }} />
            <Input
              value={p.label}
              onChange={(e) => updateProvider(p.id, { label: e.target.value })}
              className="h-8 w-48 font-semibold"
            />
            <code className="text-[11px] text-muted-foreground">{p.id}</code>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-8 w-8"
              onClick={() => setConfirmDelete({ kind: 'provider', id: p.id })}
              title="Remove provider"
            >
              <Trash2 className="h-4 w-4 text-rose-500" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="text-[11px] text-muted-foreground">Base URL</label>
              <Input
                value={p.baseUrl}
                onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                className="h-8 font-mono text-xs"
                placeholder="https://…/v1"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">API key env var</label>
              <Input
                value={p.envVar ?? ''}
                onChange={(e) => updateProvider(p.id, { envVar: e.target.value })}
                className="h-8 font-mono text-xs"
                placeholder="OPENROUTER_API_KEY"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Free-tier note</label>
              <Input
                value={p.freeTierNote ?? ''}
                onChange={(e) => updateProvider(p.id, { freeTierNote: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Models ({p.models.length})</span>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => addModel(p.id)}>
                <Plus className="h-3.5 w-3.5" /> Add model
              </Button>
            </div>
            {p.models.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
                <Input
                  value={m.id}
                  onChange={(e) => updateModel(p.id, m.id, { id: e.target.value })}
                  className="h-7 w-56 font-mono text-xs"
                />
                <Input
                  value={m.label}
                  onChange={(e) => updateModel(p.id, m.id, { label: e.target.value })}
                  className="h-7 w-40 text-xs"
                />
                <select
                  value={m.tier}
                  onChange={(e) => updateModel(p.id, m.id, { tier: e.target.value as LlmModelTier })}
                  className="h-7 rounded border border-input bg-background px-2 text-xs"
                >
                  <option value="free">free</option>
                  <option value="paid">paid</option>
                  <option value="credits">credits</option>
                </select>
                <Input
                  value={m.contextK ? String(m.contextK) : ''}
                  onChange={(e) => updateModel(p.id, m.id, { contextK: e.target.value ? Number(e.target.value) : undefined })}
                  className="h-7 w-20 text-xs"
                  placeholder="ctx k"
                />
                <Input
                  value={m.tag ?? ''}
                  onChange={(e) => updateModel(p.id, m.id, { tag: e.target.value || undefined })}
                  className="h-7 w-24 text-xs"
                  placeholder="tag"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmDelete({ kind: 'model', pid: p.id, mid: m.id })} title="Remove model">
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title={confirmDelete?.kind === 'model' ? 'Remove this model?' : 'Remove this provider?'}
        description={
          confirmDelete?.kind === 'model'
            ? 'The model is removed from this provider. Anything referencing it falls back to the workspace default model.'
            : 'The provider and all its models are removed. Anything referencing them falls back to the workspace default.'
        }
        confirmLabel={confirmDelete?.kind === 'model' ? 'Remove model' : 'Remove provider'}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.kind === 'model') doRemoveModel(confirmDelete.pid, confirmDelete.mid);
          else doRemoveProvider(confirmDelete.id);
        }}
      />
    </div>
  );
}
