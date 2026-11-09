// Bid Information — statuses, checklist and tender-status link. © Cuidado Technology Pvt. Ltd.

/** Post-bid pipeline (PPA 2063/2083 + e-GP): preparing → submitted → opened → evaluated → intention to award → awarded → contract signed */
export const BID_STATUSES = [
  'PREPARING', 'SUBMITTED', 'OPENED', 'EVALUATED', 'INTENTION_TO_AWARD',
  'AWARDED', 'CONTRACT_SIGNED', 'LOST', 'WITHDRAWN', 'CANCELLED',
] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const BID_DECISIONS = ['UNDECIDED', 'BID', 'NO_BID'] as const;
export const SECURITY_TYPES = ['BANK_GUARANTEE', 'CASH_DEPOSIT', 'INSURANCE_BOND', 'DECLARATION'] as const;

/** Statuses that mean the bid has been submitted and is still alive */
export const IN_PROGRESS: BidStatus[] = ['SUBMITTED', 'OPENED', 'EVALUATED', 'INTENTION_TO_AWARD'];
export const WON: BidStatus[] = ['AWARDED', 'CONTRACT_SIGNED'];
/** Statuses that can only be reached after the bid went in on e-GP — submittedAt is filled automatically if empty */
export const SUBMITTED_ONWARDS: BidStatus[] = [...IN_PROGRESS, ...WON, 'LOST'];

/**
 * Background link: the tender's status follows its bids.
 * any won → won · any in progress → submitted · all lost → lost · all cancelled → cancelled
 * otherwise (only preparing / withdrawn / no bids) → active.
 */
export function tenderStatusFromBids(statuses: string[]): 'won' | 'submitted' | 'lost' | 'cancelled' | 'active' {
  if (statuses.some((s) => (WON as string[]).includes(s))) return 'won';
  if (statuses.some((s) => (IN_PROGRESS as string[]).includes(s))) return 'submitted';
  if (statuses.length && statuses.every((s) => s === 'LOST' || s === 'WITHDRAWN') && statuses.includes('LOST')) return 'lost';
  if (statuses.length && statuses.every((s) => s === 'CANCELLED')) return 'cancelled';
  return 'active';
}

export interface ChecklistItem { key: string; label: string; done: boolean; note?: string; }

/** Standard e-GP works bid checklist. The bid document's ITB list always takes priority. */
export function defaultChecklist(isJv: boolean): ChecklistItem[] {
  const items: [string, string][] = [
    ['letter_of_bid', 'Letter of Bid (technical / price) signed'],
    ['bid_security', 'Bid security (bank guarantee / cash deposit) or bid-securing declaration if allowed'],
    ['power_of_attorney', 'Power of Attorney for the signatory'],
    ...(isJv ? ([['jv_agreement', 'JV agreement / letter of intent signed by all partners']] as [string, string][]) : []),
    ['registration', 'Firm / company registration certificate'],
    ['pan_vat', 'PAN / VAT registration certificate'],
    ['tax_clearance', 'Tax clearance certificate (latest fiscal year)'],
    ['licence', 'Contractor licence of the required class (valid)'],
    ['qualification_forms', 'Qualification forms (ELI / FIN / EXP) filled'],
    ['experience', 'Experience / completion certificates attached'],
    ['boq', 'Priced BOQ / activity schedule'],
    ['declaration', 'Declaration (eligibility, no conflict of interest, not blacklisted)'],
    ['validity', 'Bid validity period confirmed'],
    ['egp_receipt', 'Submitted on e-GP — submission receipt saved'],
  ];
  return items.map(([key, label]) => ({ key, label, done: false }));
}
