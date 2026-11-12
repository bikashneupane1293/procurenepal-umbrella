// Excel import / export / templates for Project Management (projects + BOQ).
// Loaded only when a button is clicked. © Cuidado Technology Pvt. Ltd.
import * as XLSX from 'xlsx';
import { autoWidth, dateStr, num, txt } from './excel';
import type { SheetRow } from './sheets';

export const PROJECT_STATUS_LIST = ['PLANNED', 'MOBILIZING', 'ONGOING', 'SUSPENDED', 'COMPLETED', 'HANDED_OVER', 'CLOSED', 'TERMINATED'];

const today = () => new Date().toISOString().slice(0, 10);
const d10 = (v: any) => (v ? String(v).slice(0, 10) : '');
const n0 = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v));
const help = (lines: string[]) => {
  const ws = XLSX.utils.aoa_to_sheet([...lines.map((l) => [l]), [''], ['© Cuidado Technology Pvt. Ltd. · ProcureNepal']]);
  ws['!cols'] = [{ wch: 110 }];
  return ws;
};
const sheet = (rows: any[][], cols: string[]) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  autoWidth(ws, cols);
  return ws;
};
const finish = (r: SheetRow): SheetRow => ({ ...r, status: r.errors.length ? 'error' : 'ready', message: r.errors.join('; ') });
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60);

// =================================================================== PROJECTS
export const PROJECT_COLS = [
  'Company', 'Project Code', 'Project Name', 'Client', 'Location', 'Contract No', 'Type', 'Contract Amount (excl. VAT)',
  'Contract Sign Date', 'Start Date', 'Period (months)', 'Intended Completion', 'Revised Completion', 'Actual Completion',
  'Defect Liability (months)', 'Advance %', 'Retention %', 'Project Manager', "Client's Engineer", 'Status', 'Notes',
];

export function exportProjects(list: any[]) {
  const cols = [...PROJECT_COLS, 'BOQ Lines', 'BOQ Total', 'Open Guarantees (NPR)', 'Time Used %', 'Alerts'];
  const rows = list.map((p) => [
    p.company?.name ?? '', p.code, p.name, p.client ?? '', p.location ?? '', p.contractNo ?? '', p.projectType ?? '', n0(p.contractAmount),
    d10(p.contractSignDate), d10(p.startDate), p.contractPeriodMonths ?? '', d10(p.intendedCompletionDate), d10(p.revisedCompletionDate),
    d10(p.actualCompletionDate), p.defectLiabilityMonths ?? '', n0(p.advancePct), n0(p.retentionPct), p.projectManager ?? '', p.clientEngineer ?? '',
    p.status, p.notes ?? '', p.boqCount ?? '', p.boqTotal ?? '', p.openGuaranteeAmount ?? '', p.timeUsedPct ?? '',
    (p.alerts ?? []).map((a: any) => a.message).join(' | '),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([cols, ...rows], cols), 'Projects');
  XLSX.writeFile(wb, `ProcureNepal_Projects_${today()}.xlsx`);
}

export function projectsTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([PROJECT_COLS,
    ['Cuidado Construction Pvt. Ltd.', '', 'Hetauda–Bhimphedi Road Upgrading', 'Division Road Office, Hetauda', 'Makwanpur', 'DOR/NCB/2083-84/07', 'ROAD',
      94000000, '2083/08/24', '2083/08/24', 18, '', '', '', 12, 10, 5, 'Er. Sita Sharma', 'Er. Hari Thapa', 'ONGOING', 'Imported from Excel'],
    ['Cuidado Construction Pvt. Ltd.', 'BLD-07', 'Private hospital block', 'Mr. Client', 'Kathmandu', '', 'BUILDING',
      25000000, '', '2026-01-15', 12, '', '', '', '', '', '', '', '', 'PLANNED', ''],
  ], PROJECT_COLS), 'Projects');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — Project import guide',
    'Company and Project Name are required. The company must already exist (same spelling). Project Code blank = next free code (P-001 …); an existing code is skipped.',
    `Status: ${PROJECT_STATUS_LIST.join(', ')}. Type: ROAD, BUILDING, IRRIGATION, BRIDGE or your own word.`,
    'Intended Completion blank = Start Date + Period (months). Won bids become projects by themselves when the bid is marked "Contract signed" — no need to import those.',
    'Dates: AD as YYYY-MM-DD or BS as YYYY/MM/DD (years 2040 and later are read as BS). Amounts: taxable amount only (excluding VAT), in NPR.',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_Projects_Template.xlsx');
}

