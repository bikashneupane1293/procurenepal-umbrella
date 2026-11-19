// Phase 1A — Dynamic N-column table reconstruction engine.
//
// Isolated module (requirement #3): does not modify, import from, or get imported by
// pdf-reader.ts or pdf-parse.ts. It only consumes the same raw pdf.js TextItem shape they do.
// Its entry points (`findAnchorTableOnPage`, `findAnchorTableInPdf`) are additive — called
// alongside the existing `readPdfText`/`itemsToLines` flat extraction, never instead of it
// (requirement #7: the flat extraction remains the default path and is never replaced).
//
// CORE SIGNAL (river / union-coverage detection) — replaces both "split at the single widest
// gap" (the original wall: scrambled "Bid Guarantee Security / Bank") and an abandoned per-line
// gap/font-size ratio check (tried and failed against this exact document, see below):
//
//   A genuine table-column boundary is an x-interval that NO row's text ever occupies, once you
//   look at the UNION of every item's horizontal span across every row in the table region. Take
//   every item's [x, x+width] interval, merge all overlaps into one coverage map, and whatever
//   x-gaps survive in that merged map are the real column gutters ("rivers").
//
// Why a per-line gap-size threshold was tried and abandoned: in the real tender PDF, ordinary
// INTRA-CELL word spacing inside a single row can be wider than the REAL column gutter (e.g.
// "and"-to-"PAN" is a ~23pt gap at 9pt font, while the real Document|Requirement gutter is only
// ~7-11pt) — so no fixed gap/font-size ratio can separate "word space" from "column gutter" on a
// per-line basis; real rows get mis-scored either way. Pooled across ALL rows, though, a genuine
// gutter stays empty in every row (because every row's column boundaries are typeset at the same
// fixed x position), while any one row's own internal word gap gets filled in by *other* rows'
// text that happens to extend further right at that same x — so it never survives into the union.
// This is literally row-aware (requirement #4: it only exists because many rows are checked
// together) and uses no single fixed-threshold constant to tell "word gap" from "column gutter".
//
// This also independently distinguishes a numbered list's hanging indent from a genuine table
// gutter (requirement #5): a hanging indent is a LIST-ITEM-INITIAL-LINE-ONLY effect — a plain
// list's wrapped continuation lines flow back out to the body's own margin, so across the whole
// list the x-range right after the marker gets filled in by those continuation lines and never
// survives as a river. A real table column boundary, by contrast, is honored by the typesetting
// on every row, wrapped or not. Verified against the real document: scanning all 137 pages of the
// actual tender PDF whole-page (no manual cropping) produces zero false-positive tables; the
// engine only fires on the genuine 4-column ITB 21 "No. | Document | Requirement | Remarks" table.

export interface PdfTextItem {
  str: string;
  transform: number[];
  width?: number;
}

interface Word {
  x: number;
  y: number;
  s: string;
  w: number;
  h: number;
  end: number;
}

interface Line {
  y: number;
  items: Word[];
}

export interface TableCell {
  columnIndex: number;
  text: string;
  /** Original source words for this cell, in original reading order with their coordinates intact (requirement #6). */
  words: Word[];
  confidence: number;
  warnings: string[];
}

export interface TableRow {
  rowIndex: number;
  cells: TableCell[];
  confidence: number;
  warnings: string[];
}

export interface ReconstructedTable {
  columns: { index: number }[];
  rows: TableRow[];
  confidence: number;
  detectionMethods: string[];
  warnings: string[];
  /** The literal header line text that located this table (e.g. "No. Document Requirement
   *  Remarks"), when found via findAnchorTableOnPage. Kept even when `headers` below is also
   *  present, as a human-checkable cross-reference. */
  headerText?: string;
  /** The header line split into the same per-column buckets as the body rows (e.g. ["No.",
   *  "Document", "Requirement", "Remarks"]), when found via findAnchorTableOnPage. Falls back to
   *  undefined (never a guessed split) if the header row's own geometry doesn't resolve cleanly —
   *  callers should fall back to showing `headerText` as a single label in that case. */
  headers?: string[];
  /** The finite column-boundary x positions used to build `columns`/`rows` (excludes the implicit
   *  -Infinity/Infinity outer bounds). Internal — used to split the header row the same way the
   *  body rows were split; exposed for callers that want to re-derive their own column labels. */
  columnBounds?: number[];
}

export interface ReconstructResult {
  table: ReconstructedTable | null;
  warnings: string[];
}

