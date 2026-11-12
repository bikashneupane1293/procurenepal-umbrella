import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { CAN_DELETE_BANK, OPEN_STATUSES } from './bank.constants';

const n = (v: any) => (v === null || v === undefined ? 0 : Number(v));

/** Banks (branches) per company, with the guarantee limit and how much of it is used. */
@Injectable()
export class BankService {
  constructor(private prisma: PrismaService) {}

  private async company(tenantId: string, companyId: string) {
    const c = await this.prisma.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true, name: true } });
    if (!c) throw new NotFoundException('Company not found or access denied');
    return c;
  }

  /** limit, used (open guarantees), available */
  private withUse(bank: any, guarantees: any[]) {
    const open = guarantees.filter((g) => g.bankId === bank.id && OPEN_STATUSES.includes(g.status));
    const used = open.reduce((s, g) => s + n(g.amount), 0);
    const limit = bank.bgLimit != null ? n(bank.bgLimit) : null;
    return {
      ...bank,
      openGuarantees: open.length,
      used,
      marginHeld: open.reduce((s, g) => s + n(g.marginAmount), 0),
      available: limit != null ? limit - used : null,
      usedPct: limit ? Math.round((1000 * used) / limit) / 10 : null,
    };
  }

  async list(tenantId: string, companyId?: string) {
    const banks = await this.prisma.bank.findMany({
      where: { tenantId, ...(companyId ? { companyId } : {}) },
      include: { company: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    const gs = await this.prisma.bankGuarantee.findMany({ where: { tenantId, bankId: { in: banks.map((b: any) => b.id) } } });
    return banks.map((b: any) => this.withUse(b, gs));
  }

  async findOne(tenantId: string, id: string) {
    const bank = await this.prisma.bank.findFirst({ where: { id, tenantId }, include: { company: { select: { id: true, name: true } } } });
    if (!bank) throw new NotFoundException('Bank not found or access denied');
    const gs = await this.prisma.bankGuarantee.findMany({ where: { tenantId, bankId: id } });
    return this.withUse(bank, gs);
  }

  private async noDuplicate(tenantId: string, companyId: string, name: string, branch: string | null | undefined, exceptId?: string) {
    const same = (await this.prisma.bank.findMany({ where: { tenantId, companyId } })).find(
      (b: any) => b.id !== exceptId && b.name.trim().toLowerCase() === name.trim().toLowerCase()
        && (b.branch ?? '').trim().toLowerCase() === (branch ?? '').trim().toLowerCase(),
    );
    if (same) throw new ConflictException(`${name}${branch ? ' (' + branch + ')' : ''} is already in this company's bank list`);
  }

  async create(tenantId: string, dto: CreateBankDto) {
    await this.company(tenantId, dto.companyId);
    await this.noDuplicate(tenantId, dto.companyId, dto.name, dto.branch);
    const bank = await this.prisma.bank.create({ data: { ...dto, name: dto.name.trim(), tenantId }, include: { company: { select: { id: true, name: true } } } });
    // background link: guarantees already typed with this bank name (no bank chosen) are attached to it
    const loose = (await this.prisma.bankGuarantee.findMany({ where: { tenantId, companyId: dto.companyId, bankId: null } }))
      .filter((g: any) => g.bankName.trim().toLowerCase() === bank.name.toLowerCase());
    for (const g of loose) await this.prisma.bankGuarantee.update({ where: { id: g.id }, data: { bankId: bank.id, branch: g.branch ?? bank.branch ?? null } });
    return this.findOne(tenantId, bank.id);
  }

  async update(tenantId: string, id: string, dto: UpdateBankDto) {
    const bank: any = await this.prisma.bank.findFirst({ where: { id, tenantId } });
    if (!bank) throw new NotFoundException('Bank not found or access denied');
    if (dto.companyId && dto.companyId !== bank.companyId) {
      const used = await this.prisma.bankGuarantee.count({ where: { tenantId, bankId: id } });
      if (used) throw new ConflictException('This bank already has guarantees — it cannot be moved to another company');
      await this.company(tenantId, dto.companyId);
    }
    await this.noDuplicate(tenantId, dto.companyId ?? bank.companyId, dto.name ?? bank.name, dto.branch !== undefined ? dto.branch : bank.branch, id);
    await this.prisma.bank.update({ where: { id }, data: { ...dto, ...(dto.name ? { name: dto.name.trim() } : {}) } });
    // keep the copied bank name on its guarantees in step
    if (dto.name && dto.name.trim() !== bank.name) {
      for (const g of await this.prisma.bankGuarantee.findMany({ where: { tenantId, bankId: id } })) {
        await this.prisma.bankGuarantee.update({ where: { id: (g as any).id }, data: { bankName: dto.name.trim() } });
      }
    }
    return this.findOne(tenantId, id);
  }

  async remove(tenantId: string, role: string, id: string) {
    if (!CAN_DELETE_BANK.includes(role)) throw new ForbiddenException('Only the Owner or a Director can delete banks');
    const bank = await this.prisma.bank.findFirst({ where: { id, tenantId } });
    if (!bank) throw new NotFoundException('Bank not found or access denied');
    const open = await this.prisma.bankGuarantee.count({ where: { tenantId, bankId: id, status: { in: OPEN_STATUSES } } });
    if (open) throw new ConflictException(`This bank still has ${open} open guarantee(s) — release or move them first`);
    await this.prisma.bank.delete({ where: { id } });
    return { deleted: true, id };
  }
}
