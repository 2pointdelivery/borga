// Turning a company's website into knowledge-base entries. Pure (no network): website-server.ts fetches the pages, this reads them.
//
// It is deliberately plain: it reads what the site says about itself (title, description, headings, the first real paragraphs,
// contact details, social links) and proposes entries for the user to review. It does not summarise or interpret. Everything it returns
// is plain text, never HTML, and the user approves each entry before it is saved.

import type { KnowledgeCategoryId } from './data';

export interface PageInfo {
  url: string;
  title: string;
  description: string;
  headings: string[];
  paragraphs: string[];
  emails: string[];
  phones: string[];
  socials: string[];
  links: Array<{ href: string; text: string }>;
}

export interface WebFact {
  id: string;
  category: KnowledgeCategoryId;
  title: string;
  answer: string;
  /** The page it came from. */
  source: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: '(c)', reg: '(R)', trade: '(TM)' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}
const safeChar = (n: number) => (n > 8 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ');

const tidy = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();

/** The text inside a tag with all tags removed. */
const stripTags = (s: string) => tidy(s.replace(/<[^>]*>/g, ' '));

const SOCIAL = /^https?:\/\/(?:www\.)?(linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|tiktok\.com)\/[^\s"'<>]+/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+|00)\d[\d\s().-]{7,17}\d|\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g;

function metaContent(html: string, key: string): string {
  const re = new RegExp(`<meta\\s+[^>]*(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  if (!tag) return '';
  const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return tidy(c?.[1] ?? c?.[2] ?? '');
}

const junkEmail = /(^|[._-])(example|noreply|no-reply|donotreply|sentry|wixpress)|\.(png|jpe?g|gif|svg|webp)$|@(sentry|example)\./i;

/** Reads one page's HTML. `url` is where it was fetched from, used to resolve links. */
export function extractPage(html: string, url: string): PageInfo {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas)\b[\s\S]*?<\/\1>/gi, ' ');
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(clean)?.[1] ?? '') || metaContent(clean, 'og:title');
  const description = metaContent(clean, 'description') || metaContent(clean, 'og:description');

  const headings: string[] = [];
  for (const m of clean.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = stripTags(m[2]);
    if (t.length >= 3 && t.length <= 120 && !headings.includes(t)) headings.push(t);
    if (headings.length >= 24) break;
  }

  // the page's own words: paragraphs and list items inside the main content when there is one
  const main = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(clean)?.[2] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(clean)?.[1] ?? clean;
  const body = main.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const paragraphs: string[] = [];
  for (const m of body.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = stripTags(m[2]);
    // a real sentence, not a menu label or a cookie notice
    if (t.length >= 40 && t.length <= 700 && /[a-z]{3}/i.test(t) && !/cookie|privacy policy|all rights reserved|subscribe to|accept all/i.test(t) && !paragraphs.includes(t)) paragraphs.push(t);
    if (paragraphs.length >= 20) break;
  }

  const text = stripTags(clean);
  const emails = [...new Set<string>([...(text.match(EMAIL) ?? []), ...[...clean.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1]))])]
    .map((e) => e.toLowerCase()).filter((e) => !junkEmail.test(e)).slice(0, 6);
  const phones = [...new Set<string>([...[...clean.matchAll(/tel:([^"'>]+)/gi)].map((m) => decodeURIComponent(m[1]).trim()), ...(text.match(PHONE) ?? [])])]
    .map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15).slice(0, 4);

  const links: PageInfo['links'] = [];
  const socials = new Set<string>();
  for (const m of clean.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript):/i.test(raw)) continue;
    let abs: string;
    try { abs = new URL(raw, url).href; } catch { continue; }
    if (SOCIAL.test(abs)) { socials.add(abs.split('?')[0].replace(/\/$/, '')); continue; }
    links.push({ href: abs, text: stripTags(m[3]).slice(0, 80) });
  }
  return { url, title, description, headings, paragraphs, emails, phones, socials: [...socials].slice(0, 8), links };
}

const WANTED = /\b(about|about-us|who-we-are|our-story|company|services?|solutions?|products?|what-we-do|offerings?|pricing|plans|contact|team|faq|careers?)\b/i;
const SKIP = /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|docx?|xlsx?)(\?|$)|\/(login|signin|sign-in|signup|register|cart|checkout|account|wp-admin|tag|category|author|feed)(\/|$)|\?(.*&)?(utm_|replytocom)/i;

/** Which other pages of the same site are worth reading, best first: about, services, pricing, contact. */
export function pickPages(home: PageInfo, limit = 5): string[] {
  const origin = new URL(home.url).origin;
  const seen = new Set([normalize(home.url)]);
  const scored: Array<{ href: string; score: number }> = [];
  for (const l of home.links) {
    let u: URL;
    try { u = new URL(l.href); } catch { continue; }
    if (u.origin !== origin || SKIP.test(u.pathname + u.search)) continue;
    const key = normalize(u.href);
    if (seen.has(key)) continue;
    const path = u.pathname.toLowerCase();
    const hit = WANTED.test(path) ? 2 : WANTED.test(l.text) ? 1 : 0;
    if (!hit) continue;
    seen.add(key);
    scored.push({ href: u.origin + u.pathname, score: hit * 10 - Math.min(path.split('/').length, 6) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.href);
}

const normalize = (href: string) => { try { const u = new URL(href); return (u.origin + u.pathname).replace(/\/$/, '').toLowerCase(); } catch { return href; } };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const kindOf = (url: string): 'home' | 'about' | 'services' | 'pricing' | 'contact' | 'other' => {
  const p = new URL(url).pathname.toLowerCase();
  if (p === '/' || p === '') return 'home';
  if (/about|who-we-are|our-story|company|team/.test(p)) return 'about';
  if (/service|solution|product|what-we-do|offering/.test(p)) return 'services';
  if (/pricing|plans/.test(p)) return 'pricing';
  if (/contact/.test(p)) return 'contact';
  return 'other';
};

/** Headings that are a question or an invitation, not the name of something the company sells. */
const CTA_HEADING = /\?$|^(take|how|why|what|who|when|where|meet|see|get|try|learn|join|start|sign|read|watch|find|discover|ready|let|big|trusted|loved|our customers|hear|check|explore|talk|book|schedule|request|download|call|contact|ask|your)\b/i;
const GENERIC_HEADING = /^(home|welcome|menu|contact( us)?|about( us)?|our (services|products|team|story)|services|products|pricing|faq|get started|learn more|read more|blog|news|testimonials|why choose us|resources|careers|join us|follow us|subscribe|newsletter|log ?in|sign ?up)$/i;

/** The entries to propose, from the pages read. Each says where it came from, so the user can judge it. */
export function buildFacts(pages: PageInfo[], siteUrl: string): WebFact[] {
  const facts: WebFact[] = [];
  const host = (() => { try { return new URL(siteUrl).host; } catch { return siteUrl; } })();
  const add = (category: KnowledgeCategoryId, title: string, answer: string, source: string) => {
    const a = answer.trim();
    if (a && !facts.some((f) => f.title === title)) facts.push({ id: `web-${facts.length}`, category, title, answer: a, source });
  };
  const home = pages.find((p) => kindOf(p.url) === 'home') ?? pages[0];
  const about = pages.find((p) => kindOf(p.url) === 'about');
  const services = pages.filter((p) => kindOf(p.url) === 'services');
  const pricing = pages.find((p) => kindOf(p.url) === 'pricing');

  if (home) {
    const what = home.description || home.paragraphs[0] || '';
    add('company', 'What does the company do?', clip(what, 500), home.url);
  }
  if (about) {
    const t = about.paragraphs.slice(0, 3).join(' ');
    add('company', 'About the company', clip(t || about.description, 700), about.url);
  }
  // services pages first, then the home page: its headings are often the list of what the company sells
  const headingSource = [...services, ...(home ? [home] : [])];
  const serviceHeadings = headingSource
    .flatMap((p) => p.headings.filter((h) => !GENERIC_HEADING.test(h) && !CTA_HEADING.test(h) && h.length <= 80 && h.split(' ').length <= 8))
    .filter((h, i, all) => all.indexOf(h) === i && h !== home?.title).slice(0, 12);
  if (serviceHeadings.length >= 2) {
    const src = services[0]?.url ?? home?.url ?? siteUrl;
    add('services', 'Services & products', `Listed on the website: ${serviceHeadings.join('; ')}.`, src);
  }
  for (const s of services.slice(0, 2)) {
    const t = s.paragraphs.slice(0, 2).join(' ');
    if (t) add('services', `About: ${clip(s.title || new URL(s.url).pathname, 60)}`, clip(t, 500), s.url);
  }
  if (pricing) {
    const t = pricing.paragraphs.slice(0, 2).join(' ') || pricing.headings.filter((h) => !GENERIC_HEADING.test(h)).slice(0, 6).join('; ');
    add('services', 'Pricing (as shown on the website)', clip(t, 500), pricing.url);
  }
  const emails = [...new Set(pages.flatMap((p) => p.emails))].slice(0, 4);
  const phones = [...new Set(pages.flatMap((p) => p.phones))].slice(0, 3);
  if (emails.length || phones.length) {
    add('company', 'Contact details', [emails.length ? `Email: ${emails.join(', ')}` : '', phones.length ? `Phone: ${phones.join(', ')}` : ''].filter(Boolean).join('. ') + '.', pages.find((p) => kindOf(p.url) === 'contact')?.url ?? siteUrl);
  }
  const socials = [...new Set(pages.flatMap((p) => p.socials))].slice(0, 6);
  if (socials.length) add('content', 'Social profiles', socials.join(', '), siteUrl);
  if (home?.title) add('company', 'Website', `${host}: ${clip(home.title, 120)}`, siteUrl);
  return facts;
}

/** The address a person typed, as a safe https URL, or null. "acme.com", "www.acme.com" and "https://acme.com/" all work. */
export function normalizeSiteUrl(input: string): string | null {
  const t = input.trim();
  if (!t || /\s/.test(t) || t.length > 300) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') || u.username || u.password) return null;
    u.protocol = 'https:';
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

/** Does robots.txt allow a polite crawler to read this path? Only the rules for "*" and for our own name are honoured. */
export function robotsAllows(robots: string, path: string, agent = 'borgabot'): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push({ allow: k === 'allow', path: v });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.includes(agent));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules) {
    if (!r.path) continue; // "Disallow:" with nothing means everything is allowed
    const re = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { len: r.path.length, allow: r.allow };
  }
  return best ? best.allow : true;
}
