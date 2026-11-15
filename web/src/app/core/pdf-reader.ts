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
  const text = cleanupText(out.join('\n'));
  return { text, pages, scanned: text.replace(/\s/g, '').length < 40 };
}

/** Common PDF-export artifacts that confuse plain keyword/regex matching if left in. */
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
function cleanupText(s: string): string {
  return s
    .replace(/­/g, '') // soft hyphen (invisible, but splits words like "Reg­istration")
    .replace(/[  -  ]/g, ' ') // NBSP and other "space-like" unicode gaps
    .replace(/[‘’]/g, "'") // curly single quotes → plain, so our own regex/string matches still work
    .replace(/[“”]/g, '"')
    .replace(/[ﬀ-ﬆ]/g, (m) => LIGATURES[m] ?? m);
}

/**
 * Group text items by their y position into lines, left to right, and only insert a space
 * between two runs when the visual gap between them is wide enough to be a real word break.
 * Government Word→PDF exports very often split one word across several text "runs" (a bold
 * span mid-sentence, a different sub-font for one character, etc.) with no gap between them —
 * blindly inserting a space at every run boundary turns "Rs. 50,00,000" or "Bid Security" into
 * "R s. 50,00,000" / "Bi d Security", which then fails every keyword/amount pattern silently.
 */
export function itemsToLines(items: { str: string; transform: number[]; width?: number }[]): string {
  const rows = new Map<number, { x: number; s: string; w: number }[]>();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5] / 3) * 3; // tolerate small baseline differences
    const x = it.transform[4];
    const fontSize = Math.hypot(it.transform[0], it.transform[1]) || 10;
    const w = it.width && it.width > 0 ? it.width : fontSize * 0.5 * Math.max(1, it.str.length);
    rows.set(y, [...(rows.get(y) ?? []), { x, s: it.str, w }]);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, r]) => {
      const sorted = r.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEndX: number | null = null;
      let prevFontGuess = 10;
      for (const c of sorted) {
        if (prevEndX != null && line.length) {
          const gap = c.x - prevEndX;
          const alreadySpaced = /\s$/.test(line) || /^\s/.test(c.s);
          // A gap wider than roughly a quarter of the current run's own character size reads as
          // a genuine word break; anything tighter (including slightly negative, from kerning)
          // is the same word continuing in a new font/style run.
          if (!alreadySpaced && gap > Math.max(1, prevFontGuess * 0.22)) line += ' ';
        }
        line += c.s;
        prevEndX = c.x + c.w;
        prevFontGuess = c.w / Math.max(1, c.s.length);
      }
      return line;
    })
    .join('\n');
}
