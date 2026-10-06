import type { SocialChannel } from './data';

/**
 * Social publishing strategy per channel, kept pure (no I/O) so it can be
 * unit tested. Live posting goes through the Composio proxy
 * (`/api/borga/composio` action `socialPost`); only channels with a verified,
 * directly-postable Composio action publish live. Everything else explains
 * why it stays queued — probed live against the Composio catalog:
 * - linkedin → LINKEDIN_CREATE_LINKED_IN_POST (author URN resolved server-side)
 * - twitter → TWITTER_CREATION_OF_A_POST (custom OAuth only — no managed creds)
 * - facebook → needs a Page ID; instagram/youtube/tiktok/pinterest → need media
 * - threads → no Composio toolkit exists yet
 */

export type PublishMode = 'live' | 'queue';

export interface ChannelStrategy {
  channel: SocialChannel;
  toolkit: string;
  mode: PublishMode;
  /** Why a post stays queued (live channels omit this). */
  queueReason?: string;
  /** What to do to unlock live posting. */
  nextStep?: string;
}

export const CHANNEL_STRATEGY: Record<SocialChannel, ChannelStrategy> = {
  linkedin: { channel: 'linkedin', toolkit: 'linkedin', mode: 'live' },
  twitter: {
    channel: 'twitter', toolkit: 'twitter', mode: 'live',
    nextStep: 'X needs a custom OAuth app — create the auth config at composio.dev/dashboard → Auth Configs, then connect.',
  },
  facebook: {
    channel: 'facebook', toolkit: 'facebook', mode: 'queue',
    queueReason: 'Facebook posting needs a Page ID.',
    nextStep: 'Connect Facebook, then pick the Page when publishing (or publish via Buffer).',
  },
  instagram: {
    channel: 'instagram', toolkit: 'instagram', mode: 'queue',
    queueReason: 'Instagram needs an image or video container.',
    nextStep: 'Attach media to publish a post live.',
  },
  tiktok: {
    channel: 'tiktok', toolkit: 'tiktok', mode: 'queue',
    queueReason: 'TikTok needs a video or photo, and a custom OAuth app (no managed credentials).',
    nextStep: 'Attach media and create a custom auth config at composio.dev/dashboard → Auth Configs.',
  },
  threads: {
    channel: 'threads', toolkit: '', mode: 'queue',
    queueReason: 'Threads has no Composio toolkit yet.',
    nextStep: 'Posts stay planned here until posting is available.',
  },
  youtube: {
    channel: 'youtube', toolkit: 'youtube', mode: 'queue',
    queueReason: 'YouTube needs a video upload.',
    nextStep: 'Attach a video to publish live.',
  },
  pinterest: {
    channel: 'pinterest', toolkit: 'pinterest', mode: 'queue',
    queueReason: 'Pinterest needs a board and an image.',
    nextStep: 'Attach an image and pick a board to publish live.',
  },
};

export function strategyFor(channel: SocialChannel): ChannelStrategy {
  return CHANNEL_STRATEGY[channel];
}

/** Toolkits with Composio-managed credentials (one-click auth config) as probed live. */
export const MANAGED_AUTH_TOOLKITS = ['linkedin', 'facebook', 'instagram', 'youtube', 'pinterest'] as const;

/** Toolkits needing a custom OAuth app (no managed credentials) as probed live. */
export const CUSTOM_AUTH_TOOLKITS = ['twitter', 'buffer', 'tiktok'] as const;

export function authKindForToolkit(toolkit: string): 'managed' | 'custom' | 'none' {
  if ((MANAGED_AUTH_TOOLKITS as readonly string[]).includes(toolkit)) return 'managed';
  if ((CUSTOM_AUTH_TOOLKITS as readonly string[]).includes(toolkit)) return 'custom';
  return 'none';
}

