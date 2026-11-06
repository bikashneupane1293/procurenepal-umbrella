// Qualification report → Excel (lazy-loaded) — © Cuidado Technology Pvt. Ltd.
import * as XLSX from 'xlsx';
import { verdictText } from '../shared/qual-result';
import { showBoth } from './nepali-date';

const n = (v: any) => (v === null || v === undefined || v === '' ? '' : Math.round(Number(v) * 100) / 100);

/** results: engine results (single or JV), each with checks[] and warnings[] */
export function downloadQualificationReport(tender: any, results: any[], fileName?: string) {
  const wb = XLSX.utils.book_new();

  const info = [
    ['ProcureNepal — Qualification Report'],
    ['© Cuidado Technology Pvt. Ltd.'],
    [],
    ['IFB No.', tender.ifbNumber],
    ['Project', tender.projectTitle],
    ['Procuring Entity', tender.procuringEntity ?? ''],
    ['Deadline', showBoth(tender.deadlineDate)],
    ['Cost Estimate (NPR, excl. VAT)', n(tender.boqAmount)],
    ['Contract Period (months)', tender.contractPeriodMonths ?? ''],
    ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    [],
    ['This report is a guide calculated from the data entered and the default PPMO rules. The bid document always takes priority. Not legal advice.'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Tender');

  const summary = results.map((r) => ({
    Bidder: r.companyName ?? (r.partners ?? []).map((p: any) => `${p.companyName} ${p.share}%`).join(' + '),
    Result: verdictText(r.result),
    'Suggested JV role': r.suggestedJvRole ?? '',
    Summary: r.summary,
    'Failed checks': (r.checks ?? []).filter((c: any) => c.status === 'FAIL').length,
    Warnings: (r.warnings ?? []).length,
    'Pending document checks': r.certificatesPendingDocumentCheck ?? '',
    'Rule set': r.ruleSet?.id ?? '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');

  const checks: any[] = [];
  for (const r of results) {
    const who = r.companyName ?? (r.partners ?? []).map((p: any) => p.companyName).join(' + ');
    for (const c of r.checks ?? []) {
      checks.push({
        Bidder: who,
        Requirement: c.title,
        Result: c.status,
        Required: n(c.required),
        Actual: n(c.actual),
        Unit: c.unit,
        Reason: c.reason,
        'Uses unchecked certificate': c.usesUnverified ? 'Yes' : '',
      });
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(checks), 'Checks');

  const warnings: any[] = [];
  for (const r of results) {
    const who = r.companyName ?? (r.partners ?? []).map((p: any) => p.companyName).join(' + ');
    for (const w of r.warnings ?? []) warnings.push({ Bidder: who, Warning: w });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(warnings.length ? warnings : [{ Bidder: '', Warning: 'None' }]), 'Warnings');

  const safe = String(tender.ifbNumber ?? 'Tender').replace(/[^A-Za-z0-9]+/g, '_');
  XLSX.writeFile(wb, fileName ?? `ProcureNepal_Qualification_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
