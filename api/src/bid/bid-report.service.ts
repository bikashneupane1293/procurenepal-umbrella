import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BID_STATUSES, IN_PROGRESS, WON } from './bid.constants';

const DAY = 86_400_000;
const n = (v: any) => (v === null || v === undefined ? 0 : Number(v));
const days = (d: Date | string | null | undefined, now: Date) =>
  d ? Math.ceil((new Date(d).getTime() - now.getTime()) / DAY) : null;

/**
 * Bolpatra Reports — everything is calculated from the workspace's own data (tenantId).
 * windowDays: how far ahead to look for deadlines and expiries.
 */
@Injectable()
export class BidReportService {
  constructor(private prisma: PrismaService) {}

  async summary(tenantId: string, windowDays = 30, now = new Date()) {
    const [tenders, bids, companies, certificates, results] = await Promise.all([
      this.prisma.tender.findMany({ where: { tenantId } }),
      this.prisma.bid.findMany({ where: { tenantId }, include: { tender: { select: { ifbNumber: true, projectTitle: true } }, company: { select: { name: true } } } }),
      this.prisma.company.findMany({ where: { tenantId }, select: { id: true, name: true, licenseExpiry: true, licenseClass: true } }),
      this.prisma.certificate.findMany({ where: { tenantId }, select: { companyId: true, verificationStatus: true } }),
      this.prisma.qualificationResult.findMany({ where: { tenantId } }),
    ]);
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const within = (d: any) => { const x = days(d, now); return x !== null && x <= windowDays; };

    // ---- tenders
    const tenderByStatus: Record<string, number> = {};
    for (const t of tenders) tenderByStatus[t.status] = (tenderByStatus[t.status] ?? 0) + 1;
    const upcoming = tenders
      .filter((t) => t.status === 'active' && (days(t.deadlineDate, now) ?? -1) >= 0 && within(t.deadlineDate))
      .map((t) => {
        const own = bids.filter((b) => b.tenderId === t.id);
        return {
          tenderId: t.id, ifbNumber: t.ifbNumber, projectTitle: t.projectTitle, deadlineDate: t.deadlineDate,
          daysLeft: days(t.deadlineDate, now),
          decision: own.length ? [...new Set(own.map((b) => b.decision))].join(', ') : 'NO RECORD',
        };
      })
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    const noDecision = upcoming.filter((u) => u.decision === 'NO RECORD' || u.decision === 'UNDECIDED');

    // ---- bids
    const byStatus: Record<string, number> = Object.fromEntries(BID_STATUSES.map((s) => [s, 0]));
    const byDecision: Record<string, number> = { UNDECIDED: 0, BID: 0, NO_BID: 0 };
    for (const b of bids) { byStatus[b.status] = (byStatus[b.status] ?? 0) + 1; byDecision[b.decision] = (byDecision[b.decision] ?? 0) + 1; }
    const isWon = (b: any) => (WON as string[]).includes(b.status);
    const won = bids.filter(isWon);
    const lost = bids.filter((b) => b.status === 'LOST');
    const submitted = bids.filter((b) => isWon(b) || b.status === 'LOST' || (IN_PROGRESS as string[]).includes(b.status));
    const decided = won.length + lost.length;

    // ---- expiries
    const exp = (field: 'bidSecurityExpiry' | 'bidValidityExpiry' | 'performanceSecurityExpiry', amountField?: string) =>
      bids
        .filter((b) => (b as any)[field] && within((b as any)[field]) && !['LOST', 'WITHDRAWN', 'CANCELLED'].includes(b.status))
        .map((b) => ({
          bidId: b.id, ifbNumber: b.tender.ifbNumber, company: b.company.name, status: b.status,
          expiry: (b as any)[field], daysLeft: days((b as any)[field], now),
          amount: amountField ? n((b as any)[amountField]) : null,
          bank: field === 'bidSecurityExpiry' ? b.bidSecurityBank : null,
        }))
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    const licences = companies
      .filter((c) => c.licenseExpiry && within(c.licenseExpiry))
      .map((c) => ({ companyId: c.id, company: c.name, licenseClass: c.licenseClass, expiry: c.licenseExpiry, daysLeft: days(c.licenseExpiry, now) }))
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    const missingLicence = companies.filter((c) => !c.licenseExpiry).map((c) => c.name);

    // ---- documents
    const pendingByCompany: Record<string, number> = {};
    for (const c of certificates) if (c.verificationStatus !== 'verified') pendingByCompany[c.companyId] = (pendingByCompany[c.companyId] ?? 0) + 1;

    // ---- per company
    const perCompany = companies.map((c) => {
      const cb = bids.filter((b) => b.companyId === c.id || ((b.jvPartners as any[]) ?? []).some((p) => p.companyId === c.id));
      const cr = results.filter((r) => r.companyId === c.id);
      const cw = cb.filter(isWon);
      const cl = cb.filter((b) => b.status === 'LOST');
      return {
        companyId: c.id, company: c.name,
        bids: cb.length, submitted: cb.filter((b) => b.status !== 'PREPARING' && b.decision !== 'NO_BID').length,
        won: cw.length, lost: cl.length,
        winRate: cw.length + cl.length ? Math.round((1000 * cw.length) / (cw.length + cl.length)) / 10 : null,
        wonValue: cw.reduce((s, b) => s + n(b.contractAmount ?? b.bidAmount), 0),
        tendersChecked: cr.length,
        eligible: cr.filter((r) => r.result === 'INDIVIDUAL_ELIGIBLE').length,
        jvRequired: cr.filter((r) => r.result === 'JV_REQUIRED').length,
        notEligible: cr.filter((r) => r.result === 'NOT_ELIGIBLE').length,
        pendingDocumentChecks: pendingByCompany[c.id] ?? 0,
      };
    });

    // ---- last 12 months (by submission date)
    const months: { month: string; submitted: number; won: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7);
      months.push({
        month: key,
        submitted: bids.filter((b) => b.submittedAt && new Date(b.submittedAt).toISOString().slice(0, 7) === key).length,
        won: bids.filter((b) => isWon(b) && (b.awardDate ?? b.submittedAt) && new Date((b.awardDate ?? b.submittedAt)!).toISOString().slice(0, 7) === key).length,
      });
    }

    return {
      generatedAt: now.toISOString(),
      windowDays,
      tenders: { total: tenders.length, byStatus: tenderByStatus, upcoming, noDecision },
      bids: {
        total: bids.length, byStatus, byDecision,
        submitted: submitted.length, won: won.length, lost: lost.length,
        winRate: decided ? Math.round((1000 * won.length) / decided) / 10 : null,
        submittedValue: submitted.reduce((s, b) => s + n(b.bidAmount), 0),
        wonValue: won.reduce((s, b) => s + n(b.contractAmount ?? b.bidAmount), 0),
      },
      expiring: {
        bidSecurities: exp('bidSecurityExpiry', 'bidSecurityAmount'),
        bidValidity: exp('bidValidityExpiry'),
        performanceSecurities: exp('performanceSecurityExpiry', 'performanceSecurityAmount'),
        licences,
        missingLicence,
      },
      documents: {
        pendingCertificates: certificates.filter((c) => c.verificationStatus !== 'verified').length,
        totalCertificates: certificates.length,
        byCompany: Object.entries(pendingByCompany).map(([id, count]) => ({ company: companyName.get(id) ?? id, pending: count })),
      },
      perCompany,
      months,
    };
  }
}
