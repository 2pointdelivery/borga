import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { paymentRequired } from '@/lib/borga/billing-server';
import { MAX_PDF_BYTES, StatementPdfError, pdfToText } from '@/lib/borga/statement-pdf';
import { parseStatement, type DateOrder } from '@/lib/borga/statement-parse';

export const runtime = 'nodejs';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/**
 * POST /api/borga/statement (multipart: file, ws, dateOrder?): reads a bank statement PDF and returns the transactions it found, for the
 * user to check. The file is read in memory and thrown away: it is not stored, logged or sent to any other service.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) return bad('unauthorized', 401);
  if (Number(req.headers.get('content-length') ?? 0) > MAX_PDF_BYTES + 100_000) return bad('The file is too large.', 413);
  let form: FormData;
  try { form = await req.formData(); } catch { return bad('Send the PDF as a file upload.'); }
  const ws = form.get('ws');
  if (!isValidWsId(ws)) return bad('Workspace id required.');
  const unpaid = await paymentRequired(userId, ws);
  if (unpaid) return NextResponse.json({ ok: false, error: unpaid.error, billing: unpaid.billing }, { status: 402 });
  const file = form.get('file');
  if (!(file instanceof File)) return bad('Choose a PDF file.');
  const order = form.get('dateOrder');
  const dateOrder: DateOrder | 'auto' = order === 'dmy' || order === 'mdy' ? order : 'auto';
  const assume = form.get('assumeOrder') === 'mdy' ? 'mdy' : 'dmy';

  try {
    const { text, pages } = await pdfToText(new Uint8Array(await file.arrayBuffer()));
    const result = parseStatement(text, { dateOrder, assumeOrder: assume });
    return NextResponse.json({ ok: true, pages, fileName: file.name.slice(0, 120), result: { ...result, lines: result.lines.slice(0, 3000) } });
  } catch (e) {
    if (e instanceof StatementPdfError) return bad(e.message, 422);
    return bad('Could not read the statement.', 500);
  }
}
