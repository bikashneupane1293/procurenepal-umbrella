// Excel import / export / templates for Companies, Annual Turnover and Tenders.
// Loaded only when a button is clicked. © Cuidado Technology Pvt. Ltd.
import * as XLSX from 'xlsx';
import { autoWidth, dateStr, fyStr, num, txt, yes } from './excel';

export interface SheetRow {
  rowNo: number;
  label: string[];        // what the preview table shows
  body: any;              // ready to send to the backend
  errors: string[];
  status: 'ready' | 'error' | 'saving' | 'saved' | 'failed';
  message: string;
}

const TYPES = ['ROAD', 'BUILDING', 'IRRIGATION', 'BRIDGE'];
const STATUSES = ['active', 'submitted', 'won', 'lost', 'cancelled', 'archived'];
const today = () => new Date().toISOString().slice(0, 10);
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
async function readBook(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb;
}
function rowsOf(wb: XLSX.WorkBook, name: string): any[] {
  const ws = wb.Sheets[name] ?? wb.Sheets[wb.SheetNames[0]];
  return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
}
function needCols(rows: any[], cols: string[]) {
  if (!rows.length) throw new Error('The sheet has no rows.');
  const missing = cols.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`Column(s) not found: ${missing.join(', ')}. Download the template and keep the column names.`);
}
const finish = (r: SheetRow): SheetRow => ({ ...r, status: r.errors.length ? 'error' : 'ready', message: r.errors.join('; ') });

// =================================================================== COMPANIES
export const COMPANY_COLS = ['Company Name', 'PAN / VAT No.', 'License Class', 'License Expiry', 'Address'];

export function exportCompanies(companies: any[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([COMPANY_COLS, ...companies.map((c) => [
    c.name, c.panVat ?? '', c.licenseClass ?? '', c.licenseExpiry ? String(c.licenseExpiry).slice(0, 10) : '', c.address ?? '',
  ])], COMPANY_COLS), 'Companies');
  XLSX.writeFile(wb, `ProcureNepal_Companies_${today()}.xlsx`);
}

export function companiesTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([COMPANY_COLS,
    ['Cuidado Construction Pvt. Ltd.', '601234567', 'A', '2084/03/31', 'Baneshwor, Kathmandu'],
    ['Cuidado–Sharma Nirman Sewa', '609876543', 'B', '2027-07-15', 'Hetauda, Makwanpur'],
  ], COMPANY_COLS), 'Companies');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — Company import guide',
    'Company Name is required. A company whose name is already saved is skipped.',
    'License Class: A, B, C or D.',
    'License Expiry: AD as YYYY-MM-DD (2027-07-15) or BS as YYYY/MM/DD (2084/03/31 — years 2040 and later are read as BS).',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_Companies_Template.xlsx');
}

const slugOf = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';

export async function readCompaniesFile(file: File, existing: any[]): Promise<SheetRow[]> {
  const rows = rowsOf(await readBook(file), 'Companies');
  needCols(rows, ['Company Name']);
  const names = new Set(existing.map((c) => String(c.name).trim().toLowerCase()));
  const slugs = new Set(existing.map((c) => c.slug));
  const out: SheetRow[] = [];
  rows.forEach((r, i) => {
    if (COMPANY_COLS.every((c) => txt(r[c]) === '')) return;
    const errors: string[] = [];
    const name = txt(r['Company Name']);
    if (!name) errors.push('Company Name missing');
    let slug = slugOf(name);
    if (name && names.has(name.toLowerCase())) errors.push('Already saved — skipped');
    else if (slugs.has(slug)) slug = `${slug}-${i + 2}`;
    const cls = txt(r['License Class']).toUpperCase().replace(/^CLASS\s*/, '');
    if (cls && !['A', 'B', 'C', 'D'].includes(cls)) errors.push('License Class must be A, B, C or D');
    const exp = dateStr(r['License Expiry']);
    if (exp === null) errors.push('License Expiry must be YYYY-MM-DD (AD) or YYYY/MM/DD (BS)');
    const body: any = { name, slug };
    if (txt(r['PAN / VAT No.'])) body.panVat = txt(r['PAN / VAT No.']);
    if (cls) body.licenseClass = cls;
    if (exp) body.licenseExpiry = exp;
    if (txt(r['Address'])) body.address = txt(r['Address']);
    if (name) { names.add(name.toLowerCase()); slugs.add(slug); }
    out.push(finish({ rowNo: i + 2, label: [name, cls || '—', exp || '—'], body, errors, status: 'ready', message: '' }));
  });
  return out;
}

