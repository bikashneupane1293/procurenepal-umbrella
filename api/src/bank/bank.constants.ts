// Bank System — guarantee types, statuses, cost estimates and alerts. © Cuidado Technology Pvt. Ltd.

export const GUARANTEE_TYPES = ['BID_SECURITY', 'PERFORMANCE', 'ADVANCE_PAYMENT', 'RETENTION', 'CUSTOMS', 'OTHER'] as const;
export const GUARANTEE_STATUSES = ['REQUESTED', 'ACTIVE', 'RELEASED', 'EXPIRED', 'CLAIMED', 'CANCELLED'] as const;
/** Guarantees that still use the bank limit */
export const OPEN_STATUSES = ['REQUESTED', 'ACTIVE'];
export const COMMISSION_BASES = ['QUARTER', 'YEAR', 'FLAT'] as const;
export const ACCOUNT_TYPES = ['CURRENT', 'SAVINGS', 'OVERDRAFT', 'FIXED', 'OTHER'] as const;
/** Roles that may delete banks and guarantees */
export const CAN_DELETE_BANK = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];

/**
 * Guidance, not a PPMO rule: tender documents usually ask the bid security to stay valid
 * about 30 days beyond the bid validity period. Shown as a warning only.
 */
export const BID_SECURITY_MARGIN_DAYS = 30;

const DAY = 86_400_000;
export const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY);

/**
 * Commission estimate. Banks differ, so this is only an estimate the user can overwrite:
 * QUARTER = rate per quarter or part of it, YEAR = rate per year or part of it, FLAT = rate once.
 */
export function estimateCommission(amount: number, pct: number | null | undefined, basis: string | null | undefined,
  issue: Date | null | undefined, expiry: Date | null | undefined): number | null {
  if (!amount || pct === null || pct === undefined || Number.isNaN(pct)) return null;
  let periods = 1;
  if (basis !== 'FLAT') {
    if (!issue || !expiry) return null;
    const days = Math.max(1, daysBetween(issue, expiry));
    periods = Math.ceil(days / (basis === 'YEAR' ? 365 : 91));
  }
  return Math.round(amount * (pct / 100) * periods * 100) / 100;
}

export interface GuaranteeAlert { code: 'EXPIRED_OPEN' | 'EXPIRING' | 'RELEASE_DUE' | 'SHORT_VALIDITY' | 'NO_NUMBER'; message: string }

/** Plain-language alerts for one guarantee (bid = linked bid, if any). */
export function alertsFor(g: any, bid: any | null, today: Date, windowDays: number): GuaranteeAlert[] {
  const out: GuaranteeAlert[] = [];
  const open = OPEN_STATUSES.includes(g.status);
  const exp = g.expiryDate ? new Date(g.expiryDate) : null;
  if (open && exp) {
    const left = daysBetween(today, exp);
    if (left < 0) out.push({ code: 'EXPIRED_OPEN', message: `Expired ${-left} day(s) ago but not marked released — get the release letter or extend it` });
    else if (left <= windowDays) out.push({ code: 'EXPIRING', message: `Expires in ${left} day(s)` });
  }
  if (open && g.status === 'ACTIVE' && !g.guaranteeNo) out.push({ code: 'NO_NUMBER', message: 'Guarantee number missing' });
  if (open && bid && g.type === 'BID_SECURITY') {
    if (['LOST', 'WITHDRAWN', 'CANCELLED'].includes(bid.status)) {
      out.push({ code: 'RELEASE_DUE', message: 'The bid was not successful — ask the procuring entity to return the bid security' });
    } else if (bid.status === 'CONTRACT_SIGNED') {
      out.push({ code: 'RELEASE_DUE', message: 'Contract signed — the bid security can be returned once the performance security is accepted' });
    }
    if (exp && bid.bidValidityExpiry && !['LOST', 'WITHDRAWN', 'CANCELLED', 'CONTRACT_SIGNED'].includes(bid.status)) {
      const need = new Date(new Date(bid.bidValidityExpiry).getTime() + BID_SECURITY_MARGIN_DAYS * DAY);
      if (exp < need) out.push({ code: 'SHORT_VALIDITY', message: `Usually needs to stay valid ${BID_SECURITY_MARGIN_DAYS} days beyond bid validity — check the tender document` });
    }
  }
  if (open && bid && g.type === 'PERFORMANCE' && ['LOST', 'WITHDRAWN', 'CANCELLED'].includes(bid.status)) {
    out.push({ code: 'RELEASE_DUE', message: 'The linked bid is no longer won — cancel or release this guarantee' });
  }
  return out;
}