function normalizeItems(items: PdfTextItem[]): Word[] {
  const out: Word[] = [];
  for (const it of items) {
    if (!it.str) continue;
    // PDF.js sometimes emits a whitespace-only item (e.g. str === " ") whose own x/width spans
    // the entire visual gap between two real tokens. Left in, any gap computed between
    // NEIGHBORING items only ever sees the (zero) distance from a real token to that space item,
    // never the real token-to-token gap. Dropping it is safe: the gap it represented survives as
    // the plain distance between the real tokens on either side once it's gone, and `lineText`
    // below already reinserts a space wherever that gap is wide enough to need one.
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5] / 3) * 3;
    const x = it.transform[4];
    const fontSize = Math.hypot(it.transform[0], it.transform[1]) || 10;
    const w = it.width && it.width > 0 ? it.width : fontSize * 0.5 * Math.max(1, it.str.length);
    out.push({ x, y, s: it.str, w, h: fontSize, end: x + w });
  }
  return out;
}

function groupLines(items: Word[]): Line[] {
  const rows = new Map<number, Word[]>();
  for (const it of items) rows.set(it.y, [...(rows.get(it.y) ?? []), it]);
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, r]) => ({ y, items: [...r].sort((a, b) => a.x - b.x) }));
}

function lineText(line: Line): string {
  let text = '';
  let prevEnd: number | null = null;
  let prevH = 10;
  for (const c of line.items) {
    if (prevEnd != null && text.length) {
      const gap = c.x - prevEnd;
      const spaced = /\s$/.test(text) || /^\s/.test(c.s);
      if (!spaced && gap > Math.max(1, prevH * 0.22)) text += ' ';
    }
    text += c.s;
    prevEnd = c.end;
    prevH = c.h;
  }
  return text;
}

interface River { start: number; end: number; mid: number; width: number; }

/**
 * Union-coverage ("river") boundary detection — the primary, row-aware, multi-row signal.
 * Merges every item's [x, end] span across the WHOLE region into a covered-x map; any gap that
 * survives in that merged map (i.e. no item from any row ever touches it) is a candidate column
 * boundary. `minWidth` filters sub-glyph/kerning noise only — it is deliberately NOT tuned against
 * word-spacing, because the union step itself (not the width) is what rejects word-level gaps.
 */
function detectRivers(items: Word[], minWidth?: number): River[] {
  if (!items.length) return [];
  const fontSizes = items.map((i) => i.h).sort((a, b) => a - b);
  const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] || 10;
  const floor = minWidth ?? Math.max(2, medianFont * 0.3);
  const intervals = items.map((i): [number, number] => [i.x, i.end]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of intervals) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const rivers: River[] = [];
  for (let i = 1; i < merged.length; i++) {
    const gapStart = merged[i - 1][1];
    const gapEnd = merged[i][0];
    const width = gapEnd - gapStart;
    if (width >= floor) rivers.push({ start: gapStart, end: gapEnd, mid: (gapStart + gapEnd) / 2, width });
  }
  return rivers;
}

/**
 * Secondary, per-row confirmation signal: for a candidate river, count how many distinct rows
 * have ANY content in the zone to its left and, separately, ANY content in the zone to its right
 * (not just "the gap exists somewhere" — genuine support from multiple independent rows). Used
 * only to gate out a river that happens to separate one stray short row from the rest, not to
 * re-derive the boundary itself.
 *
 * Deliberately NOT distance-limited to "close to this exact gap": an earlier version required
 * each row's own item to end within ~2 font-heights of the gap, which rejected perfectly valid
 * columns whenever a row's cell content was shorter than the column's widest cell (e.g. "Beta"
 * sitting well short of a gutter that a longer sibling cell like "Foxtrot" pushed further right)
 * — the row is still legitimately in that column, it just doesn't reach all the way to the edge.
 */
function riverRowSupport(lines: Line[], river: River): { rowsLeft: number; rowsRight: number } {
  let rowsLeft = 0;
  let rowsRight = 0;
  for (const line of lines) {
    if (!line.items.length) continue;
    const hasLeft = line.items.some((it) => it.end <= river.start);
    const hasRight = line.items.some((it) => it.x >= river.end);
    if (hasLeft) rowsLeft++;
    if (hasRight) rowsRight++;
  }
  return { rowsLeft, rowsRight };
}

