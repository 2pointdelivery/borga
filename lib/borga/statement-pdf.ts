// PDF to text for bank statements. Runs in memory on our own server: the file is never written to disk or sent anywhere.

import { extractText, getDocumentProxy } from 'unpdf';

export const MAX_PDF_BYTES = 8_000_000;
export const MAX_PDF_PAGES = 80;

export class StatementPdfError extends Error {}

export async function pdfToText(data: Uint8Array): Promise<{ text: string; pages: number }> {
  if (data.length === 0) throw new StatementPdfError('The file is empty.');
  if (data.length > MAX_PDF_BYTES) throw new StatementPdfError(`The file is larger than ${Math.round(MAX_PDF_BYTES / 1_000_000)} MB.`);
  // a PDF starts with %PDF- (some have a few bytes of junk before it)
  const head = new TextDecoder('latin1').decode(data.subarray(0, 1024));
  if (!head.includes('%PDF-')) throw new StatementPdfError('That file is not a PDF.');
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    if (pdf.numPages > MAX_PDF_PAGES) throw new StatementPdfError(`The statement has ${pdf.numPages} pages: the limit is ${MAX_PDF_PAGES}. Split it by month.`);
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (Array.isArray(text) ? text.join('\n') : text).trim();
    if (t.replace(/\s+/g, '').length < 20) throw new StatementPdfError('This PDF has no text in it: it is probably a scan or a photo. Download the statement as a PDF from online banking, or as CSV.');
    return { text: t, pages: pdf.numPages };
  } catch (e) {
    if (e instanceof StatementPdfError) throw e;
    const name = (e as { name?: string }).name ?? '';
    if (/Password/i.test(name)) throw new StatementPdfError('This PDF is password protected. Remove the password and try again.');
    throw new StatementPdfError('This file could not be read as a PDF. It may be damaged.');
  }
}
