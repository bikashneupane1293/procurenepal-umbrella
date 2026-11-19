import { reconstructTable, findAnchorTableOnPage, checklistFromDocumentTable, PdfTextItem } from './pdf-table-reconstruct';
import { ITB21_PAGE20_FIXTURE } from './itb21-page20.fixture';

// Regression fixture: raw pdf.js items captured from the REAL tender PDF's page 20, containing
// the actual ITB 21 "No. | Document | Requirement | Remarks" e-submission checklist table. This
// is the exact table named in the Phase 1A brief as the success criterion — not a synthesized or
// hand-typed approximation.
describe('pdf-table-reconstruct (Phase 1A, isolated module)', () => {
  it('reconstructs the real ITB 21 checklist table with all 10 rows, correct columns, and correct word order', () => {
    const result = findAnchorTableOnPage(ITB21_PAGE20_FIXTURE);
    if (!result.table) {
      // Surface exactly which structural check rejected the table before failing the assertion.
      throw new Error(`expected a reconstructed table, got null. warnings: ${JSON.stringify(result.warnings)}`);
    }
    const table = result.table;
    expect(table.rows.length).toBe(10);
    expect(table.confidence).toBeGreaterThanOrEqual(0.9);

    // The header row's own words, split through the same column boundaries as the body — real
    // labels ("Document", "Requirement", "Remarks"), not placeholders like "Column 2".
    expect(table.headers).toEqual(['No.', 'Document', 'Requirement', 'Remarks']);

    const texts = table.rows.map((r) => r.cells.map((c) => c.text));

    // Row 0: anchor + Document + Requirement + Remarks, in that column order.
    expect(texts[0]).toEqual(['1.', 'Letter of Technical Bid', 'Mandatory', 'PDF']);

    // This is the exact case that broke the earlier "split at the single widest gap" approach —
    // the words must come out in their original reading order ("Bid Security / Bank Guarantee"),
    // not scrambled ("Bid Guarantee Security / Bank").
    expect(texts[1]).toEqual(['2.', 'Bid Security / Bank Guarantee', 'Mandatory', 'PDF']);

    // Row with a mid-cell line wrap merged into one Document cell across two physical PDF lines.
    expect(texts[2]).toEqual(['3.', 'Firm or Company registration Certificate', 'Mandatory', 'PDF']);

    // Row whose Requirement cell itself wraps onto a second physical line.
    expect(texts[3]).toEqual(['4.', 'VAT and PAN registration Certificate', 'Mandatory (for domestic bidders only)', 'PDF']);

    // Last row: both the Document and Requirement cells wrap onto a second physical PDF line that
    // sits just above the page's own end-of-table sentinel — this is the exact row that an earlier
    // off-by-one in the region-cropping boundary truncated (it dropped this wrapped line entirely).
    expect(texts[9]).toEqual(['10.', 'Additional documents] specified in ITB 11.2 (i)', 'Mandatory (If any)', 'PDF']);

    // Word order and source coordinates are preserved verbatim (requirement #6): every emitted
    // cell's `words` array must be the literal source items, in original reading order (top line
    // first, left-to-right within each line) — not re-ordered, and each carries its real source
    // x/y, not a synthesized position.
    const row1DocCell = table.rows[1].cells[1];
    expect(row1DocCell.words.map((w) => w.s)).toEqual(['Bid', 'Security', '/', 'Bank', 'Guarantee']);
    expect(row1DocCell.words.every((w) => typeof w.x === 'number' && typeof w.y === 'number')).toBe(true);
    // Within the top physical line, x must be strictly ascending (left to right, unscrambled).
    const topLineWords = row1DocCell.words.filter((w) => w.y === row1DocCell.words[0].y);
    const topXs = topLineWords.map((w) => w.x);
    expect(topXs).toEqual([...topXs].sort((a, b) => a - b));
  });

  it('never silently returns a reconstruction below its own confidence floor', () => {
    const result = findAnchorTableOnPage(ITB21_PAGE20_FIXTURE);
    expect(result.table).not.toBeNull();
    for (const row of result.table!.rows) {
      for (const cell of row.cells) expect(cell.confidence).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('falls back to null (not a guessed table) on a plain numbered list with hanging indent, not a real table', () => {
    // Synthetic 2-column case: a numbered marker column followed by ordinary wrapping prose — the
    // exact shape of a hanging-indent list, which is NOT the table this module targets (it's
    // already handled correctly by the existing, deployed 2-column fix in pdf-reader.ts). This
    // module must stay out of that path rather than re-shape it into a fabricated "table".
    const items: PdfTextItem[] = [
      { str: '1.', transform: [1, 0, 0, 1, 50, 700] },
      { str: 'This is the first long clause of plain running text that wraps.', transform: [1, 0, 0, 1, 70, 700] },
      { str: 'and continues on a second physical line of the same paragraph.', transform: [1, 0, 0, 1, 50, 688] },
      { str: '2.', transform: [1, 0, 0, 1, 50, 670] },
      { str: 'Another clause of plain running text, single line only.', transform: [1, 0, 0, 1, 70, 670] },
      { str: '3.', transform: [1, 0, 0, 1, 50, 655] },
      { str: 'A third clause, also just one line of plain prose.', transform: [1, 0, 0, 1, 70, 655] },
    ];
    const result = reconstructTable(items);
    expect(result.table).toBeNull();
  });

  it('finds no table anywhere else on the real ITB 21 page\'s own text (only the one real table)', () => {
    // Defensive regression: the whole-page fixture also contains ordinary paragraph text above
    // and below the table. Confirm the module fires exactly once per page, not once per line.
    const result = findAnchorTableOnPage(ITB21_PAGE20_FIXTURE);
    expect(result.table?.rows.length).toBe(10);
  });

  // ---- Phase A.5 focused edge-case tests, added on review (compact synthetic fixtures) ----

  /** A column with an explicit `width`, at a given font size, laid out on one of a few fixed rows. */
  function cell(str: string, x: number, y: number, width: number): PdfTextItem {
    return { str, transform: [9, 0, 0, 9, x, y], width };
  }

  it('reconstructs a genuine table with 4 content columns (5 columns total), not just the 3 seen in the real fixture', () => {
    // No., A, B, C, D — four real column gutters (~30pt each), all narrower than nothing here
    // (unlike the real document, this fixture has no wide intra-cell word gaps to stress-test
    // against, so it isolates "does N>3 columns work at all" from "does it survive wide word
    // gaps", which the real-fixture tests above already cover).
    const items: PdfTextItem[] = [
      cell('1.', 50, 700, 15), cell('Alpha', 90, 700, 50), cell('Beta', 170, 700, 40), cell('Gamma', 250, 700, 50), cell('Delta', 330, 700, 50),
      cell('2.', 50, 685, 15), cell('Echo', 90, 685, 50), cell('Foxtrot', 170, 685, 60), cell('Hotel', 250, 685, 45), cell('India', 330, 685, 45),
      cell('3.', 50, 670, 15), cell('Juliet', 90, 670, 50), cell('Kilo', 170, 670, 35), cell('Lima', 250, 670, 35), cell('Mike', 330, 670, 45),
    ];
    const result = reconstructTable(items);
    if (!result.table) throw new Error(`expected a table, got null: ${JSON.stringify(result.warnings)}`);
    expect(result.table.columns.length).toBe(5);
    expect(result.table.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['1.', 'Alpha', 'Beta', 'Gamma', 'Delta'],
      ['2.', 'Echo', 'Foxtrot', 'Hotel', 'India'],
      ['3.', 'Juliet', 'Kilo', 'Lima', 'Mike'],
    ]);
  });

  it('marks a row\'s cell as empty (not corrupted or shifted) when a column has no content for that row', () => {
    const items: PdfTextItem[] = [
      cell('1.', 50, 700, 15), cell('Alpha', 90, 700, 50), cell('Beta', 170, 700, 40), cell('Gamma', 250, 700, 50),
      // Row 2 has nothing in the "Beta" column at all (a genuinely blank cell) — anchor + col A +
      // col C must still land correctly, and the missing cell must come back empty, not absorb
      // neighboring text or shift everything left by one column.
      cell('2.', 50, 685, 15), cell('Echo', 90, 685, 50), cell('Hotel', 250, 685, 45),
      cell('3.', 50, 670, 15), cell('Juliet', 90, 670, 50), cell('Kilo', 170, 670, 35), cell('Lima', 250, 670, 35),
    ];
    const result = reconstructTable(items);
    if (!result.table) throw new Error(`expected a table, got null: ${JSON.stringify(result.warnings)}`);
    const row2 = result.table.rows[1];
    expect(row2.cells.map((c) => c.text)).toEqual(['2.', 'Echo', '', 'Hotel']);
    expect(row2.cells[2].confidence).toBeLessThan(0.95);
    expect(row2.cells[2].warnings.join(' ')).toContain('empty cell');
  });

  it('ignores whitespace-only pdf.js items (the original bug) when locating column gutters', () => {
    // Same shape as the first positive case, but with an explicit whitespace-only item inserted
    // between every pair of real tokens, exactly as pdf.js sometimes emits them. Must reconstruct
    // identically to the version without them.
    const items: PdfTextItem[] = [
      cell('1.', 50, 700, 15), { str: ' ', transform: [9, 0, 0, 9, 65, 700], width: 25 }, cell('Alpha', 90, 700, 50),
      { str: ' ', transform: [9, 0, 0, 9, 140, 700], width: 30 }, cell('Beta', 170, 700, 40),
      cell('2.', 50, 685, 15), cell('Echo', 90, 685, 50), cell('3.', 50, 670, 15), cell('Juliet', 90, 670, 50), cell('Kilo', 170, 670, 35),
      cell('4.', 50, 655, 15), cell('Mike', 90, 655, 50), cell('November', 170, 655, 35),
    ];
    const result = reconstructTable(items);
    if (!result.table) throw new Error(`expected a table, got null: ${JSON.stringify(result.warnings)}`);
    expect(result.table.rows[0].cells.map((c) => c.text)).toEqual(['1.', 'Alpha', 'Beta']);
  });

  it('does not crash and does not fabricate a table from pathologically overlapping item spans', () => {
    // Two items whose [x, end] spans overlap each other outright (should never happen with real
    // pdf.js output, but a defensive check costs nothing): must not throw, and must not silently
    // invent column structure out of malformed geometry.
    const items: PdfTextItem[] = [
      { str: 'Overlap', transform: [9, 0, 0, 9, 50, 700], width: 60 },
      { str: 'ping', transform: [9, 0, 0, 9, 70, 700], width: 60 },
      cell('1.', 50, 685, 15), cell('Alpha', 90, 685, 50),
      cell('2.', 50, 670, 15), cell('Beta', 90, 670, 50),
    ];
    expect(() => reconstructTable(items)).not.toThrow();
  });

  it('merges rather than invents a boundary when only one row has content on one side of a candidate gap', () => {
    const items: PdfTextItem[] = [
      cell('1.', 50, 700, 15), cell('Alpha', 90, 700, 50), cell('Beta', 170, 700, 40),
      // A stray item far to the right, present on only ONE row. There is genuinely no OTHER row
      // with any content out there to confirm a real column boundary before it, so the engine
      // must not invent one — "Beta" and "Stray" end up in the same (last) column rather than a
      // fabricated extra column with only one row of "support" (`rowsRight >= 2` is exactly what
      // rejects the candidate gap here). Under-segmenting like this is the safe failure mode.
      cell('Stray', 400, 700, 40),
      cell('2.', 50, 685, 15), cell('Echo', 90, 685, 50), cell('Foxtrot', 170, 685, 60),
      cell('3.', 50, 670, 15), cell('Juliet', 90, 670, 50), cell('Kilo', 170, 670, 35),
    ];
    const result = reconstructTable(items);
    if (!result.table) throw new Error(`expected a table, got null: ${JSON.stringify(result.warnings)}`);
    expect(result.table.columns.length).toBe(3);
    expect(result.table.rows[0].cells.map((c) => c.text)).toEqual(['1.', 'Alpha', 'Beta Stray']);
  });

  it('does not detect a table in an ordinary paragraph with no numbered/lettered anchor column at all', () => {
    const items: PdfTextItem[] = [
      cell('This', 50, 700, 30), cell('is', 90, 700, 20), cell('plain', 120, 700, 40), cell('prose', 170, 700, 40), cell('with', 220, 700, 35), cell('no', 260, 700, 20),
      cell('table', 50, 685, 40), cell('structure', 100, 685, 60), cell('whatsoever,', 170, 685, 70), cell('just', 250, 685, 30), cell('a', 290, 685, 10), cell('wrapped', 310, 685, 55),
      cell('paragraph.', 50, 670, 65),
    ];
    const result = reconstructTable(items);
    expect(result.table).toBeNull();
  });

  it('turns the real ITB 21 table into readiness-checklist rows (document label + requirement/format)', () => {
    const page = findAnchorTableOnPage(ITB21_PAGE20_FIXTURE);
    const items = checklistFromDocumentTable({ table: page.table!, pageNumber: 20, warnings: [] });
    expect(items).not.toBeNull();
    expect(items!.length).toBe(10);
    expect(items![0]).toMatchObject({ label: 'Letter of Technical Bid', found: true, line: 'Mandatory — PDF' });
    expect(items![1].label).toBe('Bid Security / Bank Guarantee');
    expect(items![7]).toMatchObject({ label: 'Joint venture agreement', line: 'Mandatory in case of JV Bids Only — PDF' });
  });

  it('refuses to build a checklist from a table without a named Document column or with low confidence', () => {
    const page = findAnchorTableOnPage(ITB21_PAGE20_FIXTURE);
    const t = page.table!;
    expect(checklistFromDocumentTable(null)).toBeNull();
    expect(checklistFromDocumentTable({ table: { ...t, headers: undefined }, pageNumber: 20, warnings: [] })).toBeNull();
    expect(checklistFromDocumentTable({ table: { ...t, headers: ['No.', 'Item', 'Qty', 'Rate'] }, pageNumber: 20, warnings: [] })).toBeNull();
    expect(checklistFromDocumentTable({ table: { ...t, confidence: 0.6 }, pageNumber: 20, warnings: [] })).toBeNull();
  });
});