/** Verified Composio post/reply action slugs per channel. */
export const POST_ACTIONS = {
  linkedin: { post: 'LINKEDIN_CREATE_LINKED_IN_POST', me: 'LINKEDIN_GET_MY_INFO' },
  twitter: { post: 'TWITTER_CREATION_OF_A_POST' },
  facebook: { post: 'FACEBOOK_CREATE_POST', comment: 'FACEBOOK_CREATE_COMMENT' },
  instagram: { reply: 'INSTAGRAM_REPLY_TO_COMMENT' },
} as const;

export function buildLinkedInPostArgs(authorUrn: string, commentary: string): Record<string, unknown> {
  return { author: authorUrn, commentary };
}

/** Extract the LINKEDIN_GET_MY_INFO payload: Composio nests it under response_dict (sometimes data/result). */
export function extractLinkedInInfo(data: unknown): Record<string, unknown> {
  let cur = (data ?? {}) as Record<string, unknown>;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    if (typeof cur.author_id === 'string' || typeof cur.authorId === 'string' || typeof cur.urn === 'string') return cur;
    const next = (cur.response_dict ?? cur.data ?? cur.result) as unknown;
    if (!next || typeof next !== 'object' || next === cur) break;
    cur = next as Record<string, unknown>;
  }
  return cur && typeof cur === 'object' ? cur : {};
}

/** Extract the author URN from a LINKEDIN_GET_MY_INFO result (field varies). */
export function linkedInAuthorUrn(info: Record<string, unknown>): string {
  const v = info.author_id ?? info.authorId ?? info.urn ?? info.id ?? info.sub ?? '';
  return typeof v === 'string' ? v : '';
}

/** Ensure the URN is a full urn:li:person:<id> or urn:li:organization:<id> (digits/letters only). */
export function normalizeAuthorUrn(urn: string): string {
  const v = urn.trim();
  if (/^urn:li:(person|organization):[A-Za-z0-9_-]+$/.test(v)) return v;
  // Bare alphanumeric id from LinkedIn → person URN (members). Only digits counts route organizations upward.
  if (/^[A-Za-z0-9_-]+$/.test(v)) return `urn:li:person:${v}`;
  return v;
}

export function buildTwitterPostArgs(text: string, replyToTweetId?: string): Record<string, unknown> {
  if (replyToTweetId) return { text, reply: { in_reply_to_tweet_id: replyToTweetId } };
  return { text };
}

export function buildFacebookPostArgs(pageId: string, message: string): Record<string, unknown> {
  return { page_id: pageId, message, published: true };
}

export function buildFacebookCommentArgs(objectId: string, message: string): Record<string, unknown> {
  return { object_id: objectId, message };
}

export function buildInstagramReplyArgs(commentId: string, message: string): Record<string, unknown> {
  return { ig_comment_id: commentId, message };
}

/** Per-character limits enforced by the composer counter. */
export const CHANNEL_CHAR_LIMIT: Record<SocialChannel, number> = {
  linkedin: 3000,
  twitter: 280,
  facebook: 63206,
  instagram: 2200,
  tiktok: 2200,
  threads: 500,
  youtube: 5000,
  pinterest: 800,
};

export type PublishOutcome = { channel: SocialChannel; status: 'posted' | 'queued'; reason?: string; ref?: string };

/**
 * Multi-channel composer rule: one draft fans out to one post per channel.
 * A channel is picked live only when its account is linked; everything else
 * stays queued with the reason on that copy. The fan-out is deduped (the
 * same channel can never be selected twice in one run) — a bug the test
 * guards against, since a duplicate would double-post to the same account.
 */
export function fanOutChannels(channels: SocialChannel[], linked: (c: SocialChannel) => boolean): { live: SocialChannel[]; queued: SocialChannel[] } {
  const unique = [...new Set(channels)];
  const live: SocialChannel[] = [];
  const queued: SocialChannel[] = [];
  for (const c of unique) (linked(c) ? live : queued).push(c);
  return { live, queued };
}