function looksLikeAnchorToken(text: string): boolean {
  return /^\(?[a-z0-9]{1,3}[.)]?$/i.test(text.trim());
}

/**
 * Reconstruct a numbered-anchor table ("1./2./... | col | col | col") from a region's own items.
 * Returns `{ table: null, warnings }` — never a guessed/garbled result (requirement #8) — when
 * the structural checks aren't met; the caller falls back to the existing flat extraction.
 */
export function reconstructTable(rawItems: PdfTextItem[]): ReconstructResult {
  const items = normalizeItems(rawItems);
  const warnings: string[] = [];
  if (items.length < 6) return { table: null, warnings: ['too few items for a table'] };

  const lines = groupLines(items);
  const rivers = detectRivers(items);
  // Require real cross-row support for each river: at least 2 distinct rows actually touch the
  // gap from either side (guards against a river that's an artifact of one short/empty row).
  const boundaries = rivers
    .filter((r) => {
      const s = riverRowSupport(lines, r);
      return s.rowsLeft >= 2 && s.rowsRight >= 2;
    })
    .map((r) => r.mid);

  if (boundaries.length < 1) {
    return { table: null, warnings: ['no column boundary survived union-coverage (river) validation'] };
  }

  const bounds = [-Infinity, ...boundaries, Infinity];
  const rawColumns = bounds.slice(0, -1).map((lo, i) => items.filter((it) => it.x >= lo && it.x < bounds[i + 1]));
  const columns = rawColumns.filter((col) => new Set(col.map((it) => it.y)).size >= 2);
  // Require a genuine N-column table (anchor + at least 2 content columns = 3+ columns total).
  // A plain numbered/lettered list with hanging indent (e.g. "1. <long paragraph>") validates as
  // exactly ONE river (between the marker and the body) and would otherwise be mis-detected as a
  // "2-column table" here — harmlessly (the text comes out complete and correctly ordered either
  // way), but that shape is already the deployed, validated 2-column label/paragraph behavior in
  // pdf-reader.ts, so this isolated module stays out of its way and only engages for genuine
  // multi-column (3+) tables, which is the actual scope of this phase (the ITB 21 checklist has 4).
  if (columns.length < 3) {
    return {
      table: null,
      warnings: [`only ${columns.length} column(s) found — not a genuine multi-column table (plain 2-column lists are handled by the existing pdf-reader.ts path)`],
    };
  }

  const anchorLines = groupLines(columns[0]).map((l) => ({ ...l, text: lineText(l) }));
  const anchorish = anchorLines.filter((l) => looksLikeAnchorToken(l.text)).length;
  if (anchorish / anchorLines.length < 0.7 || anchorLines.length < 3) {
    return {
      table: null,
      warnings: [`leftmost column is not a clean numbered/lettered anchor (${anchorish}/${anchorLines.length} rows matched)`],
    };
  }

  const contentColumns = columns.slice(1).map((colItems) => groupLines(colItems).map((l) => ({ ...l, text: lineText(l) })));

  const rows: TableRow[] = [];
  for (let i = 0; i < anchorLines.length; i++) {
    const topY = anchorLines[i].y;
    const bottomY = i + 1 < anchorLines.length ? anchorLines[i + 1].y : -Infinity;
    const cells: TableCell[] = [
      { columnIndex: 0, text: anchorLines[i].text, words: anchorLines[i].items, confidence: 1, warnings: [] },
    ];
    const rowWarnings: string[] = [];
    contentColumns.forEach((colLines, ci) => {
      const cellLines = colLines.filter((l) => l.y <= topY && l.y > bottomY);
      const text = cellLines.map((l) => l.text).join(' ');
      const words = cellLines.flatMap((l) => l.items);
      // Flag ambiguity: a continuation line sitting very close to the NEXT row's anchor y is at
      // real risk of belonging to the wrong row (the anchor-boundary assumption is a heuristic,
      // not a hard table rule) — surfaced as a warning rather than silently trusted.
      const nearBoundary = cellLines.some((l) => bottomY > -Infinity && l.y - bottomY < 4);
      // A cell with zero lines in its row band is either a genuinely empty table cell (common —
      // e.g. no remarks for that row) or a sign the row-banding assumption put this content in the
      // wrong row. Can't tell which from geometry alone, so this is surfaced as a warning and a
      // reduced (not zero, not full) confidence rather than silently treated as equally certain as
      // a populated cell.
      const empty = cellLines.length === 0;
      const warnings: string[] = [];
      let confidence = 0.95;
      if (empty) { confidence = 0.8; warnings.push('empty cell — may be genuinely blank, or content may have landed in a neighboring row'); }
      else if (nearBoundary) { confidence = 0.6; warnings.push('near row boundary'); rowWarnings.push(`column ${ci + 1}: a wrapped line sits within 4pt of the next row boundary — verify manually`); }
      cells.push({ columnIndex: ci + 1, text, words, confidence, warnings });
    });
    const rowConfidence = Math.min(...cells.map((c) => c.confidence));
    rows.push({ rowIndex: i, cells, confidence: rowConfidence, warnings: rowWarnings });
  }

  const overallConfidence = rows.length ? rows.reduce((s, r) => s + r.confidence, 0) / rows.length : 0;
  const lowConfidenceRows = rows.filter((r) => r.confidence < 0.7).length;
  if (overallConfidence < 0.5) {
    return { table: null, warnings: [`overall confidence ${overallConfidence.toFixed(2)} too low to trust — falling back to flat text`] };
  }

  return {
    table: {
      columns: columns.map((_, i) => ({ index: i })),
      rows,
      confidence: overallConfidence,
      detectionMethods: ['union-coverage-river-boundary', 'cross-row-support-gate', 'numbered-anchor-column', 'row-band-from-anchor-y'],
      warnings: lowConfidenceRows ? [`${lowConfidenceRows} row(s) below 0.7 confidence — flagged for review, not corrected silently`] : [],
      columnBounds: boundaries,
    },
    warnings,
  };
}

