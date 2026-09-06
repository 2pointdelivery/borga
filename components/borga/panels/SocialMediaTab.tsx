'use client';

import { useState } from 'react';
import { Plus, Send, Clock, ThumbsUp, MessageCircle, Share2, CalendarClock, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBorga } from '@/lib/borga/store';
import { CHANNEL_COLOR, CHANNEL_LABEL, type SocialChannel } from '@/lib/borga/data';
import { AgentAvatar, SectionTitle } from '../bits';
import { PostEditDialog } from './SocialEditDialogs';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground ring-border',
  scheduled: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  published: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
};

export function SocialMediaTab() {
  const { posts, addPost, setPostStatus, agents, log } = useBorga();
  const [open, setOpen] = useState(false);
  const [editPost, setEditPost] = useState<(typeof posts)[number] | null>(null);
  const [form, setForm] = useState({ channel: 'linkedin' as SocialChannel, content: '', scheduledAt: '', author: 'Nova' });

  const channelSummary = (Object.keys(CHANNEL_LABEL) as SocialChannel[]).map((c) => {
    const ch = posts.filter((p) => p.channel === c);
    return {
      channel: c,
      total: ch.length,
      published: ch.filter((p) => p.status === 'published').length,
      likes: ch.reduce((s, p) => s + p.engagement.likes, 0),
      comments: ch.reduce((s, p) => s + p.engagement.comments, 0),
      shares: ch.reduce((s, p) => s + p.engagement.shares, 0),
    };
  });

  const submit = (publishNow: boolean) => {
    if (!form.content.trim()) return;
    addPost({
      id: `p-${Date.now()}`,
      channel: form.channel,
      content: form.content.trim(),
      status: publishNow ? 'published' : form.scheduledAt ? 'scheduled' : 'draft',
      scheduledAt: publishNow ? 'Just now' : form.scheduledAt || '…',
      author: form.author,
      engagement: { likes: 0, comments: 0, shares: 0 },
    });
    log({ agentId: 'a-marketing', agentName: form.author, actor: 'agent', kind: 'task', message: `${publishNow ? 'Published' : 'Scheduled'} post to ${CHANNEL_LABEL[form.channel]}.` });
    setForm({ channel: 'linkedin', content: '', scheduledAt: '', author: 'Nova' });
    setOpen(false);
  };

  const counts = posts.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Social media postings" sub="Compose, schedule and publish across every channel" />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New post
        </Button>
      </div>

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
        <SectionTitle title="Posting summary by channel" sub="Content volume and engagement per social network" />
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          {channelSummary.map((c) => (
            <div key={c.channel} className="rounded-xl border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', CHANNEL_COLOR[c.channel])}>
                  {CHANNEL_LABEL[c.channel]}
                </span>
                <span className="text-[11px] text-muted-foreground">{c.published}/{c.total} live</span>
              </div>
              <p className="mt-2 text-lg font-semibold">{c.total}</p>
              <p className="text-[10px] text-muted-foreground">posts</p>
              <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                <p className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" /> {c.likes}</p>
                <p className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {c.comments}</p>
                <p className="flex items-center gap-1"><Share2 className="h-3 w-3" /> {c.shares}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {posts.map((p) => {
          const author = agents.find((a) => a.name === p.author);
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
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                {author ? <AgentAvatar name={author.name} color={author.avatarColor} size={20} /> : null}
                <span>{p.author}</span>
                <span className="ml-auto flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {p.scheduledAt}
                </span>
              </div>
              {p.status === 'published' ? (
                <div className="mt-3 flex items-center gap-3 border-t pt-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{p.engagement.likes}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{p.engagement.comments}</span>
                  <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{p.engagement.shares}</span>
                </div>
              ) : p.status === 'scheduled' ? (
                <Button size="sm" className="mt-3 w-full" onClick={() => setPostStatus(p.id, 'published')}>
                  <Send className="h-3.5 w-3.5" /> Publish now
                </Button>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setPostStatus(p.id, 'scheduled')}>
                    <CalendarClock className="h-3.5 w-3.5" /> Schedule
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => setPostStatus(p.id, 'published')}>
                    <Send className="h-3.5 w-3.5" /> Publish
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
              <label className="text-xs font-medium text-muted-foreground">Channel</label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v as SocialChannel })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABEL) as SocialChannel[]).map((c) => (
                    <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Content</label>
              <Textarea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Write your post…" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Author</label>
                <Select value={form.author} onValueChange={(v) => setForm({ ...form, author: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {agents.filter((a) => ['Nova', 'Maya', 'Paige', 'Atlas'].includes(a.name)).map((a) => (
                      <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
