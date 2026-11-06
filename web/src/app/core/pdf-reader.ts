// Reads the text of a PDF in the browser (nothing is uploaded to a server).
// pdf.js is loaded only when a PDF is chosen. © Cuidado Technology Pvt. Ltd.
import * as pdfjs from 'pdfjs-dist';

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL('./pdf.worker', import.meta.url),
    { type: 'module' },
  );
  workerReady = true;
}

export interface PdfText { text: string; pages: number; scanned: boolean; }

/** Returns the PDF's text with one line per visual line. scanned=true when there is almost no text (image PDF). */
export async function readPdfText(file: File | ArrayBuffer, maxPages = 30): Promise<PdfText> {
  ensureWorker();
  const data = file instanceof ArrayBuffer ? new Uint8Array(file) : new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const out: string[] = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out.push(itemsToLines(content.items as any[]));
  }
  const pages = doc.numPages;
  await task.destroy();
  const text = out.join('\n');
  return { text, pages, scanned: text.replace(/\s/g, '').length < 40 };
}

/** Group text items by their y position into lines, left to right. */
export function itemsToLines(items: { str: string; transform: number[] }[]): string {
  const rows = new Map<number, { x: number; s: string }[]>();
  for (const it of items) {
    if (!it.str?.trim()) continue;
    const y = Math.round(it.transform[5] / 3) * 3; // tolerate small baseline differences
    const x = it.transform[4];
    rows.set(y, [...(rows.get(y) ?? []), { x, s: it.str }]);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) => r.sort((a, b) => a.x - b.x).map((c) => c.s).join(' '))
    .join('\n');
}
