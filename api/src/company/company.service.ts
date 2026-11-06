import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

// Roles allowed to delete companies
const CAN_DELETE_COMPANY = ['OWNER', 'SUPER_ADMIN'];

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findUnique({
      where: { tenantId_slug: { tenantId, slug: dto.slug } },
    });

    if (existing) {
      throw new ConflictException('Company with this slug already exists in your workspace');
    }

    return this.prisma.company.create({
      data: {
        ...dto,
        tenantId,
        licenseExpiry: dto.licenseExpiry ? new Date(dto.licenseExpiry) : null,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.company.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, tenantId },
      include: { certificates: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found or access denied');
    }

    return company;
  }

  async update(tenantId: string, id: string, dto: UpdateCompanyDto) {
    const company = await this.prisma.company.findFirst({ where: { id, tenantId } });
    if (!company) {
      throw new NotFoundException('Company not found or access denied');
    }
    if (dto.slug && dto.slug !== company.slug) {
      const clash = await this.prisma.company.findUnique({
        where: { tenantId_slug: { tenantId, slug: dto.slug } },
      });
      if (clash) throw new ConflictException('Company with this slug already exists in your workspace');
    }
    const data: any = {};
    for (const k of ['name', 'slug', 'panVat', 'licenseClass', 'address'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.licenseExpiry !== undefined) {
      data.licenseExpiry = dto.licenseExpiry ? new Date(dto.licenseExpiry) : null;
    }
    return this.prisma.company.update({ where: { id }, data });
  }

  async remove(tenantId: string, role: string, id: string) {
    if (!CAN_DELETE_COMPANY.includes(role)) {
      throw new ForbiddenException('Only the workspace Owner can delete companies');
    }

    const company = await this.prisma.company.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });
    if (!company) {
      throw new NotFoundException('Company not found or access denied');
    }

    // Delete in one transaction: qualification results, certificates, then the company
    const [results, certificates] = await this.prisma.$transaction([
      this.prisma.qualificationResult.deleteMany({ where: { tenantId, companyId: id } }),
      this.prisma.certificate.deleteMany({ where: { tenantId, companyId: id } }),
      this.prisma.company.delete({ where: { id } }),
    ]);

    return {
      deleted: true,
      id,
      name: company.name,
      certificatesDeleted: certificates.count,
      qualificationResultsDeleted: results.count,
    };
  }
}
