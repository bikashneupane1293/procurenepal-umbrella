import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBidDto, UpdateBidDto } from './dto/bid.dto';
import { defaultChecklist, SUBMITTED_ONWARDS, tenderStatusFromBids } from './bid.constants';

const CAN_DELETE_BID = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];
const DATE_FIELDS = [
  'submittedAt', 'openingDate', 'bidSecurityIssueDate', 'bidSecurityExpiry', 'bidValidityExpiry',
  'intentionDate', 'awardDate', 'contractSignDate', 'performanceSecurityExpiry',
] as const;
const PLAIN_FIELDS = [
  'decision', 'decisionReason', 'bidAmount', 'rank', 'bidSecurityAmount', 'bidSecurityType',
  'bidSecurityBank', 'bidSecurityRef', 'contractAmount', 'performanceSecurityAmount', 'notes',
] as const;

/**
 * Bid Information Management (Bolpatra).
 * Every query is tenant-scoped. Changing a bid's status updates its tender's status automatically.
 */
@Injectable()
export class BidService {
  constructor(private prisma: PrismaService) {}

  private include = {
    tender: { select: { id: true, ifbNumber: true, projectTitle: true, procuringEntity: true, deadlineDate: true, boqAmount: true, status: true, bidSecurityAmount: true, bidValidityDays: true } },
    company: { select: { id: true, name: true } },
  };

