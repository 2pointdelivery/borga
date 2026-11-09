'use client';

/**
 * Pure threading engine for the unified inbox: every communication becomes an
 * item on a timeline, grouped into one thread per contact (email address,
 * phone number, or lead identity — whichever the messages actually carry).
 * Tested in lib/inbox-threads.test.ts.
 */

export type InboxChannel = 'email' | 'sms' | 'whatsapp' | 'telegram' | 'call' | 'secure';

export interface InboxItem {
  id: string;
  channel: InboxChannel;
  /** Contact identity the thread keys on (email/phone/lead id). */
  contactKey: string;
  /** Display name for the thread (person/company). */
  contactName: string;
  /** Secondary display (address, number, company…). */
  contactDetail?: string;
  subject?: string;
  body: string;
  status: 'sent' | 'scheduled' | 'failed' | 'draft' | 'completed' | 'active' | 'voicemail';
  at: string; // ISO, or '' → sorted last
  mode?: 'single' | 'bulk';
  count?: number;
  /** Optional deep link for a related record (lead id, customer id…). */
  linkId?: string;
  note?: string; // delivery error / call note
}

export interface InboxThread {
  key: string;
  contactName: string;
  contactDetail?: string;
  channels: InboxChannel[];
  items: InboxItem[]; // newest first
  lastAt: string;
  lastItem: InboxItem;
  counts: { total: number; failed: number; draft: number; scheduled: number };
}

const EMAIL_RE = /<([^<>@]+@[^<>@]+\.[^<>@]+)>/; // "Ada <ada@acme.com>"
const EMAIL_BARE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
const PHONE_RE = /\+?\d[\d\s().-]{6,}/;

/** The stable per-contact key an item threads on. */
export function threadKeyOf(item: Pick<InboxItem, 'contactKey' | 'contactDetail' | 'contactName' | 'channel'>): string {
  const key = (item.contactKey ?? '').trim().toLowerCase();
  if (key) return key;
  const detail = (item.contactDetail ?? '').trim().toLowerCase();
  if (detail && (EMAIL_BARE.test(detail) || PHONE_RE.test(detail))) return detail;
  return item.contactName.trim().toLowerCase() || 'unknown';
}

/** Groups items into per-contact threads, newest activity first. */
export function buildThreads(items: InboxItem[]): InboxThread[] {
  const byKey = new Map<string, InboxThread>();
  for (const item of items) {
    const key = threadKeyOf(item);
    let t = byKey.get(key);
    if (!t) {
      t = { key, contactName: item.contactName || key, contactDetail: item.contactDetail, channels: [], items: [], lastAt: '', lastItem: item, counts: { total: 0, failed: 0, draft: 0, scheduled: 0 } };
      byKey.set(key, t);
    }
    t.items.push(item);
    t.counts.total++;
    if (item.status === 'failed') t.counts.failed++;
    if (item.status === 'draft') t.counts.draft++;
    if (item.status === 'scheduled') t.counts.scheduled++;
    if (!t.channels.includes(item.channel)) t.channels.push(item.channel);
    if (item.contactDetail && !t.contactDetail) t.contactDetail = item.contactDetail;
  }
  for (const t of byKey.values()) {
    t.items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    t.lastItem = t.items[0];
    t.lastAt = t.lastItem?.at ?? '';
  }
  return [...byKey.values()].sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
}

/** Folder filter for the left rail. */
export type InboxFolder = 'all' | 'sent' | 'scheduled' | 'drafts' | 'failed';

export function threadMatchesFolder(t: InboxThread, folder: InboxFolder): boolean {
  switch (folder) {
    case 'all': return true;
    case 'failed': return t.counts.failed > 0;
    case 'drafts': return t.counts.draft > 0;
    case 'scheduled': return t.counts.scheduled > 0;
    case 'sent': return t.counts.total - t.counts.failed - t.counts.draft - t.counts.scheduled > 0;
  }
}

export function itemMatchesFolder(i: InboxItem, folder: InboxFolder): boolean {
  switch (folder) {
    case 'all': return true;
    case 'failed': return i.status === 'failed';
    case 'drafts': return i.status === 'draft';
    case 'scheduled': return i.status === 'scheduled';
    case 'sent': return i.status === 'sent' || i.status === 'completed' || i.status === 'active' || i.status === 'voicemail';
  }
}

/** Pulls a contact address out of the freeform "Name <addr>" shapes CommsMessage stores. */
export function addressOf(to: string): { name: string; address: string } {
  const t = (to ?? '').trim();
  const m = EMAIL_RE.exec(t);
  if (m) return { name: t.slice(0, m.index).trim() || m[1], address: m[1] };
  if (EMAIL_BARE.test(t)) return { name: t, address: t };
  const phone = PHONE_RE.exec(t);
  if (phone) return { name: t.replace(phone[0], '').trim() || phone[0], address: phone[0].trim() };
  return { name: t, address: t.toLowerCase() };
}