// =================================================================== ANNUAL TURNOVER (one company)
export const TURNOVER_COLS = ['Fiscal Year', 'Turnover (excl. VAT)', 'Source'];

export function exportTurnover(companyName: string, rows: { fiscalYear: string; amount: any; source?: string }[]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([TURNOVER_COLS, ...rows.map((r) => [r.fiscalYear, Number(r.amount), r.source ?? 'audited'])], TURNOVER_COLS), 'Annual Turnover');
  XLSX.writeFile(wb, `ProcureNepal_Turnover_${companyName.replace(/[^A-Za-z0-9]+/g, '_')}_${today()}.xlsx`);
}

export function turnoverTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([TURNOVER_COLS,
    ['2081/82', 300000000, 'audited'], ['2080/81', 250000000, 'audited'], ['2079/80', 200000000, 'audited'],
  ], TURNOVER_COLS), 'Annual Turnover');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — Annual turnover import guide',
    'One row per fiscal year, e.g. 2081/82. Amounts: taxable amount only (excluding VAT), in NPR.',
    'Source: audited or provisional. Use the audited financial statements where available.',
    'Importing fills the Turnover table on screen — check it, then click Save Turnover.',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_Turnover_Template.xlsx');
}

export async function readTurnoverFile(file: File): Promise<{ rows: { fiscalYear: string; amount: number; source: string }[]; errors: string[] }> {
  const raw = rowsOf(await readBook(file), 'Annual Turnover');
  needCols(raw, ['Fiscal Year', 'Turnover (excl. VAT)']);
  const rows: { fiscalYear: string; amount: number; source: string }[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (!txt(r['Fiscal Year']) && !txt(r['Turnover (excl. VAT)'])) return;
    const fy = fyStr(r['Fiscal Year']);
    const amt = num(r['Turnover (excl. VAT)']);
    const src = txt(r['Source']).toLowerCase() || 'audited';
    if (!fy) { errors.push(`Row ${i + 2}: Fiscal Year must look like 2081/82`); return; }
    if (amt === null || isNaN(amt) || amt < 0) { errors.push(`Row ${i + 2}: Turnover must be a number ≥ 0`); return; }
    if (!['audited', 'provisional'].includes(src)) { errors.push(`Row ${i + 2}: Source must be audited or provisional`); return; }
    if (seen.has(fy)) { errors.push(`Row ${i + 2}: ${fy} appears twice`); return; }
    seen.add(fy);
    rows.push({ fiscalYear: fy, amount: amt, source: src });
  });
  return { rows, errors };
}

// =================================================================== TENDERS
export const TENDER_COLS = [
  'Ref', 'IFB No', 'Project Title', 'Procuring Entity', 'Project Type', 'Publication Date', 'Bid Deadline',
  'Cost Estimate (excl. VAT)', 'Contract Period (months)', 'Required Turnover (excl. VAT)',
  'Required Bid Capacity (excl. VAT)', 'Required Similar Contract (excl. VAT)', 'Similar Contracts (count)',
  'Similar Project Types', 'Complex Works', 'Status', 'Notes',
];
export const TENDER_KA_COLS = ['Ref', 'Item Name', 'Unit', 'Quantity'];

const d10 = (v: any) => (v ? String(v).slice(0, 10) : '');
const n0 = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v));

