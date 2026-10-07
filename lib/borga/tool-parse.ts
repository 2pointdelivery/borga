/** Reading tool calls out of a model's answer. Pure (no I/O) so it can be unit tested. */

/** Every top-level JSON object in a string, tolerating code fences and several calls in one block. Anything unparseable is skipped. */
function jsonObjectsIn(raw: string): unknown[] {
  const text = raw.replace(/```(?:json)?/gi, '');
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* malformed: skip */ }
        start = -1;
      }
    }
  }
  return out;
}

export function parseToolCalls(text: string): Array<{ tool: string; params: Record<string, unknown> }> {
  const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
  // A block may be closed, or cut off at the end of a long answer.
  const regex = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    for (const obj of jsonObjectsIn(m[1])) {
      // models spell the same call a few ways: {tool, params} or {name, arguments}
      const o = obj as { tool?: unknown; name?: unknown; tool_name?: unknown; params?: unknown; parameters?: unknown; arguments?: unknown };
      const tool = o.tool ?? o.name ?? o.tool_name;
      const rawParams = o.params ?? o.parameters ?? o.arguments;
      if (typeof tool === 'string' && tool) {
        calls.push({ tool, params: rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {} });
      }
    }
  }
  return calls;
}
