import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGuaranteeDto, UpdateGuaranteeDto } from './dto/guarantee.dto';
import { alertsFor, CAN_DELETE_BANK, daysBetween, estimateCommission, GUARANTEE_TYPES, OPEN_STATUSES } from './bank.constants';
import { GuaranteeSyncService } from './guarantee-sync.service';

const n = (v: any) => (v === null || v === undefined ? 0 : Number(v));
const DATE_FIELDS = ['issueDate', 'expiryDate', 'claimExpiryDate', 'releaseDate'] as const;
const PLAIN_FIELDS = [
  'branch', 'type', 'guaranteeNo', 'beneficiary', 'purpose', 'amount', 'marginPct', 'marginAmount',
  'commissionPct', 'commissionBasis', 'commissionAmount', 'status', 'releaseRef', 'notes',
] as const;

/** Bank Guarantee Management — tenant-scoped; linked guarantees keep their bid in step. */
@Injectable()
export class GuaranteeService {
  constructor(private prisma: PrismaService, private sync: GuaranteeSyncService) {}

  private include = {
    company: { select: { id: true, name: true } },
    bank: { select: { id: true, name: true, branch: true, bgLimit: true } },
    tender: { select: { id: true, ifbNumber: true, projectTitle: true, procuringEntity: true } },
    bid: { select: { id: true, status: true, bidValidityExpiry: true, companyId: true } },
  };

  private decorate(g: any, today: Date, windowDays: number) {
    return {
      ...g,
      daysLeft: g.expiryDate ? daysBetween(today, new Date(g.expiryDate)) : null,
      alerts: alertsFor(g, g.bid ?? null, today, windowDays),
    };
  }

  async list(tenantId: string, f: { status?: string; type?: string; companyId?: string; bankId?: string; bidId?: string; tenderId?: string } = {}, windowDays = 30) {
    const where: any = { tenantId };
    for (const k of ['type', 'companyId', 'bankId', 'bidId', 'tenderId'] as const) if (f[k]) where[k] = f[k];
    if (f.status === 'OPEN') where.status = { in: OPEN_STATUSES };
    else if (f.status) where.status = f.status;
    const rows = await this.prisma.bankGuarantee.findMany({ where, include: this.include, orderBy: { expiryDate: 'asc' } });
    const today = new Date();
    return rows.map((g: any) => this.decorate(g, today, windowDays));
  }

  async findOne(tenantId: string, id: string) {
    const g = await this.prisma.bankGuarantee.findFirst({ where: { id, tenantId }, include: this.include });
    if (!g) throw new NotFoundException('Guarantee not found or access denied');
    return this.decorate(g, new Date(), 30);
  }