export function exportTenders(tenders: any[]) {
  const t: any[][] = [TENDER_COLS];
  const k: any[][] = [TENDER_KA_COLS];
  tenders.forEach((x, i) => {
    const ref = i + 1;
    t.push([ref, x.ifbNumber, x.projectTitle, x.procuringEntity ?? '', x.projectType ?? '', d10(x.publicationDate), d10(x.deadlineDate),
      n0(x.boqAmount), x.contractPeriodMonths ?? '', n0(x.reqTurnover), n0(x.reqBidCapacity), n0(x.reqSimilarValue),
      x.reqSimilarCount ?? '', (x.reqProjectTypes ?? []).join(', '), x.isComplexWork ? 'Yes' : 'No', x.status ?? 'active', x.notes ?? '']);
    for (const a of x.keyActivityReqs ?? []) k.push([ref, a.name, a.unit, Number(a.quantity)]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(t, TENDER_COLS), 'Tenders');
  XLSX.utils.book_append_sheet(wb, sheet(k, TENDER_KA_COLS), 'KeyActivities');
  XLSX.writeFile(wb, `ProcureNepal_Tenders_${today()}.xlsx`);
}

export function tendersTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([TENDER_COLS,
    [1, 'BM/NCB/W/2083-84/02', 'Construction of Cuidado Picnic Park', 'Bagmati Municipality', 'BUILDING', '2083/07/15', '2083/08/15',
      552500000, 24, 630000000, 550000000, 160000000, 1, 'BUILDING', 'No', 'active', 'Copied from the IFB'],
    [2, 'DOR/NCB/2083-84/07', 'Upgrading of Cuidado Feeder Road', 'Department of Roads', 'ROAD', '2026-11-01', '2026-12-01',
      900000000, 24, '', '', '', '', 'ROAD', 'No', 'active', 'Blank requirements are calculated'],
  ], TENDER_COLS), 'Tenders');
  XLSX.utils.book_append_sheet(wb, sheet([TENDER_KA_COLS,
    [1, 'M25 Concrete', 'm3', 1886], [1, 'Reinforcement Works', 'kg', 239893], [2, 'Asphalt concrete', 'm3', 1200],
  ], TENDER_KA_COLS), 'KeyActivities');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — Tender import guide',
    'Sheet "Tenders": one row per tender. Required: IFB No, Project Title, Bid Deadline. A tender whose IFB No is already saved is skipped.',
    'Dates: AD as YYYY-MM-DD or BS as YYYY/MM/DD (years 2040 and later are read as BS).',
    'Project Type: ROAD, BUILDING, IRRIGATION or BRIDGE. Similar Project Types: comma separated, e.g. ROAD, BRIDGE.',
    'All amounts: taxable amount only (excluding VAT), in NPR. Leave a requirement blank to let ProcureNepal calculate it from the estimate.',
    'Complex Works: Yes or No. Status: active, submitted, won, lost, cancelled or archived.',
    'Sheet "KeyActivities": minimum quantity in ONE fiscal year. Ref must match the Ref of the tender.',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_Tenders_Template.xlsx');
}