export async function readProjectsFile(file: File, companies: any[], existing: any[]): Promise<SheetRow[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets['Projects'] ?? wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
  if (!rows.length) throw new Error('The sheet has no rows.');
  const missing = ['Company', 'Project Name'].filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`Column(s) not found: ${missing.join(', ')}. Download the template and keep the column names.`);
  const cByName = new Map(companies.map((c) => [String(c.name).trim().toLowerCase(), c]));
  const codes = new Set(existing.map((p) => String(p.code).trim().toLowerCase()));
  const out: SheetRow[] = [];
  rows.forEach((r, i) => {
    if (PROJECT_COLS.every((c) => txt(r[c]) === '')) return;
    const errors: string[] = [];
    const c = cByName.get(txt(r['Company']).toLowerCase());
    if (!c) errors.push(`Company "${txt(r['Company'])}" not found`);
    const name = txt(r['Project Name']);
    if (!name) errors.push('Project Name is required');
    const body: any = { companyId: c?.id, name };
    const code = txt(r['Project Code']);
    if (code) {
      if (codes.has(code.toLowerCase())) errors.push(`Project code ${code} already exists — skipped`);
      codes.add(code.toLowerCase());
      body.code = code;
    }
    const status = txt(r['Status']).toUpperCase().replace(/[\s-]+/g, '_');
    if (status && !PROJECT_STATUS_LIST.includes(status)) errors.push(`Status must be one of ${PROJECT_STATUS_LIST.join(', ')}`);
    else if (status) body.status = status;
    for (const [col, f] of [['Contract Sign Date', 'contractSignDate'], ['Start Date', 'startDate'], ['Intended Completion', 'intendedCompletionDate'],
      ['Revised Completion', 'revisedCompletionDate'], ['Actual Completion', 'actualCompletionDate']] as const) {
      const v = dateStr(r[col]);
      if (v === null) errors.push(`${col} must be YYYY-MM-DD (AD) or YYYY/MM/DD (BS)`);
      else if (v) body[f] = v;
    }
    for (const [col, f, max, int] of [['Contract Amount (excl. VAT)', 'contractAmount', Infinity, false], ['Period (months)', 'contractPeriodMonths', 240, true],
      ['Defect Liability (months)', 'defectLiabilityMonths', 120, true], ['Advance %', 'advancePct', 100, false], ['Retention %', 'retentionPct', 100, false]] as const) {
      const v = num(r[col]);
      if (v === null) continue;
      if (isNaN(v) || v < (f === 'contractPeriodMonths' ? 1 : 0) || v > max) errors.push(`${col} must be a number from ${f === 'contractPeriodMonths' ? 1 : 0}${max === Infinity ? '' : ' to ' + max}`);
      else body[f] = int ? Math.round(v) : v;
    }
    for (const [col, f] of [['Client', 'client'], ['Location', 'location'], ['Contract No', 'contractNo'], ['Type', 'projectType'],
      ['Project Manager', 'projectManager'], ["Client's Engineer", 'clientEngineer'], ['Notes', 'notes']] as const) {
      if (txt(r[col])) body[f] = txt(r[col]);
    }
    out.push(finish({ rowNo: i + 2, label: [txt(r['Company']), code || '(auto)', name, body.contractAmount ? Number(body.contractAmount).toLocaleString('en-IN') : '—'], body, errors, status: 'ready', message: '' }));
  });
  return out;
}

// =================================================================== BOQ
export const BOQ_COLS = ['Item No', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount', 'Section', 'Notes'];

export function exportBoq(project: any, items: any[]) {
  const rows = items.map((i) => [i.itemNo ?? '', i.description, i.unit ?? '', n0(i.quantity), n0(i.rate), n0(i.amount), i.section ?? '', i.notes ?? '']);
  const total = items.filter((i) => !i.isHeading).reduce((t, i) => t + Number(i.amount ?? 0), 0);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([BOQ_COLS, ...rows, [], ['', 'Total (excl. VAT)', '', '', '', Math.round(total * 100) / 100]], BOQ_COLS), 'BOQ');
  XLSX.writeFile(wb, `ProcureNepal_BOQ_${safeName(project.code ?? 'project')}_${today()}.xlsx`);
}

export function boqTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([BOQ_COLS,
    ['1', 'Site clearance and earthwork', '', '', '', '', '', 'A heading: no quantity / rate'],
    ['1.1', 'Clearing and grubbing', 'm2', 12500, 18.5, '', 'Earthwork', ''],
    ['1.2', 'Excavation in ordinary soil including disposal up to 50 m', 'm3', 3200.5, 245, '', 'Earthwork', ''],
    ['2', 'Pavement', '', '', '', '', '', ''],
    ['2.1', 'Granular sub-base (GSB)', 'm3', 1850, 3150, '', 'Pavement', ''],
    ['2.2', 'Asphalt concrete 40 mm', 'm2', 9600, 1250, '', 'Pavement', ''],
  ], BOQ_COLS), 'BOQ');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — BOQ import guide',
    'Description is required on every line. A line without Quantity and Rate is a heading (e.g. "1 Earthwork").',
    'Amount = Quantity × Rate (calculated). If your Amount column differs, ProcureNepal tells you which lines and uses Quantity × Rate.',
    'You can also upload the BOQ exactly as downloaded from e-GP / the tender document: ProcureNepal looks for the header row (S.N. / Item No, Description, Unit, Quantity, Rate, Amount) on each sheet and skips Total / Sub-total rows.',
    'Several sheets (Bill No. 1, Bill No. 2 …) are read one after another; the sheet name becomes the Section when the Section column is empty.',
    'Rates: taxable amount only (excluding VAT), in NPR. Quantities up to 3 decimals, rates up to 2 decimals.',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_BOQ_Template.xlsx');
}

