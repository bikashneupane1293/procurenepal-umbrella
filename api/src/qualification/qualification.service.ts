import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WpiService } from '../wpi/wpi.service';
import { EvaluateQualificationDto, JvPartnerDto, ReplaceTurnoversDto } from './dto/evaluate-qualification.dto';
import {
  EngineCertificate,
  EngineCompany,
  EngineTender,
  TenderKeyActivityReq,
  WpiLookup,
  evaluateJv,
  evaluateSingle,
  findJvPartners,
} from './engine/qualification-engine';
import { RULE_SETS, DISCLAIMER } from './engine/rule-sets';
import { fyStart } from './engine/fiscal-year';

const num = (v: any): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Qualification Service v2 (Phase 6.4A)
 * Loads companies / certificates / tenders from the database, converts them for the
 * pure engine (./engine), and stores results. All queries are tenant-scoped.
 */
@Injectable()
export class QualificationService {
  constructor(
    private prisma: PrismaService,
    private wpiService: WpiService,
  ) {}

  // ------------------------------------------------------------ WPI

  /** Multiplier that brings a fiscal year's amount to current prices. */
  readonly wpi: WpiLookup = (fy: string) => {
    const hist = this.wpiService.getWpiForYear(fy);
    const current = this.wpiService.getCurrentWpi();
    if (hist > 0) return current / hist;
    // Years newer than the latest index are already at (about) current prices
    const s = fyStart(fy);
    if (s !== null && s >= 2081) return 1;
    return null;
  };

  // ------------------------------------------------------- loading