export async function readTendersFile(file: File, existing: any[]): Promise<SheetRow[]> {
  const wb = await readBook(file);
  const rows = rowsOf(wb, 'Tenders');
  needCols(rows, ['IFB No', 'Project Title', 'Bid Deadline']);
  const kaRows = wb.Sheets['KeyActivities'] ? XLSX.utils.sheet_to_json<any>(wb.Sheets['KeyActivities'], { defval: '' }) : [];
  const kaByRef = new Map<string, any[]>();
  const kaErr = new Map<string, string[]>();
  kaRows.forEach((a, i) => {
    const ref = txt(a['Ref']);
    if (!ref && !txt(a['Item Name'])) return;
    const q = num(a['Quantity']);
    const e: string[] = [];
    if (!txt(a['Item Name'])) e.push('Item Name missing');
    if (!txt(a['Unit'])) e.push('Unit missing');
    if (q === null || isNaN(q) || q <= 0) e.push('Quantity must be above 0');
    if (e.length) { kaErr.set(ref, [...(kaErr.get(ref) ?? []), `KeyActivities row ${i + 2}: ${e.join(', ')}`]); return; }
    kaByRef.set(ref, [...(kaByRef.get(ref) ?? []), { name: txt(a['Item Name']), unit: txt(a['Unit']), quantity: q }]);
  });
  const ifbs = new Set(existing.map((t) => String(t.ifbNumber).trim().toLowerCase()));
  const out: SheetRow[] = [];
  rows.forEach((r, i) => {
    if (TENDER_COLS.every((c) => txt(r[c]) === '')) return;
    const errors: string[] = [];
    const ref = txt(r['Ref']) || String(i + 1);
    const ifb = txt(r['IFB No']);
    const title = txt(r['Project Title']);
    if (!ifb) errors.push('IFB No missing');
    else if (ifbs.has(ifb.toLowerCase())) errors.push('Already saved (same IFB No) — skipped');
    if (!title) errors.push('Project Title missing');
    const pub = dateStr(r['Publication Date']);
    const dl = dateStr(r['Bid Deadline']);
    if (pub === null) errors.push('Publication Date must be YYYY-MM-DD (AD) or YYYY/MM/DD (BS)');
    if (!dl) errors.push('Bid Deadline missing or not a valid date');
    if (pub && dl && pub > dl) errors.push('Publication Date is after the Bid Deadline');
    const type = txt(r['Project Type']).toUpperCase();
    if (type && !TYPES.includes(type)) errors.push('Project Type must be ROAD, BUILDING, IRRIGATION or BRIDGE');
    const simTypes = txt(r['Similar Project Types']).toUpperCase().split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);
    if (simTypes.some((x) => !TYPES.includes(x))) errors.push('Similar Project Types: use ROAD, BUILDING, IRRIGATION, BRIDGE');
    const status = txt(r['Status']).toLowerCase() || 'active';
    if (!STATUSES.includes(status)) errors.push(`Status must be one of ${STATUSES.join(', ')}`);
    const body: any = {
      ifbNumber: ifb, projectTitle: title, deadlineDate: dl, status,
      isComplexWork: yes(r['Complex Works']), reqProjectTypes: simTypes,
      keyActivityReqs: kaByRef.get(ref) ?? [],
    };
    const numbers: [string, string, boolean][] = [
      ['Cost Estimate (excl. VAT)', 'boqAmount', false], ['Contract Period (months)', 'contractPeriodMonths', true],
      ['Required Turnover (excl. VAT)', 'reqTurnover', false], ['Required Bid Capacity (excl. VAT)', 'reqBidCapacity', false],
      ['Required Similar Contract (excl. VAT)', 'reqSimilarValue', false], ['Similar Contracts (count)', 'reqSimilarCount', true],
    ];
    for (const [col, key, int] of numbers) {
      const v = num(r[col]);
      if (v === null) continue;
      if (isNaN(v) || v < 0) { errors.push(`${col} must be a number ≥ 0`); continue; }
      body[key] = int ? Math.round(v) : v;
    }
    if (body.contractPeriodMonths !== undefined && body.contractPeriodMonths < 1) errors.push('Contract Period must be at least 1 month');
    if (body.reqSimilarCount !== undefined && body.reqSimilarCount < 1) errors.push('Similar Contracts (count) must be at least 1');
    if (txt(r['Procuring Entity'])) body.procuringEntity = txt(r['Procuring Entity']);
    if (type) body.projectType = type;
    if (pub) body.publicationDate = pub;
    if (txt(r['Notes'])) body.notes = txt(r['Notes']);
    errors.push(...(kaErr.get(ref) ?? []));
    if (ifb) ifbs.add(ifb.toLowerCase());
    out.push(finish({ rowNo: i + 2, label: [ifb, title, dl || '—', String(body.keyActivityReqs.length)], body, errors, status: 'ready', message: '' }));
  });
  return out;
}