const SYN: Record<string, RegExp> = {
  itemNo: /^(item\s*(no\.?|number|#)?|s\.?\s*no\.?|s\.?\s*n\.?|sr\.?\s*no\.?|ref(erence)?|code|क्र\.?\s*सं\.?)$/i,
  description: /(description|particular|item of work|work item|विवरण)/i,
  unit: /^(unit|units|इकाई)$/i,
  quantity: /^(qty\.?|quantity|quantities|परिमाण)/i,
  rate: /^(unit\s*)?rate|^दर/i,
  amount: /^(total\s*)?amount|^रकम/i,
  section: /^(section|bill|group)$/i,
  notes: /^(notes?|remarks?|कैफियत)$/i,
};
const SKIP_ROW = /^(sub[\s-]*total|grand\s*total|total|carried|brought\s*forward|b\/f|c\/f|vat|contingenc|summary)\b/i;

/** Finds the header row of one sheet: returns column indexes or null */
function headerOf(rows: any[][]): { at: number; col: Record<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const col: Record<string, number> = {};
    rows[r].forEach((v, i) => {
      const s = txt(v).replace(/\s+/g, ' ');
      if (!s) return;
      for (const [k, re] of Object.entries(SYN)) if (col[k] === undefined && re.test(s)) { col[k] = i; break; }
    });
    if (col['description'] !== undefined && (col['quantity'] !== undefined || col['rate'] !== undefined)) return { at: r, col };
  }
  return null;
}

/** Reads a BOQ workbook (template or tender-document style). Each SheetRow.body is a BOQ line. */
export async function readBoqFile(file: File): Promise<{ rows: SheetRow[]; sheets: string[] }> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  const out: SheetRow[] = [];
  const used: string[] = [];
  const names = wb.SheetNames.filter((n) => !/instruction|guide|help/i.test(n));
  const many = names.filter((n) => headerOf(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }) as any[][])).length > 1;
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false }) as any[][];
    const h = headerOf(rows);
    if (!h) continue;
    used.push(name);
    let section = many ? name : '';
    for (let r = h.at + 1; r < rows.length; r++) {
      const row = rows[r];
      const get = (k: string) => (h.col[k] === undefined ? '' : row[h.col[k]]);
      const description = txt(get('description')).replace(/\s+/g, ' ');
      const itemNo = txt(get('itemNo'));
      const q = num(get('quantity'));
      const rate = num(get('rate'));
      const amount = num(get('amount'));
      if (!description && !itemNo && q === null && rate === null && amount === null) continue;
      if (SKIP_ROW.test(description) && q === null && rate === null) continue; // totals rows
      const errors: string[] = [];
      if (!description) errors.push('Description is empty');
      for (const [label, v] of [['Quantity', q], ['Rate', rate], ['Amount', amount]] as const) {
        if (v !== null && (isNaN(v) || v < 0)) errors.push(`${label} must be a number ≥ 0`);
      }
      const heading = q === null && rate === null;
      if (heading && description) section = (many ? name + ' — ' : '') + description;
      const body: any = { description: description || '(blank)', isHeading: heading };
      if (itemNo) body.itemNo = itemNo;
      if (txt(get('unit'))) body.unit = txt(get('unit'));
      if (!heading) {
        if (q !== null && !isNaN(q)) body.quantity = Math.round(q * 1000) / 1000;
        if (rate !== null && !isNaN(rate)) body.rate = Math.round(rate * 100) / 100;
        if (amount !== null && !isNaN(amount)) body.amount = Math.round(amount * 100) / 100;
        const s = txt(get('section')) || (section || '');
        if (s) body.section = s.slice(0, 200);
      }
      if (txt(get('notes'))) body.notes = txt(get('notes')).slice(0, 1000);
      const shown = !heading && body.quantity !== undefined && body.rate !== undefined ? Math.round(body.quantity * body.rate * 100) / 100 : body.amount;
      out.push(finish({
        rowNo: r + 1,
        label: [many ? `${name}: ${itemNo}` : itemNo, description.length > 70 ? description.slice(0, 70) + '…' : description, body.unit ?? '',
          heading ? 'heading' : `${body.quantity ?? '—'} × ${body.rate ?? '—'} = ${shown != null ? Number(shown).toLocaleString('en-IN') : '—'}`],
        body, errors, status: 'ready', message: '',
      }));
    }
  }
  if (!used.length) throw new Error('No BOQ table found. The sheet needs a header row with at least "Description" and "Quantity" (or "Rate") — download the BOQ Template.');
  return { rows: out, sheets: used };
}
