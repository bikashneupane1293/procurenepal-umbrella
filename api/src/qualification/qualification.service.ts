import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TurnoverService } from '../turnover/turnover.service';
import { EvaluateQualificationDto, TenderRequirementsDto } from './dto/evaluate-qualification.dto';

@Injectable()
export class QualificationService {
  constructor(
    private prisma: PrismaService,
    private turnoverService: TurnoverService,
  ) {}

  async evaluate(tenantId: string, dto: EvaluateQualificationDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, tenantId },
    });
    if (!company) {
      throw new NotFoundException('Company not found or access denied');
    }

    const certificates = await this.prisma.certificate.findMany({
      where: {
        companyId: dto.companyId,
        tenantId,
        verificationStatus: 'verified',
        completionStatus: { in: ['completed', 'substantially_completed'] },
      },
    });

    const requirements = dto.requirements || {};

    const turnoverResult = await this.checkTurnover(certificates, requirements);
    const keyActivityResult = this.checkKeyActivity(certificates, requirements);
    const result = this.determineResult(turnoverResult, keyActivityResult);

    return {
      companyId: dto.companyId,
      companyName: company.name,
      result,
      checks: {
        turnover: turnoverResult,
        keyActivity: keyActivityResult,
      },
      evaluatedAt: new Date().toISOString(),
      legalReference: 'PPMO Standard Bidding Documents — Form FIN-4',
    };
  }

  private async checkTurnover(
    certificates: any[],
    requirements: TenderRequirementsDto,
  ) {
    if (!requirements.requiredTurnover) {
      return {
        criterion: 'Turnover',
        required: null,
        actual: null,
        passed: true,
        message: 'No turnover requirement specified',
      };
    }

    // JV share DOES apply to turnover
    const turnoverCerts = certificates.map((c) => ({
      amount: Number(c.contractAmount) * (Number(c.jvShare) / 100),
      fiscalYear: c.fiscalYear,
    }));

    const aactResult = this.turnoverService.calculateAact({
      certificates: turnoverCerts,
    });

    return {
      criterion: 'Turnover (WPI-adjusted AACT — best 3 years)',
      required: requirements.requiredTurnover,
      actual: aactResult.averageAnnualTurnover,
      passed: aactResult.averageAnnualTurnover >= requirements.requiredTurnover,
      breakdown: aactResult.breakdown,
      bestThreeYearsCount: aactResult.bestThreeYearsCount,
    };
  }

  private checkKeyActivity(
    certificates: any[],
    requirements: TenderRequirementsDto,
  ) {
    if (!requirements.requiredActivity || !requirements.minimumActivityProduction) {
      return {
        criterion: 'Key Activity',
        required: null,
        actual: null,
        passed: true,
        message: 'No key activity requirement specified',
      };
    }

    const filtered = certificates.filter((c) => {
      const activitiesMatch = c.activities?.includes(requirements.requiredActivity!);
      const projectTypeMatch =
        !requirements.allowedProjectTypes ||
        requirements.allowedProjectTypes.length === 0 ||
        requirements.allowedProjectTypes.includes(c.projectType);
      return activitiesMatch && projectTypeMatch;
    });

    // CRITICAL: MAX YEAR logic, NOT average
    // CRITICAL: JV share is NOT applied to Key Activity (PPMO rule)
    const yearlyProduction: Record<string, number> = {};
    for (const cert of filtered) {
      yearlyProduction[cert.fiscalYear] =
        (yearlyProduction[cert.fiscalYear] || 0) + Number(cert.contractAmount);
    }

    const yearlyValues = Object.values(yearlyProduction);
    const maxYearProduction = yearlyValues.length > 0 ? Math.max(...yearlyValues) : 0;
    const maxYear = Object.entries(yearlyProduction).find(
      ([, v]) => v === maxYearProduction,
    )?.[0];

    return {
      criterion: 'Key Activity (MAX year production — no averaging)',
      required: requirements.minimumActivityProduction,
      actual: maxYearProduction,
      maxYear,
      passed: maxYearProduction >= requirements.minimumActivityProduction,
      yearlyProduction,
      certificatesCount: filtered.length,
      note: 'JV share is NOT applied to Key Activity per PPMO rules',
    };
  }

  private determineResult(turnover: any, keyActivity: any): string {
    if (turnover.passed && keyActivity.passed) {
      return 'INDIVIDUAL_ELIGIBLE';
    }
    // JV can only help when turnover is the ONLY failing criterion
    if (!turnover.passed && keyActivity.passed) {
      return 'JV_REQUIRED';
    }
    return 'NOT_ELIGIBLE';
  }
}
