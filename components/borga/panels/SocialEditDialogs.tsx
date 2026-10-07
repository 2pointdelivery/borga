'use client';

import { useState } from 'react';
import { Save, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { CHANNEL_LABEL, type SocialChannel, type SocialPost, type SocialStatus, type AdCampaign, type AdPlatform } from '@/lib/borga/data';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';

const AD_PLATFORM_LABEL: Record<AdPlatform, string> = { ...CHANNEL_LABEL, google: 'Google Ads' };

/** Team note input used on campaign drafts. */
export function AdNoteInput({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText('');
  };
  return (
    <div className="flex gap-1.5">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        placeholder="Add a team note…"
        className="h-7 text-[11px]"
      />
      <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1 text-[11px]" onClick={add}>
        <Send className="h-3 w-3" /> Add
      </Button>
    </div>
  );
}

export function PostEditDialog({ post, open, onOpenChange }: { post: SocialPost | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updatePost, deletePost, agents, log } = useBorga();
  const [form, setForm] = useState<SocialPost | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = form ?? post;
  const patch = (p: Partial<SocialPost>) => setForm((f) => (post ? { ...(f ?? post), ...p } : f));
  const authors = agents.filter((a) => ['Marketing', 'Paid Media', 'Command Center'].includes(a.department));
  const authorOptions = (authors.length ? authors : agents).map((a) => ({ value: a.name, label: a.name, detail: a.department }));

  const save = () => {
    if (!editing || !editing.content.trim()) return;
    updatePost(editing.id, {
      channel: editing.channel,
      content: editing.content.trim(),
      status: editing.status,
      scheduledAt: editing.scheduledAt,
      author: editing.author,
      engagement: {
        likes: Math.max(0, editing.engagement.likes),
        comments: Math.max(0, editing.engagement.comments),
        shares: Math.max(0, editing.engagement.shares),
      },
    });
    log({ agentId: 'a-marketing', agentName: editing.author, actor: 'user', kind: 'task', message: `Updated post on ${CHANNEL_LABEL[editing.channel]}.` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!post) return;
    setConfirmDelete(true);
  };

  const doRemove = () => {
    if (!post) return;
    deletePost(post.id);
    log({ agentId: 'a-marketing', agentName: post.author, actor: 'user', kind: 'task', message: 'Deleted a social post.' });
    setForm(null);
    setConfirmDelete(false);
    onOpenChange(false);
  };

  const patchEngagement = (key: 'likes' | 'comments' | 'shares', v: number) => {
    patch({ engagement: { ...editing!.engagement, [key]: Math.max(0, Math.floor(v) || 0) } });
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-lg" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit post</DialogTitle>
              <DialogDescription>Update the copy, channel or status.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Channel</label>
                  <Select value={editing.channel} onValueChange={(v) => patch({ channel: v as SocialChannel })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CHANNEL_LABEL) as SocialChannel[]).map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={editing.status} onValueChange={(v) => patch({ status: v as SocialStatus })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Content</label>
                <Textarea rows={4} className="mt-1" value={editing.content} onChange={(e) => patch({ content: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Author</label>
                  <SearchSelect
                    options={authorOptions}
                    value={authorOptions.some((o) => o.value === editing.author) ? editing.author : ''}
                    onChange={(v) => patch({ author: v || editing.author })}
                    placeholder="Author…"
                    searchPlaceholder="Search authors"
                    clearable={false}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Schedule</label>
                  <Input type="datetime-local" className="mt-1" value={datetimeLocalValue(editing.scheduledAt)} onChange={(e) => patch({ scheduledAt: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Engagement (recorded results)</label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {(['likes', 'comments', 'shares'] as const).map((k) => (
                    <div key={k}>
                      <p className="mb-0.5 text-[10px] capitalize text-muted-foreground">{k}</p>
                      <Input type="number" min={0} value={editing.engagement[k]} onChange={(e) => patchEngagement(k, Number(e.target.value))} className="h-8" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={remove} title="Delete post">
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
                <Button className="flex-1 gap-1.5" onClick={save}>
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this post?"
        description="The post and its team notes are removed permanently."
        confirmLabel="Delete post"
        onConfirm={doRemove}
      />
    </>
  );
}

/** Stored schedule values render back into a datetime-local input when possible. */
function datetimeLocalValue(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16);
  return '';
}

export function CampaignEditDialog({ campaign, open, onOpenChange }: { campaign: AdCampaign | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updateCampaign, deleteCampaign, userName, log } = useBorga();
  const [form, setForm] = useState<AdCampaign | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = form ?? campaign;
  const patch = (p: Partial<AdCampaign>) => setForm((f) => (campaign ? { ...(f ?? campaign), ...p } : f));
  const author = userName?.trim() ? userName.trim() : 'Team';

  const save = () => {
    if (!editing || !editing.name.trim()) return;
    updateCampaign(editing.id, {
      name: editing.name.trim(),
      platform: editing.platform,
      budget: editing.budget,
      spent: editing.spent,
      impressions: Math.max(0, editing.impressions),
      clicks: Math.max(0, editing.clicks),
      conversions: Math.max(0, editing.conversions),
      roas: Math.max(0, editing.roas),
      status: editing.status,
      draft: editing.draft?.headline || editing.draft?.body || editing.draft?.link
        ? { headline: editing.draft!.headline.trim(), body: editing.draft!.body.trim(), link: editing.draft!.link.trim(), imageText: editing.draft!.imageText?.trim() }
        : editing.draft,
    });
    log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'user', kind: 'task', message: `Updated campaign ${editing.name.trim()}.` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!campaign) return;
    setConfirmDelete(true);
  };

  const doRemove = () => {
    if (!campaign) return;
    deleteCampaign(campaign.id);
    log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'user', kind: 'task', message: `Deleted campaign ${campaign.name}.` });
    setForm(null);
    setConfirmDelete(false);
    onOpenChange(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-md" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit campaign</DialogTitle>
              <DialogDescription>Update budget, spend, results and status.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Campaign name</label>
                <Input className="mt-1" value={editing.name} onChange={(e) => patch({ name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Platform</label>
                  <Select value={editing.platform} onValueChange={(v) => patch({ platform: v as AdPlatform })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(AD_PLATFORM_LABEL) as AdPlatform[]).map((p) => <SelectItem key={p} value={p}>{AD_PLATFORM_LABEL[p]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={editing.status} onValueChange={(v) => patch({ status: v as AdCampaign['status'] })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="ended">Ended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Budget ($)</label>
                  <Input type="number" className="mt-1" value={editing.budget} onChange={(e) => patch({ budget: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Spent ($)</label>
                  <Input type="number" className="mt-1" value={editing.spent} onChange={(e) => patch({ spent: Number(e.target.value) || 0 })} />
                </div>
              </div>

              {/* Results — copy these from the ad platform so ROAS and conversion cards stay live */}
              <div className="rounded-xl border p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Results</p>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Impr.</label>
                    <Input type="number" min={0} className="mt-1" value={editing.impressions} onChange={(e) => patch({ impressions: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Clicks</label>
                    <Input type="number" min={0} className="mt-1" value={editing.clicks} onChange={(e) => patch({ clicks: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Conv.</label>
                    <Input type="number" min={0} className="mt-1" value={editing.conversions} onChange={(e) => patch({ conversions: Number(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">ROAS ×</label>
                    <Input type="number" min={0} step="0.1" className="mt-1" value={editing.roas} onChange={(e) => patch({ roas: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              </div>

              {/* Creative draft — the actual ad copy lives here until the campaign runs */}
              <div className="rounded-xl border p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ad draft</p>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Headline</label>
                  <Input className="mt-1" value={editing.draft?.headline ?? ''} onChange={(e) => patch({ draft: { ...editing.draft, headline: e.target.value, body: editing.draft?.body ?? '', link: editing.draft?.link ?? '' } })} placeholder="Fast, reliable freight across Europe" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Body</label>
                  <Textarea rows={3} className="mt-1" value={editing.draft?.body ?? ''} onChange={(e) => patch({ draft: { ...editing.draft, headline: editing.draft?.headline ?? '', body: e.target.value, link: editing.draft?.link ?? '' } })} placeholder="Door-to-door with fixed time windows. Request a freight quote today." />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Link</label>
                    <Input className="mt-1" value={editing.draft?.link ?? ''} onChange={(e) => patch({ draft: { ...editing.draft, headline: editing.draft?.headline ?? '', body: editing.draft?.body ?? '', link: e.target.value } })} placeholder="https://…/quote" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Image alt text (optional)</label>
                    <Input className="mt-1" value={editing.draft?.imageText ?? ''} onChange={(e) => patch({ draft: { ...editing.draft, headline: editing.draft?.headline ?? '', body: editing.draft?.body ?? '', link: editing.draft?.link ?? '', imageText: e.target.value } })} placeholder="Fleet on the road" />
                  </div>
                </div>
              </div>

              {/* Team notes — discuss creative before it runs */}
              <div className="rounded-xl border p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Team notes</p>
                <div className="space-y-1.5">
                  {(editing.internalNotes ?? []).map((n) => (
                    <div key={n.id} className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]">
                      <span className="font-medium">{n.author}</span> <span className="text-muted-foreground">{n.at}</span>
                      <p className="mt-0.5 leading-relaxed">{n.text}</p>
                    </div>
                  ))}
                  {(editing.internalNotes ?? []).length === 0 && (
                    <p className="text-[11px] text-muted-foreground">No notes yet — discuss targeting, messaging or budget here.</p>
                  )}
                  <AdNoteInput onAdd={(text) => patch({ internalNotes: [...(editing.internalNotes ?? []), { id: `n-${Date.now()}`, author, text, at: 'Just now' }] })} />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={remove} title="Delete campaign">
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
                <Button className="flex-1 gap-1.5" onClick={save}>
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete campaign "${campaign?.name ?? ''}"?`}
        description="The campaign, its draft creative and team notes are removed permanently."
        confirmLabel="Delete campaign"
        onConfirm={doRemove}
      />
    </>
  );
}
