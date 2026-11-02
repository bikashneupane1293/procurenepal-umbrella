import * as XLSX from 'xlsx';

// ---------- Column names used in the Excel file (export, template and import) ----------
export const CERT_COLS = [
  'Ref', 'Company Name', 'Project Name', 'Employer', 'Certificate No',
  'Project Type', 'Fiscal Year', 'Start Date', 'Completion Date', 'Completion Status',
  'Contract Amount (excl. VAT)', 'Final Amount (excl. VAT)', 'Price Adjustment (excl. VAT)',
  'JV Share %', 'JV Name', 'Document Checked',
];
export const ACT_COLS = ['Ref', 'Item Name', 'Unit', 'Fiscal Year', 'Quantity'];

const TYPES = ['ROAD', 'BUILDING', 'IRRIGATION', 'BRIDGE'];
const STATUS: Record<string, string> = {
  'completed': 'completed', 'complete': 'completed',
  'substantially completed': 'substantially_completed', 'substantially_completed': 'substantially_completed',
  'in progress': 'in_progress', 'in_progress': 'in_progress', 'ongoing': 'in_progress',
};
const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed', substantially_completed: 'Substantially completed', in_progress: 'In progress',
};

export interface ImportRow {
  rowNo: number;           // Excel row number (for messages)
  ref: string;
  companyName: string;
  companyId: string;
  body: any;               // ready to POST to the backend
  errors: string[];
  status: 'ready' | 'error' | 'saving' | 'saved' | 'failed';
  message: string;
}

// ---------- Helpers ----------
function txt(v: any): string {
  return v === null || v === undefined ? '' : String(v).trim();
}
function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isNaN(n) ? NaN : n;
}
function pad(n: number) { return String(n).padStart(2, '0'); }
function validYmd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
// Accepts Excel dates, "2025-06-30" or "30/06/2025". Returns "YYYY-MM-DD", "" (empty) or null (invalid)
function dateStr(v: any): string | null {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (m) return validYmd(+m[3], +m[2], +m[1]);
  return null;
}
// "2081/82", "2081-82", "2081/2082" -> "2081/82"
function fyStr(v: any): string | null {
  const s = txt(v);
  if (!s) return '';
  const m = s.match(/^(20\d{2})\s*[\/-]\s*(\d{2,4})$/);
  if (!m) return null;
  return `${m[1]}/${m[2].slice(-2)}`;
}
function yes(v: any): boolean {
  return ['yes', 'y', 'true', '1', 'checked', 'verified'].includes(txt(v).toLowerCase());
}
function autoWidth(ws: XLSX.WorkSheet, cols: string[]) {
  ws['!cols'] = cols.map((c) => ({ wch: Math.max(12, c.length + 2) }));
}

// ---------- EXPORT (also used for the blank template) ----------
export function exportCertificates(certs: any[], companyName: (id: string) => string, fileName: string) {
  const certRows: any[][] = [CERT_COLS];
  const actRows: any[][] = [ACT_COLS];

  certs.forEach((c, i) => {
    const ref = i + 1;
    certRows.push([
      ref, companyName(c.companyId), c.projectName, c.employerName ?? '', c.certificateId ?? '',
      c.projectType, c.fiscalYear,
      c.startDate ? String(c.startDate).slice(0, 10) : '',
      c.completionDate ? String(c.completionDate).slice(0, 10) : '',
      STATUS_LABEL[c.completionStatus] ?? c.completionStatus ?? '',
      c.contractAmount != null ? Number(c.contractAmount) : '',
      c.finalAmount != null ? Number(c.finalAmount) : '',
      c.priceAdjustment != null ? Number(c.priceAdjustment) : '',
      c.jvShare != null ? Number(c.jvShare) : 100,
      c.jvName ?? '',
      c.verificationStatus === 'verified' ? 'Yes' : 'No',
    ]);
    (c.keyActivities ?? []).forEach((a: any) => {
      actRows.push([ref, a.name, a.unit, a.fiscalYear, Number(a.quantity)]);
    });
  });

  writeBook(certRows, actRows, fileName);
}

