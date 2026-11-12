// Excel / CSV for every ERP register, built from the register's definition (sent by the API).
// Loaded only when a button is clicked. © Cuidado Technology Pvt. Ltd.
import * as XLSX from 'xlsx';
import { autoWidth, dateStr, num, txt, yes } from './excel';
import type { SheetRow } from './sheets';

type Opt = { id: string; label: string; extra?: any };
/** returns the choices of a linked list (products, vendors, projects, BOQ items of a project …) */
export type OptFn = (ref: string, projectId?: string) => Promise<Opt[]>;

const today = () => new Date().toISOString().slice(0, 10);
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 50);
const sheet = (rows: any[][], cols: string[]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  autoWidth(ws, cols);
  return ws;
};
const heads = (def: any) => def.fields.filter((f: any) => !f.calc);
const lineCols = (def: any) => (def.lines?.cols ?? []).filter((c: any) => !c.calc);
const kind = (f: any) =>
  f.type === 'select' ? `one of: ${f.options.join(', ')}`
    : f.type === 'ref' ? 'name exactly as in ProcureNepal'
      : f.type === 'multiref' ? 'names separated by ;'
        : f.type === 'date' ? 'date — AD YYYY-MM-DD or BS YYYY/MM/DD'
          : f.type === 'bool' ? 'Yes / No'
            : f.type === 'number' || f.type === 'money' ? 'number' : 'text';