  async list(tenantId: string, filter: { tenderId?: string; status?: string; companyId?: string } = {}) {
    return this.prisma.bid.findMany({
      where: {
        tenantId,
        ...(filter.tenderId ? { tenderId: filter.tenderId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.companyId ? { companyId: filter.companyId } : {}),
      },
      include: this.include,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const bid = await this.prisma.bid.findFirst({ where: { id, tenantId }, include: this.include });
    if (!bid) throw new NotFoundException('Bid not found or access denied');
    // the latest saved qualification result of the bidding company for this tender
    const qualification = await this.prisma.qualificationResult.findUnique({
      where: { tenderId_companyId: { tenderId: bid.tenderId, companyId: bid.companyId } },
    });
    return { ...bid, qualification: qualification && qualification.tenantId === tenantId ? qualification : null };
  }

  /** Validates JV partners against the workspace and returns them with names. */
  private async partners(tenantId: string, companyId: string, list: CreateBidDto['jvPartners']) {
    if (!list?.length) throw new BadRequestException('A JV bid needs its partners (at least 2, including the bidding company)');
    const ids = list.map((p) => p.companyId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('The same company is listed twice in the JV');
    if (!ids.includes(companyId)) throw new BadRequestException('The bidding company must be one of the JV partners');
    if (list.length < 2) throw new BadRequestException('A JV needs at least 2 partners');
    const total = list.reduce((s, p) => s + p.share, 0);
    if (Math.abs(total - 100) > 0.01) throw new BadRequestException(`JV shares add up to ${total}% — they must total 100%`);
    const companies = await this.prisma.company.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } });
    if (companies.length !== ids.length) throw new NotFoundException('A JV partner company was not found in your workspace');
    const leadId = list.find((p) => p.isLead)?.companyId ?? companyId;
    return list.map((p) => ({ companyId: p.companyId, name: companies.find((c) => c.id === p.companyId)!.name, share: p.share, isLead: p.companyId === leadId }));
  }

  private dataFrom(dto: UpdateBidDto) {
    const data: any = {};
    for (const k of PLAIN_FIELDS) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k];
    for (const k of DATE_FIELDS) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k] ? new Date((dto as any)[k]) : null;
    if (dto.checklist !== undefined) data.checklist = dto.checklist;
    return data;
  }

  /** Simple consistency rules — each one explains itself. */
  private check(merged: any) {
    if (merged.decision === 'NO_BID' && !['PREPARING', 'WITHDRAWN', 'CANCELLED'].includes(merged.status)) {
      throw new BadRequestException('A "No bid" decision cannot have a submitted status — set the status to Preparing, Withdrawn or Cancelled');
    }
    if (merged.status !== 'PREPARING' && !['WITHDRAWN', 'CANCELLED'].includes(merged.status) && merged.decision === 'UNDECIDED') {
      merged.decision = 'BID'; // a submitted bid is a "bid" decision
    }
    const d = (k: string) => (merged[k] ? new Date(merged[k]).getTime() : null);
    if (d('bidSecurityIssueDate') && d('bidSecurityExpiry') && d('bidSecurityExpiry')! < d('bidSecurityIssueDate')!) {
      throw new BadRequestException('Bid security expiry is before its issue date');
    }
    if (d('awardDate') && d('contractSignDate') && d('contractSignDate')! < d('awardDate')!) {
      throw new BadRequestException('Contract signing date is before the award date');
    }
  }

  async create(tenantId: string, userId: string, dto: CreateBidDto) {
    const tender = await this.prisma.tender.findFirst({ where: { id: dto.tenderId, tenantId } });
    if (!tender) throw new NotFoundException('Tender not found or access denied');
    const company = await this.prisma.company.findFirst({ where: { id: dto.companyId, tenantId } });
    if (!company) throw new NotFoundException('Company not found or access denied');
    const exists = await this.prisma.bid.findUnique({ where: { tenderId_companyId: { tenderId: dto.tenderId, companyId: dto.companyId } } });
    if (exists) throw new ConflictException(`${company.name} already has a bid record for this tender`);

    const isJv = dto.bidderType === 'JV';
    const status = dto.status ?? 'PREPARING';
    const data: any = {
      tenantId,
      tenderId: dto.tenderId,
      companyId: dto.companyId,
      bidderType: isJv ? 'JV' : 'SINGLE',
      jvPartners: isJv ? await this.partners(tenantId, dto.companyId, dto.jvPartners) : undefined,
      decision: dto.decision ?? 'UNDECIDED',
      status,
      statusHistory: [{ status, at: new Date().toISOString(), byUserId: userId }],
      // background link: amounts stated in the tender
      bidSecurityAmount: tender.bidSecurityAmount ?? undefined,
      checklist: dto.checklist ?? defaultChecklist(isJv),
      ...this.dataFrom(dto),
    };
    // bid validity expiry from the tender's validity days, counted from the deadline
    if (data.bidValidityExpiry === undefined && tender.bidValidityDays && tender.deadlineDate) {
      data.bidValidityExpiry = new Date(new Date(tender.deadlineDate).getTime() + tender.bidValidityDays * 86400000);
    }
    if (!data.submittedAt && (SUBMITTED_ONWARDS as string[]).includes(data.status)) data.submittedAt = new Date();
    this.check(data);
    const bid = await this.prisma.bid.create({ data, include: this.include });
    await this.syncTender(tenantId, dto.tenderId);
    return bid;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateBidDto) {
    const bid = await this.prisma.bid.findFirst({ where: { id, tenantId } });
    if (!bid) throw new NotFoundException('Bid not found or access denied');
    if ((dto.tenderId && dto.tenderId !== bid.tenderId) || (dto.companyId && dto.companyId !== bid.companyId)) {
      throw new BadRequestException('The tender and the bidding company of a bid cannot be changed — create a new bid record instead');
    }
    const data: any = this.dataFrom(dto);
    if (dto.bidderType !== undefined || dto.jvPartners !== undefined) {
      const isJv = (dto.bidderType ?? bid.bidderType) === 'JV';
      data.bidderType = isJv ? 'JV' : 'SINGLE';
      data.jvPartners = isJv ? await this.partners(tenantId, bid.companyId, dto.jvPartners ?? (bid.jvPartners as any)) : null;
    }
    if (dto.status !== undefined && dto.status !== bid.status) {
      data.status = dto.status;
      data.statusHistory = [...((bid.statusHistory as any[]) ?? []), { status: dto.status, at: new Date().toISOString(), byUserId: userId }];
    }
    const merged = { ...bid, ...data };
    if (!merged.submittedAt && (SUBMITTED_ONWARDS as string[]).includes(merged.status)) data.submittedAt = merged.submittedAt = new Date();
    this.check(merged);
    if (merged.decision !== (data.decision ?? bid.decision)) data.decision = merged.decision;
    const saved = await this.prisma.bid.update({ where: { id }, data, include: this.include });
    await this.syncTender(tenantId, bid.tenderId);
    return saved;
  }

  async remove(tenantId: string, role: string, id: string) {
    if (!CAN_DELETE_BID.includes(role)) throw new ForbiddenException('Only the Owner or a Director can delete bid records');
    const bid = await this.prisma.bid.findFirst({ where: { id, tenantId } });
    if (!bid) throw new NotFoundException('Bid not found or access denied');
    await this.prisma.bid.delete({ where: { id } });
    await this.syncTender(tenantId, bid.tenderId);
    return { deleted: true, id };
  }

  /** Background link: tender.status follows its bids (won / submitted / lost / cancelled / active). Archived tenders are left alone. */
  async syncTender(tenantId: string, tenderId: string) {
    const tender = await this.prisma.tender.findFirst({ where: { id: tenderId, tenantId }, select: { status: true } });
    if (!tender || tender.status === 'archived') return;
    const bids = await this.prisma.bid.findMany({ where: { tenantId, tenderId }, select: { status: true } });
    const target = tenderStatusFromBids(bids.map((b) => b.status));
    // only undo statuses that bids set; a status the user chose by hand (e.g. cancelled) stays
    if (target === 'active' && !['submitted', 'won', 'lost'].includes(tender.status)) return;
    if (target !== tender.status) await this.prisma.tender.update({ where: { id: tenderId }, data: { status: target } });
  }
}
