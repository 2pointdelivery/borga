import { NextResponse } from 'next/server';
import { fetchPublic, readTextCapped } from '@/lib/borga/safe-url';

export const runtime = 'nodejs';

// Enhanced text extraction with better content preservation
function extractText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Remove common navigation/footer patterns
  text = text
    .replace(/\b(skip to content|menu|search|login|sign in|register|contact|privacy|terms|cookies)\b/gi, '')
    .replace(/\b(home|about|services|products|blog|news|contact us)\b/gi, '');

  return text.slice(0, 6000);
}

// Extract structured content (headings, paragraphs, lists)
function extractStructuredContent(html: string): { headings: string[]; paragraphs: string[]; lists: string[] } {
  const headings: string[] = [];
  const paragraphs: string[] = [];
  const lists: string[] = [];

  // Extract headings
  const headingMatches = [...html.matchAll(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi)];
  headings.push(...headingMatches.map(m => m[1].trim()).slice(0, 10));

  // Extract paragraphs
  const paragraphMatches = [...html.matchAll(/<p[^>]*>([^<]+)<\/p>/gi)];
  paragraphs.push(...paragraphMatches.map(m => m[1].trim()).slice(0, 15));

  // Extract list items
  const listMatches = [...html.matchAll(/<li[^>]*>([^<]+)<\/li>/gi)];
  lists.push(...listMatches.map(m => m[1].trim()).slice(0, 10));

  return { headings, paragraphs, lists };
}

// Extract links with better filtering and prioritization
function extractLinks(html: string, base: string): string[] {
  const matches = [...html.matchAll(/href=["']([^"'#]+)["']/gi)];
  const links = matches
    .map((m) => {
      try {
        const url = new URL(m[1], base);
        // Prioritize same-origin and important paths
        const isSameOrigin = url.hostname === new URL(base).hostname;
        const isImportantPath = /\/(about|services|products|blog|news|contact)/i.test(url.pathname);
        return { 
          href: url.href, 
          priority: isSameOrigin ? (isImportantPath ? 3 : 2) : 1 
        };
      } catch {
        return null;
      }
    })
    .filter((l): l is { href: string; priority: number } => l !== null && l.href.startsWith('http'))
    .sort((a, b) => b.priority - a.priority)
    .map(l => l.href)
    .filter((l, i, arr) => arr.indexOf(l) === i)
    .slice(0, 12);
  return links;
}

// Extract page title from HTML with fallbacks
function extractTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (m) return m[1].trim().slice(0, 120);
  
  // Try to get from meta tags
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitle) return ogTitle[1].trim().slice(0, 120);
  
  const twitterTitle = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
  if (twitterTitle) return twitterTitle[1].trim().slice(0, 120);
  
  return fallback;
}

// Extract meta description
function extractDescription(html: string): string {
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaDesc) return metaDesc[1].trim().slice(0, 300);
  
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDesc) return ogDesc[1].trim().slice(0, 300);
  
  return '';
}

// Enhanced DuckDuckGo search with multiple sources
async function enhancedSearch(query: string): Promise<{ title: string; summary: string; links: string[]; sources: string[] }> {
  const sources: string[] = [];
  
  try {
    // Try DuckDuckGo first
    const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
    const res = await fetch(`https://api.duckduckgo.com/?${params}`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      sources.push('DuckDuckGo');
      const data = (await res.json()) as {
        Heading?: string;
        AbstractText?: string;
        Abstract?: string;
        RelatedTopics?: { Text?: string; FirstURL?: string }[];
      };
      const summary = data.AbstractText || data.Abstract || `Search results for: ${query}`;
      const links = (data.RelatedTopics ?? [])
        .filter((t) => t.FirstURL)
        .map((t) => t.FirstURL as string)
        .slice(0, 8);
      return { title: data.Heading || query, summary, links, sources };
    }
  } catch (err) {
    console.warn('DuckDuckGo search failed:', err);
  }

  // Fallback to Wikipedia API for factual queries
  try {
    const wikiParams = new URLSearchParams({ 
      action: 'opensearch', 
      search: query, 
      limit: '5', 
      format: 'json' 
    });
    const wikiRes = await fetch(`https://en.wikipedia.org/w/api.php?${wikiParams}`, { 
      signal: AbortSignal.timeout(8000) 
    });
    if (wikiRes.ok) {
      sources.push('Wikipedia');
      const wikiData = await wikiRes.json();
      if (Array.isArray(wikiData) && wikiData.length >= 4) {
        const links = wikiData[3] as string[];
        const summary = wikiData[2] as string[];
        return { 
          title: wikiData[1] as string || query, 
          summary: summary[0] || `Wikipedia results for: ${query}`,
          links: links.slice(0, 6),
          sources 
        };
      }
    }
  } catch (err) {
    console.warn('Wikipedia search failed:', err);
  }

  return { 
    title: query, 
    summary: `Search completed but no detailed results available for: ${query}. Try with a more specific query or use a direct URL.`, 
    links: [],
    sources 
  };
}