  private dataFrom(dto: UpdateGuaranteeDto) {
    const data: any = {};
    for (const k of PLAIN_FIELDS) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k];
    for (const k of DATE_FIELDS) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k] ? new Date((dto as any)[k]) : null;
    if (typeof data.guaranteeNo === 'string') data.guaranteeNo = data.guaranteeNo.trim() || null;
    return data;
  }

  /** Checks links (company, bank, bid, tender) and fills defaults. Mutates `m` (the merged record). */
  private async resolve(tenantId: string, m: any, current?: any) {
    const company = await this.prisma.company.findFirst({ where: { id: m.companyId, tenantId }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found or access denied');
    if (m.bankId) {
      const bank: any = await this.prisma.bank.findFirst({ where: { id: m.bankId, tenantId } });
      if (!bank) throw new NotFoundException('Bank not found or access denied');
      if (bank.companyId !== m.companyId) throw new BadRequestException('This bank is in another company\'s bank list — choose a bank of the same company');
      if (!current || current.bankId !== m.bankId) {
        m.bankName = bank.name;
        if (!m.branch) m.branch = bank.branch ?? null;
        if (m.marginPct == null && bank.defaultMarginPct != null) m.marginPct = n(bank.defaultMarginPct);
        if (m.commissionPct == null && bank.defaultCommissionPct != null) m.commissionPct = n(bank.defaultCommissionPct);
        if (!m.commissionBasis && bank.commissionBasis) m.commissionBasis = bank.commissionBasis;
      }
    }
    if (!m.bankName?.trim()) throw new BadRequestException('Choose a bank from the list or type the bank name');
    m.bankName = m.bankName.trim();
    if (m.bidId) {
      const bid: any = await this.prisma.bid.findFirst({ where: { id: m.bidId, tenantId }, include: { tender: true } });
      if (!bid) throw new NotFoundException('Bid not found or access denied');
      if (bid.companyId !== m.companyId) throw new BadRequestException('The guarantee must be in the name of the bidding company of the linked bid');
      m.tenderId = bid.tenderId;
      if (!m.beneficiary) m.beneficiary = bid.tender?.procuringEntity ?? null;
      const dup = await this.prisma.bankGuarantee.findFirst({ where: { tenantId, bidId: m.bidId, type: m.type } });
      if (dup && dup.id !== current?.id) throw new ConflictException('This bid already has a guarantee of this type');
    } else if (m.tenderId) {
      const tender: any = await this.prisma.tender.findFirst({ where: { id: m.tenderId, tenantId } });
      if (!tender) throw new NotFoundException('Tender not found or access denied');
      if (!m.beneficiary) m.beneficiary = tender.procuringEntity ?? null;
    }
    if (m.guaranteeNo) {
      const twin = (await this.prisma.bankGuarantee.findMany({ where: { tenantId, guaranteeNo: m.guaranteeNo } }))
        .find((g: any) => g.id !== current?.id && g.status !== 'CANCELLED' && g.bankName.trim().toLowerCase() === m.bankName.toLowerCase());
      if (twin) throw new ConflictException(`Guarantee ${m.guaranteeNo} of ${m.bankName} is already recorded`);
    }
    const t = (k: string) => (m[k] ? new Date(m[k]).getTime() : null);
    if (t('issueDate') && t('expiryDate') && t('expiryDate')! < t('issueDate')!) throw new BadRequestException('Expiry date is before the issue date');
    if (t('expiryDate') && t('claimExpiryDate') && t('claimExpiryDate')! < t('expiryDate')!) throw new BadRequestException('Claim expiry date is before the expiry date');
    if (m.status === 'RELEASED' && !m.releaseDate) m.releaseDate = new Date();
  }

  /** margin and commission amounts from their rates, unless typed in */
  private costs(m: any, typed: { margin: boolean; commission: boolean }) {
    if (!typed.margin && m.marginPct != null) m.marginAmount = Math.round(n(m.amount) * n(m.marginPct)) / 100;
    if (!typed.commission && m.commissionPct != null) {
      m.commissionAmount = estimateCommission(n(m.amount), n(m.commissionPct), m.commissionBasis, m.issueDate ? new Date(m.issueDate) : null, m.expiryDate ? new Date(m.expiryDate) : null);
    }
  }

  async create(tenantId: string, userId: string, dto: CreateGuaranteeDto) {
    if (!(GUARANTEE_TYPES as readonly string[]).includes(dto.type)) throw new BadRequestException('Unknown guarantee type');
    const m: any = {
      tenantId, companyId: dto.companyId, bankId: dto.bankId ?? null, bankName: dto.bankName ?? '', bidId: dto.bidId ?? null,
      tenderId: dto.tenderId ?? null, status: dto.status ?? (dto.guaranteeNo ? 'ACTIVE' : 'REQUESTED'), source: 'MANUAL',
      ...this.dataFrom(dto),
    };
    await this.resolve(tenantId, m);
    this.costs(m, { margin: dto.marginAmount != null, commission: dto.commissionAmount != null });
    m.history = [{ at: new Date().toISOString(), byUserId: userId, action: 'CREATED' }];
    const g = await this.prisma.bankGuarantee.create({ data: m });
    await this.toBid(tenantId, g);
    return this.findOne(tenantId, g.id);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateGuaranteeDto) {
    const cur: any = await this.prisma.bankGuarantee.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Guarantee not found or access denied');
    if (dto.companyId && dto.companyId !== cur.companyId && cur.bidId) {
      throw new BadRequestException('A guarantee linked to a bid stays with the bidding company');
    }
    const data: any = this.dataFrom(dto);
    for (const k of ['companyId', 'bankId', 'bankName', 'bidId', 'tenderId'] as const) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k];
    if (dto.bankId === null && dto.bankName === undefined) data.bankName = cur.bankName;
    const m: any = { ...cur, ...data };
    await this.resolve(tenantId, m, cur);
    const costInputs = ['amount', 'marginPct', 'commissionPct', 'commissionBasis', 'issueDate', 'expiryDate', 'bankId'];
    if (costInputs.some((k) => (dto as any)[k] !== undefined)) this.costs(m, { margin: dto.marginAmount != null, commission: dto.commissionAmount != null });
    // history: what changed, named in plain words
    const actions: string[] = [];
    if (dto.expiryDate !== undefined && m.expiryDate && cur.expiryDate && new Date(m.expiryDate) > new Date(cur.expiryDate)) actions.push('EXTENDED');
    if (dto.amount !== undefined && n(dto.amount) !== n(cur.amount)) actions.push('AMOUNT_AMENDED');
    if (dto.status !== undefined && dto.status !== cur.status) actions.push(`STATUS_${dto.status}`);
    const changes = Object.keys(data).filter((k) => String(data[k] ?? '') !== String(cur[k] ?? ''));
    const out: any = {};
    for (const k of [...Object.keys(data), 'bankName', 'branch', 'tenderId', 'beneficiary', 'marginPct', 'marginAmount', 'commissionPct', 'commissionBasis', 'commissionAmount', 'releaseDate']) {
      if (m[k] !== undefined) out[k] = m[k];
    }
    delete out.tenantId;
    if (changes.length) {
      out.history = [...((cur.history as any[]) ?? []), { at: new Date().toISOString(), byUserId: userId, action: actions.join(',') || 'UPDATED', changes }];
    }
    const g = await this.prisma.bankGuarantee.update({ where: { id }, data: out });
    await this.toBid(tenantId, g);
    return this.findOne(tenantId, id);
  }

  async remove(tenantId: string, role: string, id: string) {
    if (!CAN_DELETE_BANK.includes(role)) throw new ForbiddenException('Only the Owner or a Director can delete guarantees');
    const g = await this.prisma.bankGuarantee.findFirst({ where: { id, tenantId } });
    if (!g) throw new NotFoundException('Guarantee not found or access denied');
    await this.prisma.bankGuarantee.delete({ where: { id } });
    return { deleted: true, id };
  }

  /** Background link Bank System → Bolpatra: the linked bid shows the same guarantee details. */
  private async toBid(tenantId: string, g: any) {
    if (!g.bidId || !OPEN_STATUSES.includes(g.status)) return;
    const data: any = g.type === 'BID_SECURITY'
      ? { bidSecurityType: 'BANK_GUARANTEE', bidSecurityBank: g.bankName, bidSecurityRef: g.guaranteeNo, bidSecurityAmount: g.amount, bidSecurityIssueDate: g.issueDate, bidSecurityExpiry: g.expiryDate }
      : g.type === 'PERFORMANCE' ? { performanceSecurityAmount: g.amount, performanceSecurityExpiry: g.expiryDate } : null;
    if (data) await this.prisma.bid.updateMany({ where: { id: g.bidId, tenantId }, data });
  }

  syncFromBids(tenantId: string, userId: string) {
    return this.sync.allBids(tenantId, userId);
  }

  /** Totals, expiries, release-due list and limit use per bank. */
  async summary(tenantId: string, windowDays: number) {
    const all = await this.list(tenantId, {}, windowDays);
    const open = all.filter((g) => OPEN_STATUSES.includes(g.status));
    const sum = (l: any[], k = 'amount') => l.reduce((s, g) => s + n(g[k]), 0);
    const byType: Record<string, { count: number; amount: number }> = {};
    for (const t of GUARANTEE_TYPES) { const l = open.filter((g) => g.type === t); byType[t] = { count: l.length, amount: sum(l) }; }
    const byStatus: Record<string, number> = {};
    for (const g of all) byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
    const pick = (code: string) => all.filter((g) => g.alerts.some((a: any) => a.code === code));
    const banks: any[] = await this.prisma.bank.findMany({ where: { tenantId }, include: { company: { select: { name: true } } } });
    const perBank = banks.map((b) => {
      const l = open.filter((g) => g.bankId === b.id);
      const limit = b.bgLimit != null ? n(b.bgLimit) : null;
      const used = sum(l);
      return { bankId: b.id, bank: b.name, branch: b.branch, company: b.company?.name, limit, used, available: limit != null ? limit - used : null, usedPct: limit ? Math.round((1000 * used) / limit) / 10 : null, count: l.length };
    });
    const loose = open.filter((g) => !g.bankId);
    for (const name of new Set(loose.map((g) => g.bankName))) {
      const l = loose.filter((g) => g.bankName === name);
      perBank.push({ bankId: null, bank: name, branch: null, company: [...new Set(l.map((g) => g.company?.name))].join(', '), limit: null, used: sum(l), available: null, usedPct: null, count: l.length });
    }
    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      open: { count: open.length, amount: sum(open), marginHeld: sum(open, 'marginAmount'), commission: sum(open, 'commissionAmount') },
      byType, byStatus,
      expiring: pick('EXPIRING'),
      expiredOpen: pick('EXPIRED_OPEN'),
      releaseDue: pick('RELEASE_DUE'),
      shortValidity: pick('SHORT_VALIDITY'),
      perBank,
      overLimit: perBank.filter((b) => b.limit != null && b.used > b.limit).map((b) => b.bank),
    };
  }
}
