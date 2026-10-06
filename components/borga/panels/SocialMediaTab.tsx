'use client';

import { useState } from 'react';
import { Plus, Send, Clock, ThumbsUp, MessageCircle, Share2, CalendarClock, Pencil, Link2, RefreshCw, CircleAlert, Reply, StickyNote } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MarketingComposer } from '../MarketingComposer';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { CHANNEL_COLOR, CHANNEL_LABEL, type SocialChannel, type SocialPost } from '@/lib/borga/data';
import { strategyFor, authKindForToolkit, CHANNEL_CHAR_LIMIT } from '@/lib/borga/social-publish';
import { useComposioReady } from '../use-composio-ready';
import { useConnectedApps } from '../use-connected-apps';
import { AgentAvatar, SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';

/** Human display for stored schedule values ('Just now', ISO datetime-local, or legacy text). */
function formatScheduledAt(v: string): string {
  if (!v || v === '…') return v;
  if (v === 'Just now') return v;
  const d = new Date(v);
  if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return v;
}
import { PostEditDialog } from './SocialEditDialogs';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground ring-border',
  scheduled: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  published: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
};

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

export function SocialMediaTab() {
  const { posts, addPost, updatePost, setPostStatus, agents, log, composio, activeWorkspaceId, syncToolkitConnection } = useBorga();
  const { ready: composioReady, checking: composioChecking } = useComposioReady();
  const [open, setOpen] = useState(false);
  const [editPost, setEditPost] = useState<SocialPost | null>(null);
  const [form, setForm] = useState({ channels: new Set<SocialChannel>(['linkedin']), content: '', scheduledAt: '', author: 'Nova' });
  const [connecting, setConnecting] = useState<SocialChannel | null>(null);
  const [busyPost, setBusyPost] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [notesOpen, setNotesOpen] = useState<string | null>(null);
  const [noteText, setNoteText] = useState<Record<string, string>>({});
  const [noteAuthor, setNoteAuthor] = useState('Nova');

  // Authors survive renames: anyone from the marketing departments qualifies, plus
  // whoever authored the current draft (shown even if they moved teams).
  const marketingAgents = agents.filter((a) => ['Marketing', 'Paid Media', 'Command Center'].includes(a.department));
  const authors = marketingAgents.length ? marketingAgents : agents;
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replyBusy, setReplyBusy] = useState<string | null>(null);

  const entityId = activeWorkspaceId || 'default';
  const keyPayload = composio.apiKey ? { apiKey: composio.apiKey } : {};
  // Shared live connection state (also mirror-syncs Inbox/Tools cards on load).
  const { apps: conns, loading: connsLoading, refresh: loadConns } = useConnectedApps(entityId);

  /** Link a channel's social account via Composio hosted OAuth. */
  const connectChannel = async (channel: SocialChannel) => {
    const strategy = strategyFor(channel);
    if (!strategy.toolkit) {
      setNotice(`${CHANNEL_LABEL[channel]} has no Composio toolkit yet — posts stay planned here until posting is available.`);
      return;
    }
    if (connecting) return;
    setConnecting(channel);
    setNotice('');
    try {
      // One-click managed auth config where Composio offers it; custom-auth
      // toolkits (X, Buffer, TikTok) need a dashboard-created config first.
      const acRes = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action: 'authConfigCreate', appName: strategy.toolkit, ...keyPayload }),
      });
      const ac = (await acRes.json()) as { ok: boolean; error?: string };
      if (!ac.ok) {
        setNotice(ac.error ?? `Could not prepare ${CHANNEL_LABEL[channel]} auth.`);
        return;
      }
      const cRes = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action: 'connect', appName: strategy.toolkit, entityId, ...keyPayload }),
      });
      const c = (await cRes.json()) as { ok: boolean; error?: string; connection?: { redirectUrl?: string } };
      const redirectUrl = c.connection?.redirectUrl;
      if (!c.ok || !redirectUrl) {
        setNotice(c.error ?? `Could not start ${CHANNEL_LABEL[channel]} sign-in.`);
        return;
      }
      window.open(redirectUrl, '_blank', 'noopener,noreferrer,width=640,height=720');
      // Poll until the account shows ACTIVE (or 60s elapse).
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const map = await loadConns();
        const state = map?.[strategy.toolkit];
        if (state?.connected) {
          syncToolkitConnection(strategy.toolkit, true, state.accountId);
          setNotice(`${CHANNEL_LABEL[channel]} linked — publishing is live.`);
          log({ agentId: 'a-marketing', agentName: 'Nova', actor: 'user', kind: 'sync', message: `${CHANNEL_LABEL[channel]} linked via Composio OAuth.` });
          return;
        }
      }
      setNotice(`Still waiting on ${CHANNEL_LABEL[channel]} sign-in — finish it in the opened tab, then press refresh.`);
    } finally {
      setConnecting(null);
    }
  };

  /** Publish through Composio when possible; otherwise keep it as a scheduled draft. */
  const publishLive = async (post: SocialPost) => {
    if (busyPost) return;
    setBusyPost(post.id);
    setNotice('');
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action: 'socialPost', channel: post.channel, text: post.content, entityId, ...keyPayload }),
      });
      const d = (await res.json()) as { ok: boolean; posted?: boolean; queued?: boolean; reason?: string; result?: unknown; error?: string };
      if (!d.ok) {
        updatePost(post.id, { status: 'scheduled', publishNote: d.error ?? 'Publishing failed — kept as a scheduled draft.' });
        setNotice(d.error ?? 'Publishing failed — kept as a scheduled draft.');
        return;
      }
      if (d.posted) {
        const ref = typeof d.result === 'object' && d.result !== null
          ? String((d.result as Record<string, unknown>).id ?? (d.result as Record<string, unknown>).post_id ?? (d.result as Record<string, unknown>).url ?? '')
          : '';
        updatePost(post.id, { status: 'published', scheduledAt: 'Just now', externalRef: ref || undefined, publishNote: undefined });
        setNotice(`Posted live to ${CHANNEL_LABEL[post.channel]}.`);
        log({ agentId: 'a-marketing', agentName: post.author, actor: 'user', kind: 'task', message: `Published post to ${CHANNEL_LABEL[post.channel]} via Composio${ref ? ` (${ref})` : ''}.` });
      } else {
        updatePost(post.id, { status: 'scheduled', publishNote: d.reason ?? 'Kept as a scheduled draft.' });
        setNotice(d.reason ?? 'Kept as a scheduled draft.');
      }
    } catch {
      updatePost(post.id, { status: 'scheduled', publishNote: 'Network error while publishing — kept as a scheduled draft.' });
      setNotice('Network error while publishing — kept as a scheduled draft.');
    } finally {
      setBusyPost(null);
    }
  };

  /** Team discussion inside the system — notes live on the post, nothing external. */
  const addNote = (post: SocialPost) => {
    const text = (noteText[post.id] ?? '').trim();
    if (!text) return;
    updatePost(post.id, {
      internalNotes: [...(post.internalNotes ?? []), { id: `n-${Date.now()}`, author: noteAuthor, text, at: 'Just now' }],
    });
    setNoteText((m) => ({ ...m, [post.id]: '' }));
    log({ agentId: 'a-marketing', agentName: noteAuthor, actor: 'user', kind: 'task', message: `Noted on ${CHANNEL_LABEL[post.channel]} post: ${text.slice(0, 80)}` });
  };

  /** Reply to the audience from inside the system (X threads, FB comments, IG replies). */
  const sendReply = async (post: SocialPost) => {
    const text = (replyText[post.id] ?? '').trim();
    if (!text || !post.externalRef || replyBusy) return;
    setReplyBusy(post.id);
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ action: 'socialReply', channel: post.channel, text, replyTo: post.externalRef, entityId, ...keyPayload }),
      });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (!d.ok) {
        setNotice(d.error ?? 'Reply failed.');
        return;
      }
      updatePost(post.id, {
        internalNotes: [...(post.internalNotes ?? []), { id: `n-${Date.now()}`, author: post.author, text: `Replied: ${text}`, at: 'Just now' }],
      });
      setReplyText((m) => ({ ...m, [post.id]: '' }));
      setReplyOpen(null);
      setNotice(`Reply posted to ${CHANNEL_LABEL[post.channel]}.`);
      log({ agentId: 'a-marketing', agentName: post.author, actor: 'user', kind: 'task', message: `Replied on ${CHANNEL_LABEL[post.channel]}: ${text.slice(0, 80)}` });
    } catch {
      setNotice('Network error while replying.');
    } finally {
      setReplyBusy(null);
    }
  };
  /** Fan out one draft to every selected channel; each copy publishes via its own linked account or stays queued. */
  const submit = (publishNow: boolean) => {
    const text = form.content.trim();
    const channels = Array.from(form.channels);
    if (!text || channels.length === 0) return;
    if (/\]\(https?:\/\/(example\.com)?\)/.test(text)) {
      toast({ title: 'Link placeholder still in the copy', description: 'The Link tool inserts ](https://example.com) — replace it with the real URL before publishing.', variant: 'warning' });
    }
    const created: SocialPost[] = [];
    channels.forEach((channel, i) => {
      const post: SocialPost = {
        id: `p-${Date.now()}-${i}`,
        channel,
        content: text,
        status: publishNow ? 'published' : form.scheduledAt ? 'scheduled' : 'draft',
        scheduledAt: publishNow ? 'Just now' : form.scheduledAt || '…',
        author: form.author,
        engagement: { likes: 0, comments: 0, shares: 0 },
      };
      addPost(post);
      created.push(post);
    });
    log({
      agentId: 'a-marketing', agentName: form.author, actor: 'agent', kind: 'task',
      message: `${publishNow ? 'Publishing' : 'Scheduled'} to ${channels.length === 1 ? CHANNEL_LABEL[channels[0]] : channels.length + ' channels'}: ${channels.map((c) => CHANNEL_LABEL[c]).join(', ')}.`,
    });
    setForm({ channels: new Set<SocialChannel>(['linkedin']), content: '', scheduledAt: '', author: form.author });
    setOpen(false);
    if (publishNow) created.forEach((p) => void publishLive(p));
  };

  const counts = posts.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const selectedChannels = Array.from(form.channels);
  // One draft targets many channels — the tightest channel limit wins.
  const audienceSizeLimit = selectedChannels.length ? Math.min(...selectedChannels.map((c) => CHANNEL_CHAR_LIMIT[c])) : CHANNEL_CHAR_LIMIT.linkedin;

  const channelSummary = (Object.keys(CHANNEL_LABEL) as SocialChannel[]).map((c) => {
    const ch = posts.filter((p) => p.channel === c);
    const strategy = strategyFor(c);
    const conn = strategy.toolkit ? conns[strategy.toolkit] : undefined;
    return {
      channel: c,
      total: ch.length,
      published: ch.filter((p) => p.status === 'published').length,
      likes: ch.reduce((s, p) => s + p.engagement.likes, 0),
      comments: ch.reduce((s, p) => s + p.engagement.comments, 0),
      shares: ch.reduce((s, p) => s + p.engagement.shares, 0),
      strategy,
      conn,
    };
  });

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Social media postings" sub="Compose, schedule and publish across every channel" />
        <div className="flex gap-2">
          {composioReady && (
            <Button variant="outline" size="sm" onClick={() => void loadConns()} disabled={connsLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5', connsLoading && 'animate-spin')} /> Refresh connections
            </Button>
          )}
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New post
          </Button>
        </div>
      </div>

      {!composioReady && !composioChecking && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">Live publishing is off — no Composio key found.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your Composio API key under Integrations → Composio Toolkits (or set COMPOSIO_API_KEY on the server) to link social accounts and publish for real. Until then posts stay as drafts and schedules.
          </p>
        </Card>
      )}

      {notice && (
        <Card className="flex items-start gap-2 border-sky-500/40 bg-sky-500/5 p-4 text-sm">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <p>{notice}</p>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-3">
        {(['draft', 'scheduled', 'published'] as const).map((s) => (
          <Card key={s} className="p-3 text-center">
            <p className="text-2xl font-semibold capitalize">{counts[s] ?? 0}</p>
            <p className="text-xs capitalize text-muted-foreground">{s}</p>
          </Card>
        ))}
      </div>

      {/* Posting summary by channel */}
      <Card className="p-4">
        <SectionTitle title="Channels" sub="Connection state and publishing path per social network" />
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {channelSummary.map((c) => (
            <div key={c.channel} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', CHANNEL_COLOR[c.channel])}>
                  {CHANNEL_LABEL[c.channel]}
                </span>
                {c.strategy.mode === 'live' ? (
                  c.conn?.connected ? (
                    <span className="text-[10px] font-medium text-emerald-600" title={`Linked account ${c.conn.accountId ?? ''}`}>● linked</span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground" title="Posts stay queued until the account is linked">○ not linked</span>
                  )
                ) : (
                  <span className="text-[10px] text-amber-600" title={c.strategy.queueReason}>◆ queue only</span>
                )}
              </div>
              <p className="mt-2 text-lg font-semibold">{c.total}</p>
              <p className="text-[10px] text-muted-foreground">posts · {c.published} live</p>
              <div className="mt-2">
                {c.strategy.mode === 'live' ? (
                  c.conn?.connected ? (
                    <p className="text-[10px] text-emerald-600">Publishing live via Composio</p>
                  ) : composioReady ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full gap-1 text-[11px]"
                      disabled={connecting === c.channel}
                      onClick={() => void connectChannel(c.channel)}
                      title={authKindForToolkit(c.strategy.toolkit) === 'custom' ? 'Needs a custom OAuth app — the connect step will tell you exactly what to create.' : `One-click sign-in via Composio (${c.strategy.toolkit})`}
                    >
                      <Link2 className="h-3 w-3" /> {connecting === c.channel ? 'Linking…' : `Connect ${CHANNEL_LABEL[c.channel]}`}
                    </Button>
                  ) : (
                    <p className="text-[10px] text-muted-foreground">Add a Composio key to link</p>
                  )
                ) : (
                  <p className="text-[10px] text-muted-foreground" title={`${c.strategy.queueReason ?? ''} ${c.strategy.nextStep ?? ''}`}>
                    {(c.strategy.queueReason ?? '').slice(0, 64)}{(c.strategy.queueReason ?? '').length > 64 ? '…' : ''}
                  </p>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {c.likes}</span>
                <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {c.comments}</span>
                <span className="flex items-center gap-1"><Share2 className="h-3 w-3" /> {c.shares}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {posts.map((p) => {
          const author = agents.find((a) => a.name === p.author);
          const strategy = strategyFor(p.channel);
          return (
            <Card key={p.id} className="flex flex-col p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1', CHANNEL_COLOR[p.channel])}>
                    {CHANNEL_LABEL[p.channel]}
                  </span>
                  <Badge className={cn('capitalize', STATUS_STYLE[p.status])}>{p.status}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditPost(p)} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit / delete post">
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <p className="mt-3 line-clamp-4 flex-1 text-sm leading-relaxed">{p.content}</p>
              {p.externalRef && (
                <p className="mt-2 break-all text-[10px] text-muted-foreground" title="Live post reference from the platform">ref {p.externalRef}</p>
              )}
              {p.publishNote && (
                <p className="mt-2 text-[11px] text-amber-600" title={strategy.nextStep}>{p.publishNote}</p>
              )}
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                {author ? <AgentAvatar name={author.name} color={author.avatarColor} size={20} /> : null}
                <span>{p.author}</span>
                <span className="ml-auto flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatScheduledAt(p.scheduledAt)}
                </span>
              </div>
              {/* Team notes + audience replies, without leaving the system */}
              <div className="mt-3 space-y-2 border-t pt-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setNotesOpen(notesOpen === p.id ? null : p.id)}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    title="Team discussion on this post"
                  >
                    <StickyNote className="h-3 w-3" /> Notes{(p.internalNotes?.length ?? 0) > 0 ? ` (${p.internalNotes?.length})` : ''}
                  </button>
                  {p.status === 'published' && p.externalRef && ['twitter', 'facebook', 'instagram'].includes(p.channel) && (
                    <button
                      type="button"
                      onClick={() => setReplyOpen(replyOpen === p.id ? null : p.id)}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                      title={`Reply to the audience on ${CHANNEL_LABEL[p.channel]}`}
                    >
                      <Reply className="h-3 w-3" /> Reply
                    </button>
                  )}
                </div>
                {notesOpen === p.id && (
                  <div className="space-y-1.5">
                    {(p.internalNotes ?? []).map((n) => (
                      <div key={n.id} className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]">
                        <span className="font-medium">{n.author}</span>
                        <span className="ml-1.5 text-muted-foreground">{n.at}</span>
                        <p className="mt-0.5 leading-relaxed">{n.text}</p>
                      </div>
                    ))}
                    {(p.internalNotes ?? []).length === 0 && (
                      <p className="text-[11px] text-muted-foreground">No notes yet — discuss copy, timing or approvals here.</p>
                    )}
                    <div className="flex gap-1.5">
                      <SearchSelect
                        options={authors.map((a) => ({ value: a.name, label: a.name, detail: a.department }))}
                        value={noteAuthor}
                        onChange={setNoteAuthor}
                        placeholder="Author…"
                        searchPlaceholder="Search authors"
                        clearable={false}
                        className="h-7 w-24 text-[11px]"
                      />
                      <Input
                        value={noteText[p.id] ?? ''}
                        onChange={(e) => setNoteText((m) => ({ ...m, [p.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') addNote(p); }}
                        placeholder="Add a team note…"
                        className="h-7 text-[11px]"
                      />
                      <Button size="sm" variant="outline" className="h-7 shrink-0 text-[11px]" onClick={() => addNote(p)}>Add</Button>
                    </div>
                  </div>
                )}
                {replyOpen === p.id && (
                  <div className="flex gap-1.5">
                    <Input
                      value={replyText[p.id] ?? ''}
                      onChange={(e) => setReplyText((m) => ({ ...m, [p.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void sendReply(p); }}
                      placeholder={`Reply on ${CHANNEL_LABEL[p.channel]}…`}
                      className="h-7 text-[11px]"
                    />
                    <Button size="sm" className="h-7 shrink-0 text-[11px]" disabled={replyBusy === p.id} onClick={() => void sendReply(p)}>
                      {replyBusy === p.id ? 'Sending…' : 'Send reply'}
                    </Button>
                  </div>
                )}
              </div>
              {p.status === 'published' ? (
                <div className="mt-3 flex items-center gap-3 border-t pt-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{p.engagement.likes}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{p.engagement.comments}</span>
                  <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{p.engagement.shares}</span>
                </div>
              ) : p.status === 'scheduled' ? (
                <Button size="sm" className="mt-3 w-full" disabled={busyPost === p.id} onClick={() => void publishLive(p)} title={strategy.mode === 'live' ? 'Post live via Composio (falls back to the queue when unavailable)' : strategy.queueReason}>
                  <Send className="h-3.5 w-3.5" /> {busyPost === p.id ? 'Publishing…' : 'Publish now'}
                </Button>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setPostStatus(p.id, 'scheduled')}>
                    <CalendarClock className="h-3.5 w-3.5" /> Schedule
                  </Button>
                  <Button size="sm" className="flex-1" disabled={busyPost === p.id} onClick={() => void publishLive(p)} title={strategy.mode === 'live' ? 'Post live via Composio (falls back to the queue when unavailable)' : strategy.queueReason}>
                    <Send className="h-3.5 w-3.5" /> {busyPost === p.id ? 'Publishing…' : 'Publish'}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose a post</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Channels</label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {(Object.keys(CHANNEL_LABEL) as SocialChannel[]).map((c) => {
                  const active = form.channels.has(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => {
                        const next = new Set(f.channels);
                        if (next.has(c)) next.delete(c); else next.add(c);
                        return { ...f, channels: next };
                      })}
                      title={strategyFor(c).mode === 'queue' ? `${strategyFor(c).queueReason ?? ''} ${strategyFor(c).nextStep ?? ''}` : `Publish to ${CHANNEL_LABEL[c]}`}
                      className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                    >
                      {CHANNEL_LABEL[c]}
                      {strategyFor(c).mode === 'queue' && <span className="text-[9px] uppercase text-amber-600">queue</span>}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Each channel gets its own post; linked channels publish live, the rest queue.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Content</label>
              <div className="mt-1">
                <MarketingComposer channel={selectedChannels[0]} value={form.content} onChange={(v) => setForm({ ...form, content: v })} />
              </div>
            </div>
            {selectedChannels.length > 1 && (
              <p className="rounded-lg bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                {selectedChannels.length} channels selected — the final limit is {audienceSizeLimit} characters (smallest window).
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Author</label>
                <SearchSelect
                  options={authors.map((a) => ({ value: a.name, label: a.name, detail: a.department }))}
                  value={form.author}
                  onChange={(v) => setForm({ ...form, author: v || form.author })}
                  placeholder="Author…"
                  searchPlaceholder="Search authors"
                  clearable={false}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Schedule for</label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => submit(false)}>
                <Clock className="h-4 w-4" /> Save / schedule
              </Button>
              <Button className="flex-1" onClick={() => submit(true)}>
                <Send className="h-4 w-4" /> Publish now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PostEditDialog post={editPost} open={!!editPost} onOpenChange={(o) => { if (!o) setEditPost(null); }} />
    </div>
  );
}
