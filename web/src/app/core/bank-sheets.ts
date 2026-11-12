// Excel import / export / templates for the Bank System (banks + bank guarantees).
// Loaded only when a button is clicked. © Cuidado Technology Pvt. Ltd.
import * as XLSX from 'xlsx';
import { autoWidth, dateStr, num, txt } from './excel';
import type { SheetRow } from './sheets';

export const GUARANTEE_TYPE_LIST = ['BID_SECURITY', 'PERFORMANCE', 'ADVANCE_PAYMENT', 'RETENTION', 'CUSTOMS', 'OTHER'];
export const GUARANTEE_STATUS_LIST = ['REQUESTED', 'ACTIVE', 'RELEASED', 'EXPIRED', 'CLAIMED', 'CANCELLED'];
const BASES = ['QUARTER', 'YEAR', 'FLAT'];
const ACCOUNT_TYPES = ['CURRENT', 'SAVINGS', 'OVERDRAFT', 'FIXED', 'OTHER'];

const today = () => new Date().toISOString().slice(0, 10);
const d10 = (v: any) => (v ? String(v).slice(0, 10) : '');
const n0 = (v: any) => (v === null || v === undefined || v === '' ? '' : Number(v));
const key = (v: any) => txt(v).toUpperCase().replace(/[\s-]+/g, '_');
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
async function rowsOf(file: File, name: string): Promise<any[]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ws = wb.Sheets[name] ?? wb.Sheets[wb.SheetNames[0]];
  return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
}
function needCols(rows: any[], cols: string[]) {
  if (!rows.length) throw new Error('The sheet has no rows.');
  const missing = cols.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`Column(s) not found: ${missing.join(', ')}. Download the template and keep the column names.`);
}
const finish = (r: SheetRow): SheetRow => ({ ...r, status: r.errors.length ? 'error' : 'ready', message: r.errors.join('; ') });

// =================================================================== BANKS
export const BANK_COLS = [
  'Company', 'Bank Name', 'Branch', 'Account No', 'Account Type', 'Guarantee Limit (NPR)',
  'Default Margin %', 'Default Commission %', 'Commission Basis', 'Contact Person', 'Phone', 'Email', 'Notes',
];

export function exportBanks(banks: any[]) {
  const cols = [...BANK_COLS, 'Used by Open Guarantees', 'Available'];
  const rows = banks.map((b) => [
    b.company?.name ?? '', b.name, b.branch ?? '', b.accountNumber ?? '', b.accountType ?? '', n0(b.bgLimit),
    n0(b.defaultMarginPct), n0(b.defaultCommissionPct), b.commissionBasis ?? '', b.contactPerson ?? '', b.phone ?? '', b.email ?? '', b.notes ?? '',
    n0(b.used), n0(b.available),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([cols, ...rows], cols), 'Banks');
  XLSX.writeFile(wb, `ProcureNepal_Banks_${today()}.xlsx`);
}

export function banksTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([BANK_COLS,
    ['Cuidado Construction Pvt. Ltd.', 'Nabil Bank Limited', 'Kamaladi', '01001017501234', 'CURRENT', 50000000, 10, 0.5, 'QUARTER', 'Ram Shrestha', '01-4211111', 'kamaladi@example.com', 'Non-fund limit renewed 2083/04'],
    ['Cuidado Construction Pvt. Ltd.', 'Global IME Bank Limited', 'Hetauda', '', 'OVERDRAFT', 20000000, 15, 1.5, 'YEAR', '', '', '', ''],
  ], BANK_COLS), 'Banks');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — Bank import guide',
    'Company and Bank Name are required. The company must already exist (same spelling). The same bank + branch for the same company is skipped.',
    `Account Type: ${ACCOUNT_TYPES.join(', ')}. Commission Basis: ${BASES.join(', ')} (rate per quarter, per year, or once).`,
    'Guarantee Limit = the non-fund (bank guarantee) limit sanctioned by the bank. ProcureNepal shows how much of it open guarantees use.',
    'Margin % and Commission % are your bank\'s usual rates; they are filled into new guarantees and can be changed on each one. Banks differ — these are not fixed rules.',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_Banks_Template.xlsx');
}

