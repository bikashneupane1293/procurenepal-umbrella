// Project Management — statuses, BOQ rules, project alerts. © Cuidado Technology Pvt. Ltd.

export const PROJECT_STATUSES = ['PLANNED', 'MOBILIZING', 'ONGOING', 'SUSPENDED', 'COMPLETED', 'HANDED_OVER', 'CLOSED', 'TERMINATED'] as const;
/** Projects still being executed */
export const ACTIVE_PROJECT = ['PLANNED', 'MOBILIZING', 'ONGOING', 'SUSPENDED'];
export const WON_BID = ['AWARDED', 'CONTRACT_SIGNED'];
export const CAN_DELETE_PROJECT = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];
export const MAX_BOQ_ITEMS = 5000;

const DAY = 86_400_000;
const n = (v: any) => (v === null || v === undefined ? null : Number(v));

/** start + months (same day of month; clamps to the month's last day) */
export function addMonths(start: Date, months: number): Date {
  const d = new Date(start);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Amount of one BOQ line, rounded to paisa; null when quantity or rate is missing. */
export function lineAmount(quantity: number | null, rate: number | null): number | null {
  if (quantity === null || rate === null) return null;
  // exact: quantity has ≤ 3 decimals and rate ≤ 2 (as stored), so work in whole numbers (1e-5 units)
  const units = Math.round(quantity * 1000) * Math.round(rate * 100);
  return Math.round(units / 1000) / 100;
}

export interface ProjectAlert { code: 'OVERDUE' | 'DUE_SOON' | 'GUARANTEE_SHORT' | 'BOQ_MISMATCH' | 'NO_BOQ' | 'GUARANTEE_EXPIRING'; message: string }

/**
 * Time, BOQ and guarantee checks for one project. Guidance only — contract clauses decide.
 * guarantees: the project's open guarantees.
 */
export function projectAlerts(p: any, boqTotal: number, boqCount: number, guarantees: any[], today: Date, windowDays = 30): ProjectAlert[] {
  const out: ProjectAlert[] = [];
  const active = ACTIVE_PROJECT.includes(p.status);
  const due = p.revisedCompletionDate ?? p.intendedCompletionDate;
  if (active && due) {
    const left = Math.ceil((new Date(due).getTime() - today.getTime()) / DAY);
    if (left < 0) out.push({ code: 'OVERDUE', message: `Completion date passed ${-left} day(s) ago — apply for extension of time or record completion` });
    else if (left <= windowDays) out.push({ code: 'DUE_SOON', message: `Completion due in ${left} day(s)` });
  }
  const contract = n(p.contractAmount);
  if (boqCount && contract) {
    const diff = boqTotal - contract;
    if (Math.abs(diff) > Math.max(1, contract * 0.001)) {
      out.push({ code: 'BOQ_MISMATCH', message: `BOQ total differs from the contract amount by Rs ${Math.round(diff).toLocaleString('en-IN')} — check the BOQ (VAT, provisional sums, contingencies)` });
    }
  }
  if (active && !boqCount) out.push({ code: 'NO_BOQ', message: 'No BOQ yet — upload it from Excel' });
  if (active && due) {
    const perf = guarantees.filter((g) => g.type === 'PERFORMANCE' && ['REQUESTED', 'ACTIVE'].includes(g.status));
    for (const g of perf) {
      if (g.expiryDate && new Date(g.expiryDate) < new Date(due)) {
        out.push({ code: 'GUARANTEE_SHORT', message: `Performance guarantee ${g.guaranteeNo ?? ''} expires before the completion date — it usually must cover completion and the defect liability period; check the contract` });
      }
    }
  }
  for (const g of guarantees) {
    if (!g.expiryDate || !['REQUESTED', 'ACTIVE'].includes(g.status)) continue;
    const left = Math.ceil((new Date(g.expiryDate).getTime() - today.getTime()) / DAY);
    if (left <= windowDays) out.push({ code: 'GUARANTEE_EXPIRING', message: `${g.type === 'ADVANCE_PAYMENT' ? 'Advance payment' : g.type === 'PERFORMANCE' ? 'Performance' : 'A'} guarantee ${g.guaranteeNo ?? ''} ${left < 0 ? 'expired ' + -left + ' day(s) ago' : 'expires in ' + left + ' day(s)'}` });
  }
  return out;
}