export function downloadTemplate() {
  const certRows: any[][] = [
    CERT_COLS,
    [1, 'Cuidado Construction Pvt. Ltd.', 'Upgrading of Dhulikhel–Sindhuli Road', 'Department of Roads', 'DOR-2081-045',
      'ROAD', '2081/82', '2023-01-10', '2025-06-30', 'Completed', 45000000, 47250000, 0, 60, 'Cuidado–Sharma JV', 'No'],
  ];
  const actRows: any[][] = [
    ACT_COLS,
    [1, 'Asphalt concrete', 'm³', '2081/82', 5200],
    [1, 'Gabion wall', 'm³', '2080/81', 1850],
  ];
  writeBook(certRows, actRows, 'ProcureNepal_Certificates_Template.xlsx');
}

function writeBook(certRows: any[][], actRows: any[][], fileName: string) {
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(certRows);
  autoWidth(ws1, CERT_COLS);
  const ws2 = XLSX.utils.aoa_to_sheet(actRows);
  autoWidth(ws2, ACT_COLS);
  const help = XLSX.utils.aoa_to_sheet([
    ['ProcureNepal — Certificate import guide'],
    [''],
    ['Sheet "Certificates": one row per certificate. Columns marked * in the app are required:'],
    ['  Company Name, Project Name, Project Type, Fiscal Year, Contract Amount.'],
    ['Company Name must match a company already added in ProcureNepal (Companies page).'],
    ['Project Type: ROAD, BUILDING, IRRIGATION or BRIDGE.'],
    ['Fiscal Year: Nepali fiscal year, e.g. 2081/82.'],
    ['Dates: AD format YYYY-MM-DD, e.g. 2025-06-30.'],
    ['Completion Status: Completed, Substantially completed or In progress.'],
    ['All amounts: taxable amount only (excluding VAT), in NPR, numbers only.'],
    ['JV Share %: 100 if your company did the work alone. If below 100, JV Name is required.'],
    ['Document Checked: Yes if checked against the employer\'s original, otherwise No.'],
    [''],
    ['Sheet "KeyActivities": one row per item per fiscal year.'],
    ['  Ref must match the Ref of the certificate in the "Certificates" sheet.'],
    [''],
    ['© Cuidado Technology Pvt. Ltd. · ProcureNepal'],
  ]);
  help['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Certificates');
  XLSX.utils.book_append_sheet(wb, ws2, 'KeyActivities');
  XLSX.utils.book_append_sheet(wb, help, 'Instructions');
  XLSX.writeFile(wb, fileName);
}

