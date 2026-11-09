import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QualificationService } from '../qualification/qualification.service';
import { CreateTenderDto } from './dto/create-tender.dto';
import { UpdateTenderDto } from './dto/update-tender.dto';
import { JvPartnerDto } from '../qualification/dto/evaluate-qualification.dto';
import { SingleResult, evaluateSingle } from '../qualification/engine/qualification-engine';

// Roles allowed to delete tenders
const CAN_DELETE_TENDER = ['OWNER', 'SUPER_ADMIN', 'DIRECTOR'];

@Injectable()
export class TenderService {
  constructor(
    private prisma: PrismaService,
    private qualificationService: QualificationService,
  ) {}

  /** Map DTO fields to Prisma data (only the fields that were sent). */
  private toData(dto: Partial<CreateTenderDto>) {
    const d: any = {};
    const copy = [
      'ifbNumber', 'projectTitle', 'procuringEntity', 'projectType', 'boqAmount',
      'contractPeriodMonths', 'reqTurnover', 'reqBidCapacity', 'reqSimilarValue',
      'reqSimilarCount', 'similarDescription', 'reqActivity', 'reqMinProduction',
      'isComplexWork', 'awardMethod', 'ruleSetId', 'status', 'notes', 'source',
      'bidSecurityAmount', 'bidValidityDays',
    ] as const;
    for (const k of copy) if ((dto as any)[k] !== undefined) d[k] = (dto as any)[k];
    if (dto.publicationDate !== undefined) {
      d.publicationDate = dto.publicationDate ? new Date(dto.publicationDate) : null;
    }
    if (dto.deadlineDate !== undefined) d.deadlineDate = new Date(dto.deadlineDate);
    if (dto.reqProjectTypes !== undefined) d.reqProjectTypes = dto.reqProjectTypes ?? [];
    if (dto.keyActivityReqs !== undefined) {
      d.keyActivityReqs = (dto.keyActivityReqs ?? []).map((a) => ({
        name: a.name.trim(),
        unit: a.unit.trim(),
        quantity: a.quantity,
      }));
    }
    if (dto.criteria !== undefined) {
      // keep only keys that were actually given
      const c: any = {};
      for (const [k, v] of Object.entries(dto.criteria ?? {})) if (v !== undefined && v !== null) c[k] = v;
      d.criteria = c;
    }
    return d;
  }

