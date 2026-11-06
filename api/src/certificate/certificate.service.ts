import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

@Injectable()
export class CertificateService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, companyId: string, dto: CreateCertificateDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, tenantId },
    });

    if (!company) {
      throw new NotFoundException('Company not found or access denied');
    }

    if (dto.certificateId) {
      const existing = await this.prisma.certificate.findUnique({
        where: { certificateId: dto.certificateId },
      });
      if (existing) {
        throw new ConflictException('Certificate ID already exists');
      }
    }

    const certificateId =
      dto.certificateId || `CERT-${Date.now().toString().slice(-8)}`;

    // Key activity table rows (stored as JSON)
    const keyActivities = (dto.keyActivities ?? []).map((a) => ({
      name: a.name,
      unit: a.unit,
      fiscalYear: a.fiscalYear,
      quantity: a.quantity,
    }));

    // Keep the simple list of activity names too — the qualification engine uses it
    const activityNames = Array.from(
      new Set([...(dto.activities ?? []), ...keyActivities.map((a) => a.name)]),
    );

    return this.prisma.certificate.create({
      data: {
        tenantId,
        companyId,
        certificateId,
        projectName: dto.projectName,
        employerName: dto.employerName,
        contractAmount: dto.contractAmount,
        finalAmount: dto.finalAmount,
        priceAdjustment: dto.priceAdjustment ?? 0,
        fiscalYear: dto.fiscalYear,
        projectType: dto.projectType,
        activities: activityNames,
        keyActivities: keyActivities.length ? keyActivities : undefined,
        verificationStatus: dto.verificationStatus ?? 'unverified',
        completionStatus: dto.completionStatus ?? 'in_progress',
        jvShare: dto.jvShare ?? 100,
        jvName: dto.jvName,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        completionDate: dto.completionDate ? new Date(dto.completionDate) : undefined,
        pdfUrl: dto.pdfUrl,
        outstandingAmount: dto.outstandingAmount,
        isOpenBid: dto.isOpenBid ?? true,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCertificateDto) {
    const existing = await this.prisma.certificate.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Certificate not found or access denied');
    }
    if (dto.certificateId && dto.certificateId !== existing.certificateId) {
      const clash = await this.prisma.certificate.findUnique({
        where: { certificateId: dto.certificateId },
      });
      if (clash) throw new ConflictException('Certificate ID already exists');
    }

    const data: any = {};
    const copy = [
      'projectName', 'certificateId', 'employerName', 'contractAmount', 'finalAmount',
      'priceAdjustment', 'fiscalYear', 'projectType', 'verificationStatus',
      'completionStatus', 'jvShare', 'jvName', 'pdfUrl', 'outstandingAmount', 'isOpenBid',
    ] as const;
    for (const k of copy) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k];
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.completionDate !== undefined) {
      data.completionDate = dto.completionDate ? new Date(dto.completionDate) : null;
    }
    if (dto.keyActivities !== undefined || dto.activities !== undefined) {
      const keyActivities = (dto.keyActivities ?? (existing.keyActivities as any[]) ?? []).map((a: any) => ({
        name: a.name,
        unit: a.unit,
        fiscalYear: a.fiscalYear,
        quantity: a.quantity,
      }));
      data.keyActivities = keyActivities;
      data.activities = Array.from(
        new Set([...(dto.activities ?? []), ...keyActivities.map((a: any) => a.name)]),
      );
    }
    return this.prisma.certificate.update({ where: { id }, data });
  }

  async findAll(tenantId: string, companyId?: string) {
    return this.prisma.certificate.findMany({
      where: {
        tenantId,
        ...(companyId ? { companyId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const certificate = await this.prisma.certificate.findFirst({
      where: { id, tenantId },
      include: { company: true },
    });

    if (!certificate) {
      throw new NotFoundException('Certificate not found or access denied');
    }

    return certificate;
  }

  async remove(tenantId: string, id: string) {
    const result = await this.prisma.certificate.deleteMany({
      where: { id, tenantId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Certificate not found or access denied');
    }

    return { deleted: true, id };
  }
}