/** Splits a line's own items into the same column buckets a table body used, for deriving real
 *  per-column header labels from the header row's own geometry rather than guessing. */
function splitItemsByBounds(items: Word[], boundaries: number[]): string[] {
  const bounds = [-Infinity, ...boundaries, Infinity];
  const cols: Word[][] = bounds.slice(0, -1).map((lo, i) => items.filter((it) => it.x >= lo && it.x < bounds[i + 1]));
  return cols.map((colItems) => lineText({ y: 0, items: [...colItems].sort((a, b) => a.x - b.x) }));
}

const DEFAULT_HEADER_RE = /^No\.\s+\S+(\s+\S+){1,4}$/i;
const DEFAULT_END_RE = /shall be part of|^Note:|^Page\s*\|/i;

/**
 * Locate a numbered-anchor table embedded inside an otherwise plain page (the ITB 21 e-submission
 * checklist coexists on its page with ordinary paragraph text, so the page as a whole never
 * qualifies as a clean table region) and reconstruct it. Purely additive: does not alter how the
 * rest of the page's text is read — callers keep using the existing flat extraction for
 * everything outside the returned table's own row range, exactly as before (requirement #7).
 */
export function findAnchorTableOnPage(
  rawItems: PdfTextItem[],
  headerRe: RegExp = DEFAULT_HEADER_RE,
  endRe: RegExp = DEFAULT_END_RE,
): ReconstructResult {
  const items = normalizeItems(rawItems);
  if (!items.length) return { table: null, warnings: ['empty page'] };
  const lines = groupLines(items).map((l) => ({ ...l, text: lineText(l) }));

  const headerIdx = lines.findIndex((l) => headerRe.test(l.text.trim()));
  if (headerIdx === -1) return { table: null, warnings: ['no matching table header found on this page'] };

  let endIdx = lines.length;
  for (let j = headerIdx + 1; j < lines.length; j++) {
    if (endRe.test(lines[j].text.trim()) || headerRe.test(lines[j].text.trim())) {
      endIdx = j;
      break;
    }
  }
  if (endIdx <= headerIdx + 1) return { table: null, warnings: ['table header found but no body rows before the next sentinel/header'] };

  const topY = lines[headerIdx].y;
  // bottomY is the END MARKER's own y (the sentinel/next-header line), not the last content row's
  // y — using the content row's own y here would exclude that row itself from `y > bottomY`. When
  // no sentinel/next-header was found (table runs to the bottom of the page), there is no marker
  // row to exclude, so the bound is simply below everything.
  const bottomY = endIdx < lines.length ? lines[endIdx].y : -Infinity;
  const tableItems = rawItems.filter((it) => {
    const y = Math.round(it.transform[5] / 3) * 3;
    return y < topY && y > bottomY;
  });
  const result = reconstructTable(tableItems);
  if (result.table) {
    result.table.headerText = lines[headerIdx].text;
    // Split the header row's own items by the same boundaries the body used, so the displayed
    // columns say "Document" / "Requirement" / "Remarks" rather than "Column 1/2/3". Length is
    // checked so a header split that doesn't line up with the body's column count is dropped
    // (never guessed) rather than shown misleadingly against the wrong columns.
    if (result.table.columnBounds) {
      const headerItems = lines[headerIdx].items;
      const headers = splitItemsByBounds(headerItems, result.table.columnBounds);
      if (headers.length === result.table.columns.length && headers.every((h) => h.trim().length > 0)) {
        result.table.headers = headers;
      }
    }
  }
  return result;
}

