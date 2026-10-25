import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QualificationService } from '../qualification/qualification.service';
import { CreateTenderDto } from './dto/create-tender.dto';

@Injectable()
export class TenderService {
  constructor(
    private prisma: PrismaService,
    private qualificationService: QualificationService,
  ) {}

  async create(tenantId: string, dto: CreateTenderDto) {
    const existing = await this.prisma.tender.findUnique({
      where: { tenantId_ifbNumber: { tenantId, ifbNumber: dto.ifbNumber } },
    });

    if (existing) {
      throw new ConflictException('Tender with this IFB number already exists');
    }

    return this.prisma.tender.create({
      data: {
        tenantId,
        ifbNumber: dto.ifbNumber,
        projectTitle: dto.projectTitle,
        procuringEntity: dto.procuringEntity,
        publicationDate: dto.publicationDate ? new Date(dto.publicationDate) : null,
        deadlineDate: new Date(dto.deadlineDate),
        projectType: dto.projectType,
        boqAmount: dto.boqAmount,
        reqTurnover: dto.reqTurnover,
        reqActivity: dto.reqActivity,
        reqProjectTypes: dto.reqProjectTypes ?? [],
        reqMinProduction: dto.reqMinProduction,
        source: dto.source ?? 'manual',
        status: 'active',
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
    const tender = await this.prisma.tender.findFirst({
      where: { id, tenantId },
    });

    if (!tender) {
      throw new NotFoundException('Tender not found or access denied');
    }

    return tender;
  }

  async evaluateAndPersist(tenantId: string, tenderId: string, companyId: string) {
    const tender = await this.prisma.tender.findFirst({
      where: { id: tenderId, tenantId },
    });

    if (!tender) {
      throw new NotFoundException('Tender not found or access denied');
    }

    const requirements = {
      requiredTurnover: tender.reqTurnover ? Number(tender.reqTurnover) : undefined,
      requiredActivity: tender.reqActivity ?? undefined,
      allowedProjectTypes: tender.reqProjectTypes,
      minimumActivityProduction: tender.reqMinProduction
        ? Number(tender.reqMinProduction)
        : undefined,
    };

    const evaluation = await this.qualificationService.evaluate(tenantId, {
      companyId,
      requirements,
    });

    const savedResult = await this.prisma.qualificationResult.upsert({
      where: {
        tenderId_companyId: { tenderId, companyId },
      },
      create: {
        tenantId,
        tenderId,
        companyId,
        result: evaluation.result,
        turnoverAact: evaluation.checks.turnover.actual
          ? String(evaluation.checks.turnover.actual)
          : null,
        turnoverRequired: evaluation.checks.turnover.required
          ? String(evaluation.checks.turnover.required)
          : null,
        keyActivityDetails: evaluation.checks.keyActivity as any,
        explanation: evaluation.checks.turnover.passed
          ? 'Turnover and key activity criteria met'
          : 'Turnover requirement not met — JV may be required',
        calculatedAt: new Date(),
      },
      update: {
        result: evaluation.result,
        turnoverAact: evaluation.checks.turnover.actual
          ? String(evaluation.checks.turnover.actual)
          : null,
        turnoverRequired: evaluation.checks.turnover.required
          ? String(evaluation.checks.turnover.required)
          : null,
        keyActivityDetails: evaluation.checks.keyActivity as any,
        explanation: evaluation.checks.turnover.passed
          ? 'Turnover and key activity criteria met'
          : 'Turnover requirement not met — JV may be required',
        calculatedAt: new Date(),
      },
    });

    return {
      tenderId,
      companyId,
      evaluation,
      savedResultId: savedResult.id,
      persistedAt: savedResult.calculatedAt,
    };
  }

  async getQualifications(tenantId: string, tenderId: string) {
    const tender = await this.prisma.tender.findFirst({
      where: { id: tenderId, tenantId },
    });

    if (!tender) {
      throw new NotFoundException('Tender not found or access denied');
    }

    return this.prisma.qualificationResult.findMany({
      where: { tenderId, tenantId },
      orderBy: { calculatedAt: 'desc' },
    });
  }
}
