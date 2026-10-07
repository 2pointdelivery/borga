'use client';

import { useRef, useState } from 'react';
import { Bold, Italic, List, ListOrdered, Link2, Quote, Hash, Eye, PencilLine, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { CHANNEL_CHAR_LIMIT } from '@/lib/borga/social-publish';
import { renderPostPreview } from '@/lib/borga/safe-markdown';
import { CHANNEL_LABEL, type SocialChannel } from '@/lib/borga/data';
import { cn } from '@/lib/utils';

const TONES = ['Professional', 'Friendly', 'Bold', 'Playful'] as const;

/**
 * Rich post composer: formatting toolbar, per-channel character counter,
 * write/preview toggle, and one-click AI drafting through the workspace's
 * configured provider.
 */
export function MarketingComposer({
  channel,
  value,
  onChange,
}: {
  channel: SocialChannel;
  value: string;
  onChange: (v: string) => void;
}) {
  const { llm, activeWorkspace, activeWorkspaceId } = useBorga();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<(typeof TONES)[number]>('Professional');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const limit = CHANNEL_CHAR_LIMIT[channel];
  const over = value.length > limit;

  const wrap = (before: string, after = '') => {
    const el = areaRef.current;
    if (!el) {
      onChange(`${value}${before}${after}`);
      return;
    }
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = value.slice(s, e) || 'text';
    onChange(`${value.slice(0, s)}${before}${selected}${after}${value.slice(e)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  };

  const prefixLines = (prefix: string) => {
    const el = areaRef.current;
    if (!el) {
      onChange(value.split('\n').map((l) => `${prefix}${l}`).join('\n'));
      return;
    }
    const { selectionStart: s } = el;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = value.indexOf('\n', s);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    onChange(`${value.slice(0, lineStart)}${prefix}${line}${value.slice(lineEnd)}`);
    requestAnimationFrame(() => el.focus());
  };

  const tools = [
    { icon: Bold, label: 'Bold', fn: () => wrap('**', '**') },
    { icon: Italic, label: 'Italic', fn: () => wrap('*', '*') },
    { icon: List, label: 'Bullet list', fn: () => prefixLines('- ') },
    { icon: ListOrdered, label: 'Numbered list', fn: () => prefixLines('1. ') },
    { icon: Quote, label: 'Quote', fn: () => prefixLines('> ') },
    { icon: Link2, label: 'Link', fn: () => wrap('[', '](https://example.com)') },
    { icon: Hash, label: 'Hashtag', fn: () => wrap('#') },
  ];

  const draftWithAi = async () => {
    const subject = topic.trim() || value.trim().slice(0, 200);
    if (!subject || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    try {
      const company = activeWorkspace()?.name ?? 'the company';
      const res = await fetch('/api/borga/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `You write social media posts for ${company}. Reply with ONLY the post text — no quotes, no preamble, no hashtags unless they fit naturally. Keep it under ${Math.min(limit, 600)} characters.` },
            { role: 'user', content: `Write a ${tone.toLowerCase()} ${CHANNEL_LABEL[channel]} post about: ${subject}` },
          ],
          model: llm.model,
          providerId: llm.providerId,
          ws: activeWorkspaceId,
          companyName: company,
        }),
      });
      const d = (await res.json()) as { reply?: string };
      const draft = (d.reply ?? '').trim();
      if (!draft) {
        setAiError('The AI returned nothing — try again.');
        return;
      }
      // Append below anything already typed — never overwrite the user's copy.
      const prefix = value.trim() ? `${value.replace(/\s+$/, '')}\n\n` : '';
      onChange(`${prefix}${draft}`);
      setTopic('');
    } catch {
      setAiError('Could not reach the AI provider — check Integrations → AI & Voice.');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 rounded-t-xl border border-b-0 bg-muted/40 px-2 py-1.5">
        {tools.map((t) => (
          <button
            key={t.label}
            type="button"
            title={t.label}
            onClick={t.fn}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <t.icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <span className={cn('ml-auto font-mono text-[11px]', over ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
          {value.length}/{limit}
        </span>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
            preview ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          title={preview ? 'Back to editing' : 'Preview formatted post'}
        >
          {preview ? <PencilLine className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div
          className="min-h-[104px] rounded-b-xl border bg-background px-3 py-2 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderPostPreview(value) || '<p class="text-muted-foreground">Nothing to preview yet.</p>' }}
        />
      ) : (
        <Textarea
          ref={areaRef}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your post… (**bold**, *italic*, - lists, [links](https://…))"
          className="rounded-t-none"
        />
      )}
      {over && <p className="mt-1 text-[11px] text-destructive">{CHANNEL_LABEL[channel]} cuts posts at {limit} characters — shorten before publishing.</p>}
      <div className="mt-2 rounded-xl border border-dashed bg-muted/20 p-2.5">
        <p className="flex items-center gap-1 text-[11px] font-medium"><Sparkles className="h-3 w-3 text-violet-500" /> Draft with AI</p>
        <div className="mt-1.5 flex gap-1.5">
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic (or leave empty to expand the text above)…"
            className="h-8 text-xs"
          />
          <Select value={tone} onValueChange={(v) => setTone(v as (typeof TONES)[number])}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 shrink-0" disabled={aiBusy || (!topic.trim() && !value.trim())} onClick={() => void draftWithAi()}>
            {aiBusy ? 'Drafting…' : 'Generate'}
          </Button>
        </div>
        {aiError && <p className="mt-1 text-[11px] text-destructive">{aiError}</p>}
      </div>
    </div>
  );
}
