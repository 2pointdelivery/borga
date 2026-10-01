'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Plus, Trash2, Database, Search, CheckCircle2, Sparkles, Pencil, Eye, Save, X, Brain, BrainCircuit, Filter, Zap } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { KNOWLEDGE_CATEGORIES, type AgentMemory, type KnowledgeCategoryId, type KnowledgeEntry, type MemoryKind } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { SupermemoryCard } from './SupermemoryCard';
import { cn } from '@/lib/utils';

const MEMORY_KIND_STYLE: Record<MemoryKind, string> = {
  fact:        'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  context:     'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  instruction: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  observation: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
};

const CAT_STYLE: Record<KnowledgeCategoryId, string> = {
  company: 'bg-indigo-500/10 text-indigo-600 ring-indigo-500/30',
  services: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  customers: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  funding: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  content: 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
  process: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
};

function catLabel(id: KnowledgeCategoryId) {
  return KNOWLEDGE_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function KnowledgeBaseTab() {
  const { knowledge, addKnowledge, updateKnowledge, deleteKnowledge, kbQuestions, collectQuestion, memories, addMemory, deleteMemory, clearMemoriesByAgent, agents, activeWorkspace, log } = useBorga();
  const ws = activeWorkspace();
  const wsName = ws?.legalName ?? ws?.name ?? 'your company';
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KnowledgeCategoryId | 'all'>('all');
  const [autoOnly, setAutoOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const [qOpen, setQOpen] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState<KnowledgeCategoryId>('company');
  const [source, setSource] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [viewTarget, setViewTarget] = useState<KnowledgeEntry | null>(null);
  const [editTarget, setEditTarget] = useState<KnowledgeEntry | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [editCategory, setEditCategory] = useState<KnowledgeCategoryId>('company');
  const [editSource, setEditSource] = useState('');

  const [memQuery, setMemQuery] = useState('');
  const [memKind, setMemKind] = useState<MemoryKind | 'all'>('all');
  const [memAgent, setMemAgent] = useState('all');

  const filteredMemories = useMemo(() => memories.filter((m) => {
    if (memKind !== 'all' && m.kind !== memKind) return false;
    if (memAgent !== 'all' && m.agentId !== memAgent) return false;
    if (memQuery && !m.content.toLowerCase().includes(memQuery.toLowerCase()) && !m.tags.join(' ').toLowerCase().includes(memQuery.toLowerCase())) return false;
    return true;
  }), [memories, memKind, memAgent, memQuery]);

  const memAgentOptions = useMemo(() => {
    const ids = Array.from(new Set(memories.map((m) => m.agentId)));
    return ids.map((id) => ({ id, name: agents.find((a) => a.id === id)?.name ?? id }));
  }, [memories, agents]);

  const isAutoDerived = (k: KnowledgeEntry) => k.source.startsWith('Auto-derived');

  const known = useMemo(
    () => knowledge.filter((k) =>
      (filter === 'all' || k.category === filter) &&
      (!autoOnly || isAutoDerived(k)) &&
      (!query || k.title.toLowerCase().includes(query.toLowerCase()) || k.answer.toLowerCase().includes(query.toLowerCase())),
    ),
    [knowledge, filter, autoOnly, query],
  );
  const autoCount = useMemo(() => knowledge.filter(isAutoDerived).length, [knowledge]);

  const openEdit = (k: KnowledgeEntry) => {
    setEditTarget(k);
    setEditTitle(k.title);
    setEditAnswer(k.answer);
    setEditCategory(k.category);
    setEditSource(k.source);
  };

  const commitEdit = () => {
    if (!editTarget || !editTitle.trim()) return;
    updateKnowledge(editTarget.id, {
      title: editTitle.trim(),
      answer: editAnswer.trim() || 'Collected — pending full answer.',
      category: editCategory,
      source: editSource.trim() || 'Collected',
      updatedAt: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    setEditTarget(null);
  };

  const openQuestion = (id: string) => {
    const q = kbQuestions.find((x) => x.id === id);
    setQOpen(id);
    setAnswerDraft('');
    if (q) {
      setTitle(q.question);
      setCategory(q.category);
      setSource(q.source);
    }
  };

  const save = () => {
    if (!title.trim()) return;
    addKnowledge({
      id: `kb-${Date.now()}`,
      category,
      title: title.trim(),
      answer: answer.trim() || 'Collected — pending full answer.',
      source: source.trim() || 'Collected',
      updatedAt: new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    setOpen(false);
    setTitle('');
    setAnswer('');
    setCategory('company');
    setSource('');
  };

  const saveAnswer = () => {
    if (!qOpen) return;
    collectQuestion(qOpen, answerDraft, source);
    setQOpen(null);
    setAnswerDraft('');
  };

  return (
    <div className="borga-fade-up space-y-5">
      <SupermemoryCard />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Knowledge Base" sub={`What Borga agents know — and what they still need to learn about ${wsName}`} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            title="Convert answered knowledge entries into durable agent memories"
            onClick={() => {
              const known = new Set(memories.map((m) => m.content));
              const fresh = knowledge.filter((k) => !known.has(`${k.title}: ${k.answer}`));
              if (!fresh.length) return;
              fresh.forEach((k) =>
                addMemory({
                  id: `mem-kb-${k.id}-${Date.now().toString(36)}`,
                  agentId: 'a-fundraising',
                  agentName: 'Nadia',
                  kind: 'fact',
                  content: `${k.title}: ${k.answer}`,
                  tags: ['knowledge-base', k.category ?? 'general'],
                  confidence: 90,
                  createdAt: new Date().toISOString(),
                  lastAccessed: new Date().toISOString(),
                }),
              );
              log({ agentId: 'a-fundraising', agentName: 'Nadia', actor: 'system', kind: 'learn', message: `Taught the fleet ${fresh.length} new fact${fresh.length === 1 ? '' : 's'} from the knowledge base.` });
            }}
          >
            <BrainCircuit className="h-4 w-4" /> Teach fleet
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add entry
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the knowledge base…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className={cn('cursor-pointer', filter === 'all' && 'border-primary text-primary')}
            onClick={() => setFilter('all')}
          >
            All
          </Badge>
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <Badge
              key={c.id}
              variant="outline"
              className={cn('cursor-pointer', filter === c.id && 'border-primary text-primary')}
              onClick={() => setFilter(c.id)}
            >
              {c.label.split('&')[0].trim()}
            </Badge>
          ))}
          {autoCount > 0 && (
            <Badge
              variant="outline"
              className={cn('cursor-pointer gap-1', autoOnly && 'border-primary text-primary')}
              onClick={() => setAutoOnly((v) => !v)}
              title="Entries the system keeps updated automatically from live company data"
            >
              <Zap className="h-3 w-3" /> Auto-updated ({autoCount})
            </Badge>
          )}
        </div>
      </div>

      {/* Coverage summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><BookOpen className="h-3.5 w-3.5" /> Known facts</p>
          <p className="mt-1 text-2xl font-semibold">{knowledge.length}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Database className="h-3.5 w-3.5" /> Open questions</p>
          <p className="mt-1 text-2xl font-semibold">{kbQuestions.length}</p>
          <p className="text-[11px] text-muted-foreground">awaiting answers from web, blog & team</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Coverage</p>
          <p className="mt-1 text-2xl font-semibold">{knowledge.length ? Math.round((knowledge.length / (knowledge.length + kbQuestions.length)) * 100) : 0}%</p>
          <p className="text-[11px] text-muted-foreground">across {KNOWLEDGE_CATEGORIES.length} categories</p>
        </Card>
      </div>

      {/* Open questions to collect */}
      {kbQuestions.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle title="Questions to collect" sub="Answer these to make agents sharper" />
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {kbQuestions.map((q) => (
              <button
                key={q.id}
                onClick={() => openQuestion(q.id)}
                className="flex items-start justify-between gap-2 rounded-xl border bg-muted/20 p-3 text-left transition-colors hover:border-primary/50"
              >
                <div>
                  <Badge className={cn('mb-1.5 ring-1', CAT_STYLE[q.category])}>{catLabel(q.category)}</Badge>
                  <p className="text-sm font-medium leading-snug">{q.question}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Source: {q.source}</p>
                </div>
                <Plus className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Entries */}
      <Card className="p-5">
        <SectionTitle title="Known facts" sub="Stored answers agents can cite" />
        <div className="mt-4 space-y-2">
          {known.length === 0 && <p className="text-sm text-muted-foreground">No entries match yet.</p>}
          {known.map((k) => (
            <div key={k.id} className="group rounded-xl border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <button onClick={() => setViewTarget(k)} className="min-w-0 flex-1 text-left">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge className={cn('ring-1', CAT_STYLE[k.category])}>{catLabel(k.category)}</Badge>
                    {isAutoDerived(k) && (
                      <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600" title="Refreshed automatically as the company's data changes">
                        <Zap className="h-3 w-3" /> Auto-updated
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-semibold">{k.title}</p>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setViewTarget(k)}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                    title="View"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => openEdit(k)}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteKnowledge(k.id)}
                    className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <button onClick={() => setViewTarget(k)} className="mt-2 block w-full text-left text-sm leading-relaxed text-muted-foreground line-clamp-3">
                {k.answer}
              </button>
              <p className="mt-2 text-[11px] text-muted-foreground">Source: {k.source} — Updated {k.updatedAt}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Agent memory ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <SectionTitle title="Agent memory" sub={`${memories.length} stored — runtime observations across sessions`} />
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={memQuery} onChange={(e) => setMemQuery(e.target.value)} placeholder="Search memories…" className="h-8 w-36 pl-8 text-xs" />
            </div>
            <select value={memKind} onChange={(e) => setMemKind(e.target.value as MemoryKind | 'all')} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
              <option value="all">All kinds</option>
              <option value="fact">Fact</option>
              <option value="context">Context</option>
              <option value="instruction">Instruction</option>
              <option value="observation">Observation</option>
            </select>
            <select value={memAgent} onChange={(e) => setMemAgent(e.target.value)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
              <option value="all">All agents</option>
              {memAgentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {memories.length > 0 && (
              <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => clearMemoriesByAgent('')}>
                <Trash2 className="h-3 w-3" /> Clear all
              </Button>
            )}
          </div>
        </div>
        {filteredMemories.length === 0 ? (
          <Card className="mt-3 p-6 text-center text-sm text-muted-foreground">
            {memories.length === 0
              ? 'No memories yet. Agents will write observations here as they work.'
              : 'No memories match your filters.'}
          </Card>
        ) : (
          <div className="mt-3 space-y-2">
            {filteredMemories.map((m) => (
              <div key={m.id} className="group flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge className={cn('shrink-0 ring-1 text-[10px] capitalize', MEMORY_KIND_STYLE[m.kind])}>{m.kind}</Badge>
                    <span className="text-xs font-medium text-muted-foreground">{m.agentName}</span>
                    {m.tags.length > 0 && m.tags.map((t) => (
                      <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">#{t}</span>
                    ))}
                    <span className="ml-auto text-[10px] text-muted-foreground">{m.confidence}% confidence</span>
                  </div>
                  <p className="text-sm leading-relaxed">{m.content}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Stored {new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <button
                  onClick={() => deleteMemory(m.id)}
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title="Delete memory"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Add entry dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a knowledge entry</DialogTitle>
            <DialogDescription>Record a fact, answer or playbook that agents should know about {wsName}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as KnowledgeCategoryId)} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Question / fact</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. What is our SLA?" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Answer</label>
              <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="The stored answer…" className="mt-1 min-h-24" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Website, Blog, Sales team" className="mt-1" />
            </div>
            <Button className="w-full" onClick={save} disabled={!title.trim()}>Save to knowledge base</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Answer question dialog */}
      <Dialog open={qOpen !== null} onOpenChange={(v) => !v && setQOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Answer a question</DialogTitle>
            <DialogDescription>
              {kbQuestions.find((x) => x.id === qOpen)?.question ?? ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source of the answer</label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Website, Blog, Sales team" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Answer</label>
              <Textarea value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} placeholder="Type the answer agents should use…" className="mt-1 min-h-24" />
            </div>
            <Button className="w-full" onClick={saveAnswer}>Collect answer</Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* View entry dialog */}
      <Dialog open={viewTarget !== null} onOpenChange={(v) => !v && setViewTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Knowledge entry</DialogTitle>
          </DialogHeader>
          {viewTarget && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={cn('ring-1', CAT_STYLE[viewTarget.category])}>{catLabel(viewTarget.category)}</Badge>
                <span className="text-[11px] text-muted-foreground">Updated {viewTarget.updatedAt}</span>
              </div>
              <h3 className="text-base font-semibold">{viewTarget.title}</h3>
              <p className="rounded-lg border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground">{viewTarget.answer}</p>
              <p className="text-[11px] text-muted-foreground">Source: <span className="font-medium text-foreground">{viewTarget.source}</span></p>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-1.5" onClick={() => { setViewTarget(null); openEdit(viewTarget); }}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => { deleteKnowledge(viewTarget.id); setViewTarget(null); }}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                <Button className="ml-auto gap-1.5" onClick={() => setViewTarget(null)}>
                  <X className="h-3.5 w-3.5" /> Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit entry dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit knowledge entry</DialogTitle>
            <DialogDescription>Update the fact or answer stored in the knowledge base.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <select value={editCategory} onChange={(e) => setEditCategory(e.target.value as KnowledgeCategoryId)} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Question / fact</label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Answer</label>
              <Textarea value={editAnswer} onChange={(e) => setEditAnswer(e.target.value)} className="mt-1 min-h-28" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Input value={editSource} onChange={(e) => setEditSource(e.target.value)} className="mt-1" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => setEditTarget(null)}>
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button className="flex-1 gap-1.5" onClick={commitEdit} disabled={!editTitle.trim()}>
                <Save className="h-3.5 w-3.5" /> Save changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