// ---------- IMPORT: read the file and check every row ----------
export async function readImportFile(file: File, companies: any[], existing: any[] = []): Promise<ImportRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });

  const certSheet = wb.Sheets['Certificates'] ?? wb.Sheets[wb.SheetNames[0]];
  if (!certSheet) throw new Error('No "Certificates" sheet found in this file.');
  const certs: any[] = XLSX.utils.sheet_to_json(certSheet, { defval: '' });
  const acts: any[] = wb.Sheets['KeyActivities'] ? XLSX.utils.sheet_to_json(wb.Sheets['KeyActivities'], { defval: '' }) : [];

  if (certs.length === 0) throw new Error('The "Certificates" sheet has no rows.');
  const missing = ['Company Name', 'Project Name', 'Contract Amount (excl. VAT)'].filter((c) => !(c in certs[0]));
  if (missing.length) {
    throw new Error(`Column(s) not found: ${missing.join(', ')}. Please use "Download Template" and keep the column names unchanged.`);
  }

  const byName = new Map(companies.map((c) => [String(c.name).trim().toLowerCase(), c]));
  // Certificates already saved: same company + project name + fiscal year = duplicate
  const key = (companyId: string, project: string, fy: string) => `${companyId}|${project.trim().toLowerCase()}|${fy}`;
  const already = new Set(existing.map((c) => key(c.companyId, String(c.projectName ?? ''), c.fiscalYear)));
  const existingNos = new Set(existing.map((c) => String(c.certificateId ?? '').toLowerCase()).filter((x) => x));

  // Group key activity rows by Ref
  const actByRef = new Map<string, any[]>();
  const actErrors = new Map<string, string[]>();
  acts.forEach((a, i) => {
    const ref = txt(a['Ref']);
    if (!ref && !txt(a['Item Name'])) return; // empty line
    const errs: string[] = [];
    const name = txt(a['Item Name']);
    const unit = txt(a['Unit']);
    const fy = fyStr(a['Fiscal Year']);
    const qty = num(a['Quantity']);
    if (!name) errs.push('Item Name missing');
    if (!unit) errs.push('Unit missing');
    if (!fy) errs.push('Fiscal Year must look like 2081/82');
    if (qty === null || isNaN(qty as number) || (qty as number) < 0) errs.push('Quantity must be a number ≥ 0');
    if (errs.length) {
      actErrors.set(ref, [...(actErrors.get(ref) ?? []), `KeyActivities row ${i + 2}: ${errs.join(', ')}`]);
      return;
    }
    actByRef.set(ref, [...(actByRef.get(ref) ?? []), { name, unit, fiscalYear: fy, quantity: qty }]);
  });

  const rows: ImportRow[] = [];
  certs.forEach((r, i) => {
    const rowNo = i + 2;
    if (CERT_COLS.every((c) => txt(r[c]) === '')) return; // empty line
    const errors: string[] = [];
    const ref = txt(r['Ref']) || String(i + 1);

    const companyName = txt(r['Company Name']);
    const company = byName.get(companyName.toLowerCase());
    if (!companyName) errors.push('Company Name missing');
    else if (!company) errors.push(`Company "${companyName}" not found — add it on the Companies page first`);

    const projectName = txt(r['Project Name']);
    if (!projectName) errors.push('Project Name missing');

    const type = txt(r['Project Type']).toUpperCase();
    if (!TYPES.includes(type)) errors.push('Project Type must be ROAD, BUILDING, IRRIGATION or BRIDGE');

    const fy = fyStr(r['Fiscal Year']);
    if (!fy) errors.push('Fiscal Year must look like 2081/82');

    const start = dateStr(r['Start Date']);
    const end = dateStr(r['Completion Date']);
    if (start === null) errors.push('Start Date must be YYYY-MM-DD');
    if (end === null) errors.push('Completion Date must be YYYY-MM-DD');
    if (start && end && end < start) errors.push('Completion Date is before Start Date');

    const statusTxt = txt(r['Completion Status']).toLowerCase();
    const status = statusTxt ? STATUS[statusTxt] : 'completed';
    if (!status) errors.push('Completion Status must be Completed, Substantially completed or In progress');

    const contract = num(r['Contract Amount (excl. VAT)']);
    const final = num(r['Final Amount (excl. VAT)']);
    const pa = num(r['Price Adjustment (excl. VAT)']);
    if (contract === null || isNaN(contract) || contract < 0) errors.push('Contract Amount must be a number ≥ 0');
    if (final !== null && (isNaN(final) || final < 0)) errors.push('Final Amount must be a number ≥ 0');
    if (pa !== null && isNaN(pa)) errors.push('Price Adjustment must be a number');

    const jv = num(r['JV Share %']);
    const jvShare = jv === null ? 100 : jv;
    if (isNaN(jvShare) || jvShare < 0 || jvShare > 100) errors.push('JV Share % must be between 0 and 100');
    const jvName = txt(r['JV Name']);
    if (jvShare < 100 && !jvName) errors.push('JV Name is required when JV Share is below 100');

    errors.push(...(actErrors.get(ref) ?? []));

    const certNoTxt = txt(r['Certificate No']);
    if (company && projectName && fy && already.has(key(company.id, projectName, fy))) {
      errors.push('Already saved in ProcureNepal (same company, project and fiscal year) — skipped');
    } else if (certNoTxt && existingNos.has(certNoTxt.toLowerCase())) {
      errors.push(`Certificate No "${certNoTxt}" is already saved in ProcureNepal — skipped`);
    }

    const body: any = {
      projectName,
      contractAmount: contract,
      fiscalYear: fy,
      projectType: type,
      completionStatus: status,
      verificationStatus: yes(r['Document Checked']) ? 'verified' : 'unverified',
      jvShare,
    };
    const employer = txt(r['Employer']);
    const certNo = txt(r['Certificate No']);
    if (employer) body.employerName = employer;
    if (certNo) body.certificateId = certNo;
    if (final !== null && !isNaN(final)) body.finalAmount = final;
    if (pa !== null && !isNaN(pa)) body.priceAdjustment = pa;
    if (jvShare < 100 && jvName) body.jvName = jvName;
    if (start) body.startDate = start;
    if (end) body.completionDate = end;
    const ka = actByRef.get(ref) ?? [];
    if (ka.length) {
      body.keyActivities = ka;
      body.activities = [...new Set(ka.map((a) => a.name))];
    }

    rows.push({
      rowNo, ref, companyName, companyId: company?.id ?? '', body, errors,
      status: errors.length ? 'error' : 'ready',
      message: errors.join('; '),
    });
  });

  return rows;
}