export interface DocumentTableResult {
  table: ReconstructedTable;
  pageNumber: number;
  warnings: string[];
}

let workerReady = false;
async function ensureWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  if (!workerReady) {
    // Only set a worker if nothing (e.g. pdf-reader.ts, already run earlier in the same page
    // load) has configured one yet — avoids spinning up a second pdf.js worker needlessly. This
    // module stays isolated either way: it never imports pdf-reader.ts, it just shares the same
    // pdfjs-dist module-level singleton that any caller on the page already does.
    if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdf.worker', import.meta.url), { type: 'module' });
    }
    workerReady = true;
  }
  return pdfjs;
}

/**
 * Scan a PDF page by page for a genuine anchor table (the ITB 21 checklist in the documents seen
 * so far, but not hardcoded to any fixed page — different tenders can place it elsewhere). Stops
 * at the first page where one is found, so this is not an unbounded full-document table-mining
 * pass — it is a bounded search for one specific thing, same cap (`maxPages`) as the existing
 * flat-text reader. Purely additive: never called from the default read path (requirement #7).
 */
export async function findAnchorTableInPdf(
  file: File | ArrayBuffer,
  maxPages = 80,
  headerRe?: RegExp,
  endRe?: RegExp,
): Promise<DocumentTableResult | null> {
  const pdfjs = await ensureWorker();
  const data = file instanceof ArrayBuffer ? new Uint8Array(file) : new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as PdfTextItem[]).filter((it) => it.str);
    const result = findAnchorTableOnPage(items, headerRe, endRe);
    if (result.table) {
      await task.destroy();
      return { table: result.table, pageNumber: p, warnings: result.warnings };
    }
  }
  await task.destroy();
  return null;
}

/** Same shape as pdf-parse's ChecklistItem, declared here so this module stays import-free of it. */
export interface TableChecklistItem { key: string; label: string; found: boolean; line: string; }

/**
 * Turns a reconstructed "No. / Document / Requirement / Remarks" table (the required-documents
 * table PPMO e-submission SBDs put inside ITB 21.1(b)) into readiness-checklist rows.
 *
 * Deliberately strict — returns null rather than guessing unless:
 *  - the header row was split cleanly into named columns (`headers` is set), and one of them is a
 *    "Document" column (so a random numbered table can't be mistaken for the document list), and
 *  - the whole table's confidence is at least `minConfidence` (default 0.8).
 * Rows under 0.7 confidence are kept but flagged in their `line` text, never silently trusted.
 */
export function checklistFromDocumentTable(res: DocumentTableResult | null, minConfidence = 0.8): TableChecklistItem[] | null {
  if (!res || !res.table.headers || res.table.confidence < minConfidence) return null;
  const h = res.table.headers.map((x) => x.toLowerCase());
  const docCol = h.findIndex((x) => /document/.test(x));
  if (docCol < 0) return null;
  const reqCol = h.findIndex((x, i) => i !== docCol && /requirement|mandatory|required/.test(x));
  const remCol = h.findIndex((x, i) => i !== docCol && /remark|format|note/.test(x));
  const cell = (row: TableRow, i: number) => (i < 0 ? '' : (row.cells.find((c) => c.columnIndex === i)?.text ?? '').replace(/\s+/g, ' ').trim());
  const out: TableChecklistItem[] = [];
  for (const row of res.table.rows) {
    const label = cell(row, docCol);
    if (!label) continue;
    let line = [cell(row, reqCol), cell(row, remCol)].filter(Boolean).join(' — ') || 'Listed in the document table';
    if (row.confidence < 0.7) line += ' ⚠️ low read confidence — verify this row against the document';
    out.push({ key: 'doctable-' + row.rowIndex, label, found: true, line });
  }
  return out.length ? out : null;
}
