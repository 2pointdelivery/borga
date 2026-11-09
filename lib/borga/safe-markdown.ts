/**
 * Minimal safe markdown renderer for user-authored previews. Escapes FIRST
 * (including quotes, so link URLs cannot break out of attributes), then adds
 * inline marks. Pure (no I/O) so the escaping rules are unit tested —
 * attribute injection through `[text](url)` is the classic bypass here.
 */
export function renderPostPreview(raw: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" style="color:#0284c7;text-decoration:underline;">$1</a>')
      .replace(/(^|\s)(#[A-Za-z0-9_]+)/g, '$1<span style="color:#0284c7;">$2</span>');
  const lines = raw.split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
  for (const line of lines) {
    const t = line.trim();
    if (/^([-*•]\s+)/.test(t)) {
      if (list !== 'ul') { closeList(); out.push('<ul style="padding-left:1.1rem;list-style:disc;">'); list = 'ul'; }
      out.push(`<li>${inline(t.replace(/^([-*•]\s+)/, ''))}</li>`);
    } else if (/^\d+\.\s+/.test(t)) {
      if (list !== 'ol') { closeList(); out.push('<ol style="padding-left:1.1rem;list-style:decimal;">'); list = 'ol'; }
      out.push(`<li>${inline(t.replace(/^\d+\.\s+/, ''))}</li>`);
    } else if (t.startsWith('> ')) {
      closeList();
      out.push(`<blockquote style="border-left:3px solid #e4e4e7;padding-left:.6rem;color:#71717a;">${inline(t.slice(2))}</blockquote>`);
    } else if (!t) {
      closeList();
      out.push('<div style="height:.5rem;"></div>');
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}