  async loadCompany(tenantId: string, companyId: string): Promise<EngineCompany> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, tenantId },
      include: { certificates: true, turnovers: true },
    });
    if (!company) throw new NotFoundException('Company not found or access denied');
    return this.toEngineCompany(company);
  }

  async loadAllCompanies(tenantId: string): Promise<EngineCompany[]> {
    const companies = await this.prisma.company.findMany({
      where: { tenantId },
      include: { certificates: true, turnovers: true },
      orderBy: { name: 'asc' },
    });
    return companies.map((c) => this.toEngineCompany(c));
  }

  async loadTender(tenantId: string, tenderId: string) {
    const tender = await this.prisma.tender.findFirst({ where: { id: tenderId, tenantId } });
    if (!tender) throw new NotFoundException('Tender not found or access denied');
    return tender;
  }

  toEngineCompany(c: any): EngineCompany {
    return {
      id: c.id,
      name: c.name,
      licenseClass: c.licenseClass,
      licenseExpiry: c.licenseExpiry ? new Date(c.licenseExpiry) : null,
      annualTurnovers: (c.turnovers ?? []).map((t: any) => ({
        fiscalYear: t.fiscalYear,
        amount: Number(t.amount),
      })),
      certificates: (c.certificates ?? []).map(
        (x: any): EngineCertificate => ({
          id: x.id,
          certificateId: x.certificateId,
          projectName: x.projectName,
          projectType: x.projectType,
          fiscalYear: x.fiscalYear,
          contractAmount: Number(x.contractAmount),
          finalAmount: num(x.finalAmount),
          jvShare: Number(x.jvShare ?? 100),
          jvName: x.jvName,
          completionStatus: x.completionStatus,
          verificationStatus: x.verificationStatus,
          completionDate: x.completionDate ? new Date(x.completionDate) : null,
          activities: x.activities ?? [],
          keyActivities: Array.isArray(x.keyActivities)
            ? x.keyActivities.map((a: any) => ({
                name: String(a?.name ?? ''),
                unit: String(a?.unit ?? ''),
                fiscalYear: String(a?.fiscalYear ?? ''),
                quantity: Number(a?.quantity ?? 0),
              }))
            : [],
          outstandingAmount: num(x.outstandingAmount),
          isOpenBid: x.isOpenBid ?? true,
        }),
      ),
    };
  }

  toEngineTender(t: any): EngineTender {
    const keyActivityReqs: TenderKeyActivityReq[] = Array.isArray(t.keyActivityReqs)
      ? t.keyActivityReqs
          .map((a: any) => ({
            name: String(a?.name ?? ''),
            unit: String(a?.unit ?? ''),
            quantity: Number(a?.quantity ?? 0),
          }))
          .filter((a: TenderKeyActivityReq) => a.name && a.quantity > 0)
      : [];
    return {
      id: t.id,
      ifbNumber: t.ifbNumber,
      projectTitle: t.projectTitle,
      estimateAmount: num(t.boqAmount),
      contractPeriodMonths: t.contractPeriodMonths ?? null,
      publicationDate: t.publicationDate ? new Date(t.publicationDate) : null,
      deadlineDate: t.deadlineDate ? new Date(t.deadlineDate) : null,
      projectType: t.projectType ?? null,
      similarProjectTypes: t.reqProjectTypes ?? [],
      reqTurnover: num(t.reqTurnover),
      reqBidCapacity: num(t.reqBidCapacity),
      reqSimilarValue: num(t.reqSimilarValue),
      reqSimilarCount: t.reqSimilarCount ?? null,
      keyActivityReqs,
      legacyActivity:
        t.reqActivity && num(t.reqMinProduction)
          ? { name: t.reqActivity, minValue: Number(t.reqMinProduction) }
          : null,
      isComplexWork: !!t.isComplexWork,
      ruleSetId: t.ruleSetId ?? null,
      criteria: {
        ...(t.criteria && typeof t.criteria === 'object' ? t.criteria : {}),
        ...(t.awardMethod ? { awardMethod: t.awardMethod } : {}),
      },
    };
  }

  // ------------------------------------------------------ evaluation

  /** POST /qualification/evaluate — quick check (saved tender, or ad-hoc requirements). */
  async evaluate(tenantId: string, dto: EvaluateQualificationDto) {
    const company = await this.loadCompany(tenantId, dto.companyId);
    if (dto.tenderId) {
      const tender = await this.loadTender(tenantId, dto.tenderId);
      return evaluateSingle(this.toEngineTender(tender), company, this.wpi);
    }
    const r = dto.requirements ?? {};
    const adHoc: EngineTender = {
      estimateAmount: r.estimateAmount ?? null,
      deadlineDate: new Date(),
      reqTurnover: r.requiredTurnover ?? null,
      reqBidCapacity: r.requiredBidCapacity ?? null,
      reqSimilarValue: r.requiredSimilarValue ?? null,
      similarProjectTypes: r.allowedProjectTypes ?? [],
      legacyActivity:
        r.requiredActivity && r.minimumActivityProduction
          ? { name: r.requiredActivity, minValue: r.minimumActivityProduction }
          : null,
    };
    return evaluateSingle(adHoc, company, this.wpi);
  }

  async evaluateForTender(tenantId: string, tenderId: string, companyId: string) {
    const tender = await this.loadTender(tenantId, tenderId);
    const company = await this.loadCompany(tenantId, companyId);
    return evaluateSingle(this.toEngineTender(tender), company, this.wpi);
  }

  async evaluateJvForTender(tenantId: string, tenderId: string, partners: JvPartnerDto[]) {
    const ids = partners.map((p) => p.companyId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('The same company is listed twice in the JV');
    }
    const tender = await this.loadTender(tenantId, tenderId);
    const companies = await Promise.all(ids.map((id) => this.loadCompany(tenantId, id)));
    return evaluateJv(
      this.toEngineTender(tender),
      partners.map((p, i) => ({ company: companies[i], share: p.share, isLead: p.isLead })),
      this.wpi,
    );
  }

  async findPartnersForTender(tenantId: string, tenderId: string, companyId: string) {
    const tender = await this.loadTender(tenantId, tenderId);
    const all = await this.loadAllCompanies(tenantId);
    const base = all.find((c) => c.id === companyId);
    if (!base) throw new NotFoundException('Company not found or access denied');
    const suggestions = findJvPartners(this.toEngineTender(tender), base, all, this.wpi);
    return {
      tenderId,
      companyId,
      companyName: base.name,
      note: 'Only companies in your own workspace are compared. Shares are tried as 60/40 both ways round.',
      suggestions,
      disclaimer: DISCLAIMER,
    };
  }

  rules() {
    return { ruleSets: RULE_SETS, disclaimer: DISCLAIMER };
  }

  // ------------------------------------------------ annual turnover

  async listTurnovers(tenantId: string, companyId: string) {
    await this.assertCompany(tenantId, companyId);
    const rows = await this.prisma.annualTurnover.findMany({
      where: { tenantId, companyId },
    });
    return rows.sort((a, b) => (fyStart(b.fiscalYear) ?? 0) - (fyStart(a.fiscalYear) ?? 0));
  }

  /** Replace the whole turnover table of a company (send every year you want to keep). */
  async replaceTurnovers(tenantId: string, companyId: string, dto: ReplaceTurnoversDto) {
    await this.assertCompany(tenantId, companyId);
    const fys = dto.items.map((i) => i.fiscalYear);
    if (new Set(fys).size !== fys.length) {
      throw new BadRequestException('Each fiscal year can appear only once');
    }
    await this.prisma.$transaction([
      this.prisma.annualTurnover.deleteMany({ where: { tenantId, companyId } }),
      this.prisma.annualTurnover.createMany({
        data: dto.items.map((i) => ({
          tenantId,
          companyId,
          fiscalYear: i.fiscalYear,
          amount: i.amount,
          source: i.source ?? 'audited',
        })),
      }),
    ]);
    return this.listTurnovers(tenantId, companyId);
  }

  private async assertCompany(tenantId: string, companyId: string) {
    const c = await this.prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true } });
    if (!c) throw new NotFoundException('Company not found or access denied');
  }
}
