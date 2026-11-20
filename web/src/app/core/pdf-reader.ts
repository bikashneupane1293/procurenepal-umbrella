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

export interface PdfText {
  text: string;
  pages: number;
  scanned: boolean;
  /** Pages read (≤ maxPages). */
  pagesRead: number;
  /** Page numbers with (almost) no selectable text — scanned images, drawings or blank pages. */
  emptyPages: number[];
}

/**
 * Returns the PDF's text with one line per visual line. scanned=true when there is almost no text
 * (image PDF). onPage reports progress for long documents (300-page bidding documents are common).
 */
export async function readPdfText(file: File | ArrayBuffer, maxPages = 30, onPage?: (page: number, of: number) => void): Promise<PdfText> {
  ensureWorker();
  const data = file instanceof ArrayBuffer ? new Uint8Array(file) : new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const out: string[] = [];
  const emptyPages: number[] = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items as any[]);
    if (lines.replace(/\s/g, '').length < 20) emptyPages.push(p);
    out.push(lines);
    page.cleanup();
    onPage?.(p, n);
  }
  const pages = doc.numPages;
  await task.destroy();
  const text = cleanupText(out.join('\n'));
  return { text, pages, pagesRead: n, emptyPages, scanned: text.replace(/\s/g, '').length < 40 };
}

/** Common PDF-export artifacts that confuse plain keyword/regex matching if left in. */
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
function cleanupText(s: string): string {
  return s
    .replace(/­/g, '') // soft hyphen (invisible, but splits words like "Reg­istration")
    .replace(/[  -  ]/g, ' ') // NBSP and other "space-like" unicode gaps
    .replace(/[‘’]/g, "'") // curly single quotes → plain, so our own regex/string matches still work
    .replace(/[“”]/g, '"')
    .replace(/[ﬀ-ﬆ]/g, (m) => LIGATURES[m] ?? m);
}

interface Item { str: string; transform: number[]; width?: number; }
interface NormItem { x: number; y: number; s: string; w: number; }

function normItems(items: Item[]): NormItem[] {
  const out: NormItem[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5] / 3) * 3; // tolerate small baseline differences
    const x = it.transform[4];
    const fontSize = Math.hypot(it.transform[0], it.transform[1]) || 10;
    const w = it.width && it.width > 0 ? it.width : fontSize * 0.5 * Math.max(1, it.str.length);
    out.push({ x, y, s: it.str, w });
  }
  return out;
}

/**
 * Join one visual row left to right, inserting a space between two runs only when the gap is
 * wide enough to be a real word break. Government Word→PDF exports very often split one word
 * across several text "runs" (a bold span mid-sentence, a different sub-font for one character,
 * etc.) with no gap between them — blindly inserting a space at every run boundary turns
 * "Rs. 50,00,000" or "Bid Security" into "R s. 50,00,000" / "Bi d Security".
 */
function joinRow(row: NormItem[]): string {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  let line = '';
  let prevEndX: number | null = null;
  let prevFontGuess = 10;
  for (const c of sorted) {
    if (prevEndX != null && line.length) {
      const gap = c.x - prevEndX;
      const alreadySpaced = /\s$/.test(line) || /^\s/.test(c.s);
      if (!alreadySpaced && gap > Math.max(1, prevFontGuess * 0.22)) line += ' ';
    }
    line += c.s;
    prevEndX = c.x + c.w;
    prevFontGuess = c.w / Math.max(1, c.s.length);
  }
  return line;
}

function linesFromItems(items: NormItem[]): { y: number; text: string }[] {
  const rows = new Map<number, NormItem[]>();
  for (const it of items) rows.set(it.y, [...(rows.get(it.y) ?? []), it]);
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, r]) => ({ y, text: joinRow(r) }));
}