export async function readBanksFile(file: File, companies: any[], existing: any[]): Promise<SheetRow[]> {
  const rows = await rowsOf(file, 'Banks');
  needCols(rows, ['Company', 'Bank Name']);
  const cByName = new Map(companies.map((c) => [String(c.name).trim().toLowerCase(), c]));
  const have = new Set(existing.map((b) => `${b.companyId}|${String(b.name).trim().toLowerCase()}|${String(b.branch ?? '').trim().toLowerCase()}`));
  const out: SheetRow[] = [];
  rows.forEach((r, i) => {
    if (BANK_COLS.every((c) => txt(r[c]) === '')) return;
    const errors: string[] = [];
    const c = cByName.get(txt(r['Company']).toLowerCase());
    const name = txt(r['Bank Name']);
    if (!c) errors.push(`Company "${txt(r['Company'])}" not found`);
    if (!name) errors.push('Bank Name is required');
    const k = `${c?.id}|${name.toLowerCase()}|${txt(r['Branch']).toLowerCase()}`;
    if (c && name && have.has(k)) errors.push('This bank and branch is already in the company\'s list — skipped');
    const body: any = { companyId: c?.id, name };
    const acc = key(r['Account Type']);
    if (acc && !ACCOUNT_TYPES.includes(acc)) errors.push(`Account Type must be one of ${ACCOUNT_TYPES.join(', ')}`);
    else if (acc) body.accountType = acc;
    const basis = key(r['Commission Basis']);
    if (basis && !BASES.includes(basis)) errors.push(`Commission Basis must be one of ${BASES.join(', ')}`);
    else if (basis) body.commissionBasis = basis;
    for (const [col, f, max] of [['Guarantee Limit (NPR)', 'bgLimit', Infinity], ['Default Margin %', 'defaultMarginPct', 100], ['Default Commission %', 'defaultCommissionPct', 100]] as const) {
      const v = num(r[col]);
      if (v === null) continue;
      if (isNaN(v) || v < 0 || v > max) errors.push(`${col} must be a number from 0${max === Infinity ? '' : ' to ' + max}`);
      else body[f] = v;
    }
    for (const [col, f] of [['Branch', 'branch'], ['Account No', 'accountNumber'], ['Contact Person', 'contactPerson'], ['Phone', 'phone'], ['Email', 'email'], ['Notes', 'notes']] as const) {
      if (txt(r[col])) body[f] = txt(r[col]);
    }
    if (body.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) errors.push('Email is not valid');
    if (c && name) have.add(k);
    out.push(finish({ rowNo: i + 2, label: [txt(r['Company']), name, txt(r['Branch']), n0(body.bgLimit) === '' ? '—' : Number(body.bgLimit).toLocaleString('en-IN')], body, errors, status: 'ready', message: '' }));
  });
  return out;
}

// =================================================================== BANK GUARANTEES
export const GUARANTEE_COLS = [
  'Company', 'Bank Name', 'Branch', 'Type', 'Guarantee No', 'IFB No', 'Beneficiary', 'Purpose', 'Amount (NPR)',
  'Issue Date', 'Expiry Date', 'Claim Expiry Date', 'Margin %', 'Margin Amount', 'Commission %', 'Commission Basis',
  'Commission Amount', 'Status', 'Release Date', 'Release Ref', 'Notes',
];

export function exportGuarantees(list: any[]) {
  const cols = [...GUARANTEE_COLS, 'Days Left', 'Alerts'];
  const rows = list.map((g) => [
    g.company?.name ?? '', g.bankName, g.branch ?? '', g.type, g.guaranteeNo ?? '', g.tender?.ifbNumber ?? '', g.beneficiary ?? '', g.purpose ?? '',
    n0(g.amount), d10(g.issueDate), d10(g.expiryDate), d10(g.claimExpiryDate), n0(g.marginPct), n0(g.marginAmount), n0(g.commissionPct),
    g.commissionBasis ?? '', n0(g.commissionAmount), g.status, d10(g.releaseDate), g.releaseRef ?? '', g.notes ?? '',
    g.daysLeft ?? '', (g.alerts ?? []).map((a: any) => a.message).join(' | '),
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([cols, ...rows], cols), 'Guarantees');
  XLSX.writeFile(wb, `ProcureNepal_Bank_Guarantees_${today()}.xlsx`);
}

export function guaranteesTemplate() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([GUARANTEE_COLS,
    ['Cuidado Construction Pvt. Ltd.', 'Nabil Bank Limited', 'Kamaladi', 'PERFORMANCE', 'BG/KTM/2083/0456', 'DOR/NCB/2083-84/07', 'Division Road Office, Hetauda',
      'Performance security', 4750000, '2083/09/01', '2084/12/30', '2085/01/30', 10, '', 0.5, 'QUARTER', '', 'ACTIVE', '', '', ''],
    ['Cuidado Construction Pvt. Ltd.', 'Global IME Bank Limited', 'Hetauda', 'ADVANCE_PAYMENT', '', '', 'Bagmati Municipality', 'Mobilisation advance 10%',
      9000000, '', '', '', 15, '', 1.5, 'YEAR', '', 'REQUESTED', '', '', 'Applied on 2083/08/20'],
  ], GUARANTEE_COLS), 'Guarantees');
  XLSX.utils.book_append_sheet(wb, help([
    'ProcureNepal — Bank guarantee import guide',
    'Company, Bank Name, Type and Amount are required. The company must already exist. If the bank is in the company\'s bank list (same name), the guarantee is attached to it.',
    `Type: ${GUARANTEE_TYPE_LIST.join(', ')}. Status: ${GUARANTEE_STATUS_LIST.join(', ')} (blank = ACTIVE when a Guarantee No is given, otherwise REQUESTED).`,
    'IFB No (optional) links the guarantee to a tender. Bid and performance securities entered on a bid are created automatically — you do not need to import them.',
    'The same Guarantee No of the same bank is skipped. Margin / Commission Amount blank = calculated from the % (estimate only; banks differ).',
    'Dates: AD as YYYY-MM-DD or BS as YYYY/MM/DD (years 2040 and later are read as BS). Amounts in NPR.',
  ]), 'Instructions');
  XLSX.writeFile(wb, 'ProcureNepal_Bank_Guarantees_Template.xlsx');
}