  async create(tenantId: string, dto: CreateTenderDto) {
    const existing = await this.prisma.tender.findUnique({
      where: { tenantId_ifbNumber: { tenantId, ifbNumber: dto.ifbNumber } },
    });
    if (existing) {
      throw new ConflictException('Tender with this IFB number already exists');
    }
    return this.prisma.tender.create({
      data: {
        ...this.toData(dto),
        tenantId,
        source: dto.source ?? 'manual',
        status: dto.status ?? 'active',
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.tender.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const tender = await this.prisma.tender.findFirst({ where: { id, tenantId } });
    if (!tender) {
      throw new NotFoundException('Tender not found or access denied');
    }
    return tender;
  }

  async update(tenantId: string, id: string, dto: UpdateTenderDto) {
    const tender = await this.findOne(tenantId, id);
    if (dto.ifbNumber && dto.ifbNumber !== tender.ifbNumber) {
      const clash = await this.prisma.tender.findUnique({
        where: { tenantId_ifbNumber: { tenantId, ifbNumber: dto.ifbNumber } },
      });
      if (clash) throw new ConflictException('Another tender already uses this IFB number');
    }
    return this.prisma.tender.update({ where: { id }, data: this.toData(dto) });
  }

  async remove(tenantId: string, role: string, id: string) {
    if (!CAN_DELETE_TENDER.includes(role)) {
      throw new ForbiddenException('Only the Owner or a Director can delete tenders');
    }
    const tender = await this.findOne(tenantId, id);
    const [results] = await this.prisma.$transaction([
      this.prisma.qualificationResult.deleteMany({ where: { tenantId, tenderId: id } }),
      this.prisma.tender.delete({ where: { id } }),
    ]);
    return { deleted: true, id, ifbNumber: tender.ifbNumber, qualificationResultsDeleted: results.count };
  }

  // ----------------------------------------------------- qualification

  private async persist(tenantId: string, tenderId: string, ev: SingleResult) {
    const turnover = ev.checks.find((c) => c.code === 'TURNOVER');
    const keyActs = ev.checks.filter((c) => c.code === 'KEY_ACTIVITY' || c.code === 'KEY_ACTIVITY_VALUE');
    const data = {
      result: ev.result,
      turnoverAact: turnover?.actual != null ? String(Math.round(turnover.actual * 100) / 100) : null,
      turnoverRequired: turnover?.required != null ? String(Math.round(turnover.required * 100) / 100) : null,
      keyActivityDetails: keyActs as any,
      explanation: ev.summary,
      checks: ev.checks as any,
      warnings: ev.warnings as any,
      ruleSetId: ev.ruleSet.id,
      calculatedAt: new Date(ev.evaluatedAt),
    };
    return this.prisma.qualificationResult.upsert({
      where: { tenderId_companyId: { tenderId, companyId: ev.companyId } },
      create: { tenantId, tenderId, companyId: ev.companyId, ...data },
      update: data,
    });
  }

  async evaluateAndPersist(tenantId: string, tenderId: string, companyId: string) {
    const evaluation = await this.qualificationService.evaluateForTender(tenantId, tenderId, companyId);
    const saved = await this.persist(tenantId, tenderId, evaluation);
    return {
      tenderId,
      companyId,
      evaluation,
      savedResultId: saved.id,
      persistedAt: saved.calculatedAt,
    };
  }

  /** Company-wide bid decision: evaluate every company of the workspace for this tender. */
  async evaluateAll(tenantId: string, tenderId: string) {
    const tenderRow = await this.findOne(tenantId, tenderId);
    const tender = this.qualificationService.toEngineTender(tenderRow);
    const companies = await this.qualificationService.loadAllCompanies(tenantId);
    const order = { INDIVIDUAL_ELIGIBLE: 0, JV_REQUIRED: 1, NOT_ELIGIBLE: 2 } as const;
    const results: SingleResult[] = [];
    for (const c of companies) {
      const ev = evaluateSingle(tender, c, this.qualificationService.wpi);
      await this.persist(tenantId, tenderId, ev);
      results.push(ev);
    }
    results.sort((a, b) => order[a.result] - order[b.result] || a.companyName.localeCompare(b.companyName));
    return {
      tenderId,
      ifbNumber: tenderRow.ifbNumber,
      evaluated: results.length,
      counts: {
        INDIVIDUAL_ELIGIBLE: results.filter((r) => r.result === 'INDIVIDUAL_ELIGIBLE').length,
        JV_REQUIRED: results.filter((r) => r.result === 'JV_REQUIRED').length,
        NOT_ELIGIBLE: results.filter((r) => r.result === 'NOT_ELIGIBLE').length,
      },
      results,
    };
  }

  evaluateJv(tenantId: string, tenderId: string, partners: JvPartnerDto[]) {
    return this.qualificationService.evaluateJvForTender(tenantId, tenderId, partners);
  }

  jvPartners(tenantId: string, tenderId: string, companyId: string) {
    return this.qualificationService.findPartnersForTender(tenantId, tenderId, companyId);
  }

  async getQualifications(tenantId: string, tenderId: string) {
    await this.findOne(tenantId, tenderId);
    const rows = await this.prisma.qualificationResult.findMany({
      where: { tenderId, tenantId },
      orderBy: { calculatedAt: 'desc' },
    });
    // attach company names (QualificationResult has no relation to Company)
    const ids = [...new Set(rows.map((r) => r.companyId))];
    const companies = ids.length
      ? await this.prisma.company.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const names = new Map(companies.map((c) => [c.id, c.name]));
    return rows.map((r) => ({ ...r, companyName: names.get(r.companyId) ?? '(deleted company)' }));
  }
}
