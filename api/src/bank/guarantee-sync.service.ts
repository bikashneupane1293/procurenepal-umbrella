import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { estimateCommission, OPEN_STATUSES } from './bank.constants';

const n = (v: any) => (v === null || v === undefined ? 0 : Number(v));
const sameDay = (a: any, b: any) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
const WON = ['AWARDED', 'CONTRACT_SIGNED'];

export type SyncOutcome = 'created' | 'updated' | 'linked' | 'none';

/**
 * Background link Bolpatra → Bank System.
 * When a bid stores a bank-guarantee bid security, or a won bid stores a performance security,
 * the matching guarantee record is created or kept up to date. Released / closed guarantees are never changed.
 * (The reverse link — guarantee edits copied back to the bid — is in GuaranteeService.)
 */
@Injectable()
export class GuaranteeSyncService {
  constructor(private prisma: PrismaService) {}

  async fromBid(tenantId: string, bidId: string, userId: string | null): Promise<SyncOutcome[]> {
    const bid: any = await this.prisma.bid.findFirst({ where: { id: bidId, tenantId }, include: { tender: true } });
    if (!bid) return [];
    const out: SyncOutcome[] = [];
    if (bid.bidSecurityType === 'BANK_GUARANTEE' && n(bid.bidSecurityAmount) > 0 && (bid.bidSecurityBank || bid.bidSecurityRef)) {
      out.push(await this.upsert(tenantId, bid, 'BID_SECURITY', {
        bankName: bid.bidSecurityBank || null,
        guaranteeNo: bid.bidSecurityRef || null,
        amount: n(bid.bidSecurityAmount),
        issueDate: bid.bidSecurityIssueDate ?? null,
        expiryDate: bid.bidSecurityExpiry ?? null,
      }, userId));
    }
    if (WON.includes(bid.status) && n(bid.performanceSecurityAmount) > 0) {
      out.push(await this.upsert(tenantId, bid, 'PERFORMANCE', {
        amount: n(bid.performanceSecurityAmount),
        expiryDate: bid.performanceSecurityExpiry ?? null,
      }, userId));
    }
    return out;
  }

  /** Back-fill for bids saved before the Bank System existed. */
  async allBids(tenantId: string, userId: string | null) {
    const bids = await this.prisma.bid.findMany({ where: { tenantId }, select: { id: true } });
    const count = { created: 0, updated: 0, linked: 0, unchanged: 0 };
    for (const b of bids) {
      for (const r of await this.fromBid(tenantId, b.id, userId)) {
        if (r === 'none') count.unchanged++;
        else count[r]++;
      }
    }
    return count;
  }

  private async upsert(tenantId: string, bid: any, type: string, from: Record<string, any>, userId: string | null): Promise<SyncOutcome> {
    const at = new Date().toISOString();
    const existing: any = await this.prisma.bankGuarantee.findFirst({ where: { tenantId, bidId: bid.id, type } });
    if (existing) {
      if (!OPEN_STATUSES.includes(existing.status)) return 'none';
      const data: any = {};
      for (const [k, v] of Object.entries(from)) {
        if (v === null || v === undefined || v === '') continue; // never wipe what was entered on the guarantee
        const cur = existing[k];
        const changed = k.endsWith('Date') ? !sameDay(cur, v) : k === 'amount' ? n(cur) !== n(v) : cur !== v;
        if (changed) data[k] = v;
      }
      if (type === 'BID_SECURITY' && data.guaranteeNo && existing.status === 'REQUESTED') data.status = 'ACTIVE';
      if (!Object.keys(data).length) return 'none';
      data.history = [...((existing.history as any[]) ?? []), { at, byUserId: userId, action: 'SYNCED_FROM_BID', changes: Object.keys(data) }];
      await this.prisma.bankGuarantee.update({ where: { id: existing.id }, data });
      return 'updated';
    }
    // a guarantee entered by hand with the same bank + number → link it instead of duplicating
    if (from.guaranteeNo) {
      const manual: any = (await this.prisma.bankGuarantee.findMany({ where: { tenantId, companyId: bid.companyId, bidId: null, guaranteeNo: from.guaranteeNo } }))
        .find((g: any) => !from.bankName || g.bankName.trim().toLowerCase() === String(from.bankName).trim().toLowerCase());
      if (manual) {
        await this.prisma.bankGuarantee.update({
          where: { id: manual.id },
          data: { bidId: bid.id, tenderId: bid.tenderId, type, history: [...((manual.history as any[]) ?? []), { at, byUserId: userId, action: 'LINKED_TO_BID' }] },
        });
        return 'linked';
      }
    }
    const bankName = from.bankName || (type === 'PERFORMANCE' ? bid.bidSecurityBank : null) || 'Bank to be confirmed';
    const banks: any[] = await this.prisma.bank.findMany({ where: { tenantId, companyId: bid.companyId } });
    const bank = banks.find((b) => b.name.trim().toLowerCase() === String(bankName).trim().toLowerCase());
    const amount = n(from.amount);
    const issueDate = from.issueDate ?? null;
    const expiryDate = from.expiryDate ?? null;
    const marginPct = bank?.defaultMarginPct != null ? n(bank.defaultMarginPct) : null;
    const commissionPct = bank?.defaultCommissionPct != null ? n(bank.defaultCommissionPct) : null;
    const commissionBasis = bank?.commissionBasis ?? null;
    await this.prisma.bankGuarantee.create({
      data: {
        tenantId,
        companyId: bid.companyId,
        bankId: bank?.id ?? null,
        bankName,
        branch: bank?.branch ?? null,
        type,
        guaranteeNo: from.guaranteeNo ?? null,
        bidId: bid.id,
        tenderId: bid.tenderId,
        beneficiary: bid.tender?.procuringEntity ?? null,
        purpose: `${type === 'BID_SECURITY' ? 'Bid security' : 'Performance security'} — ${bid.tender?.ifbNumber ?? ''} ${bid.tender?.projectTitle ?? ''}`.trim(),
        amount,
        issueDate,
        expiryDate,
        marginPct,
        marginAmount: marginPct != null ? Math.round(amount * marginPct) / 100 : null,
        commissionPct,
        commissionBasis,
        commissionAmount: estimateCommission(amount, commissionPct, commissionBasis, issueDate, expiryDate),
        status: type === 'BID_SECURITY' && from.guaranteeNo ? 'ACTIVE' : 'REQUESTED',
        source: 'BID',
        history: [{ at, byUserId: userId, action: 'CREATED_FROM_BID' }],
      },
    });
    return 'created';
  }
}