/**
 * Group text items into lines, left to right, top to bottom.
 *
 * Nepali Standard Bidding Documents (and most government templates) render each ITB/GCC/SCC
 * clause as a two-column table: a narrow "1. Scope of Bid" label cell beside a wide paragraph
 * cell. The label cell is usually vertically centered or uses different line spacing than the
 * paragraph, so its wrapped lines do NOT share a baseline with the paragraph's lines. Grouping
 * every item globally by y (as a single reading order) then interleaves the label's wrapped
 * lines with unrelated paragraph lines — e.g. "21. Sealing" / "21.1 Unless otherwise..." /
 * "and Marking" / "mail/by hand/by courier..." / "of Bids" — which silently breaks any
 * regex/keyword search for "Sealing and Marking of Bids" or similar clause headings.
 *
 * When a page shows a persistent narrow-left / wide-right column split across many rows, this
 * reconstructs the label column separately (joining its wrapped lines into one heading) and
 * splices each heading back into the paragraph column's reading order at the point it visually
 * starts, instead of letting the two columns' line-heights interleave at random.
 */
export function itemsToLines(items: Item[]): string {
  const norm = normItems(items);
  if (!norm.length) return '';

  const xs = norm.map((i) => i.x).sort((a, b) => a - b);
  const pageLeft = xs[0];
  const pageRight = Math.max(...norm.map((i) => i.x + i.w));
  const pageWidth = pageRight - pageLeft || 1;

  // Largest persistent horizontal gap in item start-x: the candidate column boundary.
  const uniqXs = [...new Set(xs.map((x) => Math.round(x)))].sort((a, b) => a - b);
  let bestGap = 0, bestGapStart = 0;
  for (let i = 1; i < uniqXs.length; i++) {
    const gap = uniqXs[i] - uniqXs[i - 1];
    if (gap > bestGap) { bestGap = gap; bestGapStart = uniqXs[i - 1]; }
  }
  const boundary = bestGapStart + bestGap / 2;
  const leftWidth = boundary - pageLeft;

  const leftItems = norm.filter((i) => i.x < boundary);
  const rightItems = norm.filter((i) => i.x >= boundary);
  const leftRowsCount = new Set(leftItems.map((i) => i.y)).size;
  const rightRowsCount = new Set(rightItems.map((i) => i.y)).size;
  // Only treat this as a label|content table when the gap is wide, the left column is narrow
  // (a label cell, not a half-width column of running prose), and both sides recur across many
  // rows (a real table, not one stray indented line on an ordinary paragraph page).
  const isLabelTable =
    bestGap > 14 &&
    leftWidth < pageWidth * 0.32 &&
    leftItems.length > 0 &&
    rightItems.length > 0 &&
    leftRowsCount >= 3 &&
    rightRowsCount >= 3;

  if (!isLabelTable) {
    return linesFromItems(norm).map((r) => r.text).join('\n');
  }

  // Body column: a clean top-to-bottom paragraph flow, now that it no longer competes with
  // interleaved label fragments.
  const bodyLines = linesFromItems(rightItems);

  // Label column: merge wrapped lines into blocks. A block ends when the gap to the next label
  // line is distinctly larger than the typical wrap gap, or a new numbered clause starts.
  const labelLines = linesFromItems(leftItems);
  const gaps: number[] = [];
  for (let i = 1; i < labelLines.length; i++) gaps.push(labelLines[i - 1].y - labelLines[i].y);
  const typicalGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 12;

  const blocks: { y: number; text: string }[] = [];
  let cur: { y: number; text: string } | null = null;
  for (const l of labelLines) {
    const startsNewClause = /^[A-Z]?\.?\s*\d{1,2}\s*[.)]/.test(l.text.trim());
    if (cur && !startsNewClause && (cur.y - l.y) <= typicalGap * 1.6) {
      cur.text += ' ' + l.text;
      cur.y = l.y;
    } else {
      cur = { y: l.y, text: l.text };
      blocks.push(cur);
    }
  }

  // Merge: both sequences are sorted desc by y — splice each label block in right before the
  // body line it visually sits above.
  const out: string[] = [];
  let bi = 0;
  for (const row of bodyLines) {
    while (bi < blocks.length && blocks[bi].y >= row.y) {
      out.push(blocks[bi].text.trim());
      bi++;
    }
    out.push(row.text);
  }
  while (bi < blocks.length) { out.push(blocks[bi].text.trim()); bi++; }

  return out.join('\n');
}