export async function readGuaranteesFile(file: File, companies: any[], banks: any[], tenders: any[], existing: any[]): Promise<SheetRow[]> {
  const rows = await rowsOf(file, 'Guarantees');
  needCols(rows, ['Company', 'Bank Name', 'Type', 'Amount (NPR)']);
  const cByName = new Map(companies.map((c) => [String(c.name).trim().toLowerCase(), c]));
  const tByIfb = new Map(tenders.map((t) => [String(t.ifbNumber).trim().toLowerCase(), t]));
  const have = new Set(existing.filter((g) => g.guaranteeNo).map((g) => `${String(g.bankName).trim().toLowerCase()}|${g.guaranteeNo}`));
  const out: SheetRow[] = [];
  rows.forEach((r, i) => {
    if (GUARANTEE_COLS.every((c) => txt(r[c]) === '')) return;
    const errors: string[] = [];
    const c = cByName.get(txt(r['Company']).toLowerCase());
    if (!c) errors.push(`Company "${txt(r['Company'])}" not found`);
    const bankName = txt(r['Bank Name']);
    if (!bankName) errors.push('Bank Name is required');
    const type = key(r['Type']);
    if (!GUARANTEE_TYPE_LIST.includes(type)) errors.push(`Type must be one of ${GUARANTEE_TYPE_LIST.join(', ')}`);
    const amount = num(r['Amount (NPR)']);
    if (amount === null || isNaN(amount) || amount < 1) errors.push('Amount (NPR) must be a number above 0');
    const body: any = { companyId: c?.id, bankName, type, amount };
    const bank = c ? banks.find((b) => b.companyId === c.id && String(b.name).trim().toLowerCase() === bankName.toLowerCase()
      && (!txt(r['Branch']) || String(b.branch ?? '').trim().toLowerCase() === txt(r['Branch']).toLowerCase())) : null;
    if (bank) body.bankId = bank.id;
    const no = txt(r['Guarantee No']);
    if (no) {
      body.guaranteeNo = no;
      const k = `${bankName.toLowerCase()}|${no}`;
      if (have.has(k)) errors.push('This guarantee number of this bank is already recorded — skipped');
      have.add(k);
    }
    const ifb = txt(r['IFB No']);
    if (ifb) {
      const t = tByIfb.get(ifb.toLowerCase());
      if (!t) errors.push(`Tender "${ifb}" not found`);
      else body.tenderId = t.id;
    }
    const status = key(r['Status']);
    if (status && !GUARANTEE_STATUS_LIST.includes(status)) errors.push(`Status must be one of ${GUARANTEE_STATUS_LIST.join(', ')}`);
    else if (status) body.status = status;
    const basis = key(r['Commission Basis']);
    if (basis && !BASES.includes(basis)) errors.push(`Commission Basis must be one of ${BASES.join(', ')}`);
    else if (basis) body.commissionBasis = basis;
    for (const [col, f] of [['Issue Date', 'issueDate'], ['Expiry Date', 'expiryDate'], ['Claim Expiry Date', 'claimExpiryDate'], ['Release Date', 'releaseDate']] as const) {
      const v = dateStr(r[col]);
      if (v === null) errors.push(`${col} must be YYYY-MM-DD (AD) or YYYY/MM/DD (BS)`);
      else if (v) body[f] = v;
    }
    if (body.issueDate && body.expiryDate && body.expiryDate < body.issueDate) errors.push('Expiry Date is before Issue Date');
    for (const [col, f, max] of [['Margin %', 'marginPct', 100], ['Margin Amount', 'marginAmount', Infinity], ['Commission %', 'commissionPct', 100], ['Commission Amount', 'commissionAmount', Infinity]] as const) {
      const v = num(r[col]);
      if (v === null) continue;
      if (isNaN(v) || v < 0 || v > max) errors.push(`${col} must be a number from 0${max === Infinity ? '' : ' to ' + max}`);
      else body[f] = v;
    }
    for (const [col, f] of [['Branch', 'branch'], ['Beneficiary', 'beneficiary'], ['Purpose', 'purpose'], ['Release Ref', 'releaseRef'], ['Notes', 'notes']] as const) {
      if (txt(r[col])) body[f] = txt(r[col]);
    }
    out.push(finish({ rowNo: i + 2, label: [txt(r['Company']), bankName, type, no || '—', amount && !isNaN(amount) ? amount.toLocaleString('en-IN') : '—'], body, errors, status: 'ready', message: '' }));
  });
  return out;
}
