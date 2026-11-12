import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths, WON_BID } from './project.constants';

/**
 * Background link Bolpatra → Project Management.
 * A won bid becomes a project: contract data from the bid and tender, JV partners, and the bid's
 * guarantees move to the project. Called automatically when a bid reaches "Contract signed",
 * or by hand ("Create project") for an awarded bid.
 */
@Injectable()
export class ProjectSyncService {
  constructor(private prisma: PrismaService) {}

  /** Next free code P-001, P-002 … for the workspace */
  async nextCode(tenantId: string): Promise<string> {
    const codes = new Set((await this.prisma.project.findMany({ where: { tenantId }, select: { code: true } })).map((p: any) => p.code));
    let i = codes.size + 1;
    while (codes.has(`P-${String(i).padStart(3, '0')}`)) i++;
    return `P-${String(i).padStart(3, '0')}`;
  }

  /** returns the project (existing or new); null when the bid is not won */
  async fromBid(tenantId: string, bidId: string, userId: string | null, onlyIfSigned = false): Promise<{ project: any; created: boolean } | null> {
    const bid: any = await this.prisma.bid.findFirst({ where: { id: bidId, tenantId }, include: { tender: true } });
    if (!bid || !WON_BID.includes(bid.status)) return null;
    if (onlyIfSigned && bid.status !== 'CONTRACT_SIGNED') return null;
    const existing = await this.prisma.project.findFirst({ where: { tenantId, bidId } });
    if (existing) return { project: existing, created: false };
    const t = bid.tender ?? {};
    const start = bid.contractSignDate ?? null;
    const months = t.contractPeriodMonths ?? null;
    const at = new Date().toISOString();
    const project = await this.prisma.project.create({
      data: {
        tenantId,
        companyId: bid.companyId,
        tenderId: bid.tenderId,
        bidId: bid.id,
        code: await this.nextCode(tenantId),
        name: t.projectTitle ?? 'Project',
        client: t.procuringEntity ?? null,
        contractNo: t.ifbNumber ?? null,
        projectType: t.projectType ?? null,
        contractAmount: bid.contractAmount ?? bid.bidAmount ?? null,
        contractSignDate: bid.contractSignDate ?? null,
        startDate: start,
        contractPeriodMonths: months,
        intendedCompletionDate: start && months ? addMonths(new Date(start), months) : null,
        bidderType: bid.bidderType ?? 'SINGLE',
        jvPartners: bid.jvPartners ?? undefined,
        status: 'MOBILIZING',
        source: 'BID',
        statusHistory: [{ status: 'MOBILIZING', at, byUserId: userId, note: 'Created from the won bid' }],
      },
    });
    // the bid's guarantees (bid security, performance …) now belong to the project too
    await this.prisma.bankGuarantee.updateMany({ where: { tenantId, bidId: bid.id }, data: { projectId: project.id } });
    return { project, created: true };
  }
}
