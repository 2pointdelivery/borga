/** Reads at most `maxBytes` of a response body as text, so a huge page cannot exhaust memory. */
export async function readTextCapped(res: Response, maxBytes = 1_500_000): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(Math.min(total, maxBytes));
  let o = 0;
  for (const c of chunks) { const take = Math.min(c.byteLength, all.length - o); all.set(c.subarray(0, take), o); o += take; if (o >= all.length) break; }
  return new TextDecoder().decode(all);
}