// Extract key entities and topics from text
function extractEntities(text: string): { entities: string[]; topics: string[] } {
  const words = text.split(/\s+/).filter(w => w.length > 3);
  const wordFreq = new Map<string, number>();
  
  words.forEach(word => {
    const lower = word.toLowerCase();
    const clean = lower.replace(/[^a-z]/g, '');
    if (clean.length > 3) {
      wordFreq.set(clean, (wordFreq.get(clean) || 0) + 1);
    }
  });
  
  // Get top frequency words as potential entities
  const entities = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
  
  // Simple topic extraction based on common business/tech terms
  const topicKeywords = /\b(ai|machine learning|blockchain|cloud|saas|logistics|supply chain|automation|analytics|data|security|compliance|integration|api|workflow|orchestration)\b/gi;
  const topics: string[] = [];
  let match;
  while ((match = topicKeywords.exec(text)) !== null) {
    if (!topics.includes(match[0].toLowerCase())) {
      topics.push(match[0].toLowerCase());
    }
  }
  
  return { entities, topics };
}

export async function POST(req: Request) {
  let body: { url?: string; browsedBy?: string; objective?: string; deep?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const raw = (body.url ?? '').trim();
  const deep = body.deep === true;
  
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'url is required.' }, { status: 400 });
  }

  // Determine if this is a URL or a search query
  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^[\w-]+\.[a-z]{2,}/i.test(raw);
  const normalizedUrl = looksLikeUrl ? (raw.startsWith('http') ? raw : `https://${raw}`) : raw;

  // Search query path
  if (!looksLikeUrl) {
    try {
      const result = await enhancedSearch(normalizedUrl);
      return NextResponse.json({ ok: true, mode: 'search', ...result });
    } catch (err) {
      console.error('Search error', err);
      return NextResponse.json({
        ok: true,
        mode: 'search',
        title: normalizedUrl,
        summary: `Search for "${normalizedUrl}" encountered an error. Please try again or use a direct URL.`,
        links: [],
        sources: [],
      });
    }
  }

  // URL fetch path — SSRF protection
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid URL.' }, { status: 400 });
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return NextResponse.json({ ok: false, error: 'Only http:// and https:// URLs are allowed.' }, { status: 400 });
  }

  try {
    // Resolves DNS and re-checks every redirect hop, so private hosts are unreachable by any route.
    const res = await fetchPublic(parsedUrl.href, {
      headers: { 
        'User-Agent': 'Borga-Research-Agent/1.0 (Agentic command center; research only)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    }, { allowHttp: true });

    if (!res.ok) {
      return NextResponse.json({
        ok: true,
        mode: 'url',
        title: parsedUrl.hostname,
        summary: `${parsedUrl.href} returned HTTP ${res.status}. The page may require authentication or may be unavailable.`,
        links: [],
        error: `HTTP ${res.status}`,
      });
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json({
        ok: true,
        mode: 'url',
        title: parsedUrl.hostname,
        summary: `${parsedUrl.href} returned non-HTML content (${contentType}). Direct content extraction not supported for this file type.`,
        links: [],
        contentType,
      });
    }

    const html = await readTextCapped(res);
    const text = extractText(html);
    const links = extractLinks(html, parsedUrl.href);
    const title = extractTitle(html, parsedUrl.hostname);
    const description = extractDescription(html);
    
    // Build enhanced response
    const response: any = {
      ok: true,
      mode: 'url',
      title,
      url: parsedUrl.href,
      summary: text.length > 800 ? text.slice(0, 800) + '…' : text || `Page content from ${parsedUrl.hostname}.`,
      links,
      description,
      contentType,
    };

    // Add structured content for deep analysis
    if (deep) {
      const structured = extractStructuredContent(html);
      const entities = extractEntities(text);
      
      response.structured = {
        headings: structured.headings,
        paragraphs: structured.paragraphs,
        lists: structured.lists,
      };
      
      response.analysis = {
        entities: entities.entities,
        topics: entities.topics,
        wordCount: text.split(/\s+/).length,
        readingTime: Math.ceil(text.split(/\s+/).length / 200),
      };
      
      response.content = text.slice(0, 4000);
    } else {
      response.content = text.slice(0, 2000);
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('Browse fetch error', err);
    if (err instanceof Error && /private or internal|credentials|Only https|redirects/.test(err.message)) {
      return NextResponse.json({ ok: false, error: 'Internal/private URLs are not allowed.' }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      mode: 'url',
      title: parsedUrl.hostname,
      summary: `Could not reach ${parsedUrl.href}. The site may be down, blocking server-side requests, or experiencing connectivity issues.`,
      links: [],
      error: 'FETCH_ERROR',
    });
  }
}