export function erpTemplate(def: any) {
  const wb = XLSX.utils.book_new();
  const cols = [...(def.lines ? ['Ref'] : []), ...heads(def).map((f: any) => f.label), ...(def.statuses ? ['Status'] : [])];
  XLSX.utils.book_append_sheet(wb, sheet([cols], cols), 'Data');
  if (def.lines) {
    const lc = ['Ref', ...lineCols(def).map((c: any) => c.label)];
    XLSX.utils.book_append_sheet(wb, sheet([lc], lc), 'Lines');
  }
  const guide: string[][] = [
    [`ProcureNepal — ${def.title} import guide`], [''],
    ['Fill one row per ' + def.one + ' on the "Data" sheet. Keep the column names.'],
    ...(def.lines ? [[`"${def.lines.title}" go on the "Lines" sheet. The Ref column links a line to its row on the Data sheet (use 1, 2, 3 … or any word).`]] : []),
    [''], ['Column', 'Required', 'What to type'],
    ...heads(def).map((f: any) => [f.label, f.req ? 'yes' : '', kind(f) + (f.help ? ' — ' + f.help : '')]),
    ...(def.statuses ? [['Status', '', `one of: ${def.statuses.join(', ')} (blank = ${def.statuses[0]})`]] : []),
    ...(def.lines ? [[''], [`Lines — ${def.lines.title}`], ...lineCols(def).map((c: any) => [c.label, c.req ? 'yes' : '', kind(c)])] : []),
    [''], ['Amounts are in NPR, taxable amount only (excluding VAT).'], ['© Cuidado Technology Pvt. Ltd. · ProcureNepal'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(guide);
  ws['!cols'] = [{ wch: 34 }, { wch: 10 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Instructions');
  XLSX.writeFile(wb, `ProcureNepal_${safe(def.title)}_Template.xlsx`);
}

const shown = (f: any, r: any) => {
  const v = r.data?.[f.k];
  if (f.type === 'ref' || f.type === 'multiref') return (r.labels?.[f.k] ?? '').replace(/, /g, f.type === 'multiref' ? '; ' : ', ');
  if (f.type === 'bool') return v ? 'Yes' : 'No';
  return v ?? '';
};

export function erpExport(def: any, rows: any[]) {
  const wb = XLSX.utils.book_new();
  const cols = [...(def.lines ? ['Ref'] : []), ...(def.series ? ['Number'] : []), ...def.fields.map((f: any) => f.label), ...(def.statuses ? ['Status'] : []),
    ...(rows.some((r) => r.total != null) ? ['Total'] : []), 'Alert'];
  const ref = (r: any, i: number) => r.number ?? String(i + 1);
  XLSX.utils.book_append_sheet(wb, sheet([cols, ...rows.map((r, i) => [
    ...(def.lines ? [ref(r, i)] : []), ...(def.series ? [r.number ?? ''] : []), ...def.fields.map((f: any) => shown(f, r)), ...(def.statuses ? [r.status ?? ''] : []),
    ...(rows.some((x) => x.total != null) ? [r.total ?? ''] : []), r.alert ?? '',
  ])], cols), 'Data');
  if (def.lines) {
    const lc = ['Ref', ...def.lines.cols.map((c: any) => c.label)];
    const out: any[][] = [];
    rows.forEach((r, i) => (r.lines ?? []).forEach((l: any, j: number) => out.push([ref(r, i), ...def.lines.cols.map((c: any) => (c.type === 'ref' ? r.lineLabels?.[j]?.[c.k] ?? '' : l[c.k] ?? ''))])));
    XLSX.utils.book_append_sheet(wb, sheet([lc, ...out], lc), 'Lines');
  }
  XLSX.writeFile(wb, `ProcureNepal_${safe(def.title)}_${today()}.xlsx`);
}

async function cell(f: any, raw: any, errors: string[], opts: OptFn, where: string, projectId?: string): Promise<any> {
  const s = txt(raw);
  if (s === '') return undefined;
  const bad = (m: string) => { errors.push(`${where}${f.label} ${m}`); return undefined; };
  switch (f.type) {
    case 'number': case 'money': { const n = num(raw); return n === null || isNaN(n) || n < 0 ? bad('must be a number ≥ 0') : n; }
    case 'date': { const d = dateStr(raw); return d ? d : bad('must be YYYY-MM-DD (AD) or YYYY/MM/DD (BS)'); }
    case 'bool': return yes(raw);
    case 'select': { const k = f.options.find((o: string) => o.toLowerCase() === s.toLowerCase() || o.toLowerCase() === s.toLowerCase().replace(/[\s-]+/g, '_')); return k ?? bad(`must be one of ${f.options.join(', ')}`); }
    case 'ref': case 'multiref': {
      const list = await opts(f.ref, projectId);
      const find = (name: string) => list.find((o) => o.label.trim().toLowerCase() === name.trim().toLowerCase())
        ?? list.find((o) => o.label.trim().toLowerCase().startsWith(name.trim().toLowerCase() + ' '));
      if (f.type === 'ref') { const o = find(s); return o ? o.id : bad(`"${s}" not found`); }
      const ids: string[] = [];
      for (const part of s.split(';').map((x) => x.trim()).filter(Boolean)) { const o = find(part); if (o) ids.push(o.id); else bad(`"${part}" not found`); }
      return ids;
    }
    default: return s;
  }
}

export async function erpRead(file: File, def: any, opts: OptFn): Promise<SheetRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets['Data'] ?? wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
  if (!rows.length) throw new Error('The "Data" sheet has no rows.');
  const need = heads(def).filter((f: any) => f.req).map((f: any) => f.label).filter((c: string) => !(c in rows[0]));
  if (need.length) throw new Error(`Column(s) not found: ${need.join(', ')}. Download the template and keep the column names.`);
  const lrows: any[] = def.lines && wb.Sheets['Lines'] ? XLSX.utils.sheet_to_json(wb.Sheets['Lines'], { defval: '' }) : [];
  const out: SheetRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (heads(def).every((f: any) => txt(r[f.label]) === '')) continue;
    const errors: string[] = [];
    const data: any = {};
    for (const f of heads(def)) {
      const v = await cell(f, r[f.label], errors, opts, '');
      if (v !== undefined) data[f.k] = v;
      else if (f.req && txt(r[f.label]) === '') errors.push(`${f.label} is required`);
    }
    const body: any = { data };
    const st = txt(r['Status']).toUpperCase().replace(/[\s-]+/g, '_');
    if (st && def.statuses) { if (def.statuses.includes(st)) body.status = st; else errors.push(`Status must be one of ${def.statuses.join(', ')}`); }
    if (def.lines) {
      const mine = lrows.filter((l) => txt(l['Ref']) !== '' && txt(l['Ref']) === txt(r['Ref']));
      body.lines = [];
      for (let j = 0; j < mine.length; j++) {
        const line: any = {};
        for (const c of lineCols(def)) {
          const v = await cell(c, mine[j][c.label], errors, opts, `Line ${j + 1} — `, data.project);
          if (v !== undefined) line[c.k] = v;
          else if (c.req && txt(mine[j][c.label]) === '') errors.push(`Line ${j + 1} — ${c.label} is required`);
        }
        body.lines.push(line);
      }
      if (def.lines.required && !body.lines.length) errors.push(`No rows on the "Lines" sheet with Ref "${txt(r['Ref'])}"`);
    }
    const label = heads(def).filter((f: any) => f.list).slice(0, 4).map((f: any) => txt(r[f.label]));
    out.push({ rowNo: i + 2, label: [...label, def.lines ? `${body.lines.length} line(s)` : ''], body, errors, status: errors.length ? 'error' : 'ready', message: errors.join('; ') });
  }
  return out;
}

// ---------------------------------------------------------------- reports and CSV
export function tablesToExcel(title: string, tables: { title: string; columns: { k: string; label: string }[]; rows: any[] }[], cards: { label: string; value: any; hint?: string }[] = []) {
  const wb = XLSX.utils.book_new();
  if (cards.length) XLSX.utils.book_append_sheet(wb, sheet([['Item', 'Value', 'Note'], ...cards.map((c) => [c.label, c.value, c.hint ?? ''])], ['Item', 'Value', 'Note']), 'Summary');
  const used = new Set<string>(['Summary']);
  tables.forEach((t, i) => {
    let name = (t.title || `Table ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28);
    while (used.has(name)) name = name.slice(0, 26) + ' ' + (i + 1);
    used.add(name);
    const cols = t.columns.map((c) => c.label);
    XLSX.utils.book_append_sheet(wb, sheet([cols, ...t.rows.map((r) => t.columns.map((c) => r[c.k] ?? ''))], cols), name);
  });
  XLSX.writeFile(wb, `ProcureNepal_${safe(title)}_${today()}.xlsx`);
}

const csvCell = (v: any) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function downloadCsv(title: string, columns: string[], rows: any[][]) {
  const text = '﻿' + [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads Nepali text
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `ProcureNepal_${safe(title)}_${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function datasetToExcel(title: string, columns: string[], rows: any[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([columns, ...rows], columns), 'Data');
  XLSX.writeFile(wb, `ProcureNepal_${safe(title)}_${today()}.xlsx`);
}
