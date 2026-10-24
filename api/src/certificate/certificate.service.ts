import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';

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
        activities: dto.activities ?? [],
        verificationStatus: dto.verificationStatus ?? 'unverified',
        completionStatus: dto.completionStatus ?? 'in_progress',
        jvShare: dto.jvShare ?? 100,
        pdfUrl: dto.pdfUrl,
      },
    });
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
