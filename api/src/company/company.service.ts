import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';

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
}
