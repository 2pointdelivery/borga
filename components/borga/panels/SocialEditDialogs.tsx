'use client';

import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { CHANNEL_LABEL, type SocialChannel, type SocialPost, type SocialStatus, type AdCampaign, type AdPlatform } from '@/lib/borga/data';

const AD_PLATFORM_LABEL: Record<AdPlatform, string> = { ...CHANNEL_LABEL, google: 'Google Ads' };

export function PostEditDialog({ post, open, onOpenChange }: { post: SocialPost | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updatePost, deletePost, log } = useBorga();
  const [form, setForm] = useState<SocialPost | null>(null);
  const editing = form ?? post;
  const patch = (p: Partial<SocialPost>) => setForm((f) => (post ? { ...(f ?? post), ...p } : f));

  const save = () => {
    if (!editing || !editing.content.trim()) return;
    updatePost(editing.id, {
      channel: editing.channel,
      content: editing.content.trim(),
      status: editing.status,
      scheduledAt: editing.scheduledAt,
      author: editing.author,
    });
    log({ agentId: 'a-marketing', agentName: editing.author, actor: 'user', kind: 'task', message: `Updated post on ${CHANNEL_LABEL[editing.channel]}.` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!post) return;
    deletePost(post.id);
    log({ agentId: 'a-marketing', agentName: post.author, actor: 'user', kind: 'task', message: 'Deleted a social post.' });
    setForm(null);
    onOpenChange(false);
  };

  return (
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
                  <Input className="mt-1" value={editing.author} onChange={(e) => patch({ author: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Schedule</label>
                  <Input className="mt-1" value={editing.scheduledAt} onChange={(e) => patch({ scheduledAt: e.target.value })} />
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
  );
}

export function CampaignEditDialog({ campaign, open, onOpenChange }: { campaign: AdCampaign | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updateCampaign, deleteCampaign, log } = useBorga();
  const [form, setForm] = useState<AdCampaign | null>(null);
  const editing = form ?? campaign;
  const patch = (p: Partial<AdCampaign>) => setForm((f) => (campaign ? { ...(f ?? campaign), ...p } : f));

  const save = () => {
    if (!editing || !editing.name.trim()) return;
    updateCampaign(editing.id, {
      name: editing.name.trim(),
      platform: editing.platform,
      budget: editing.budget,
      spent: editing.spent,
      status: editing.status,
    });
    log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'user', kind: 'task', message: `Updated campaign ${editing.name.trim()}.` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!campaign) return;
    deleteCampaign(campaign.id);
    log({ agentId: 'a-paidmedia', agentName: 'Paige', actor: 'user', kind: 'task', message: `Deleted campaign ${campaign.name}.` });
    setForm(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-md" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit campaign</DialogTitle>
              <DialogDescription>Update budget, spend and status.</DialogDescription>
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
  );
}
