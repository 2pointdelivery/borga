import { NextResponse, type NextRequest } from 'next/server';
import { unsubscribeByToken } from '@/lib/borga/email-notify';
import { esc } from '@/lib/borga/email-core';

export const runtime = 'nodejs';

/**
 * Public unsubscribe (cookie-exempt in proxy.ts; authenticated by the signed token in the link).
 * GET = the person clicked the footer link. POST = mail clients' RFC 8058 one-click unsubscribe.
 */

const page = (title: string, message: string, status = 200) =>
  new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#111827;"><h1 style="font-size:20px;">${esc(title)}</h1><p style="line-height:1.55;color:#374151;">${esc(message)}</p></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const r = await unsubscribeByToken(token);
  return r.ok
    ? page('You are unsubscribed', `${r.email} will no longer get email updates for ${r.workspace}. Someone with access can add the address again in Settings → Email updates.`)
    : page('This link is not valid', 'The unsubscribe link is invalid or has been altered.', 400);
}

export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const r = await unsubscribeByToken(token);
  return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 400 });
}
