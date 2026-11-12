import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, SaveBoqDto, UpdateProjectDto } from './dto/project.dto';
import { ACTIVE_PROJECT, addMonths, CAN_DELETE_PROJECT, lineAmount, MAX_BOQ_ITEMS, projectAlerts, WON_BID } from './project.constants';
import { ProjectSyncService } from './project-sync.service';

const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));
const DATE_FIELDS = ['contractSignDate', 'startDate', 'intendedCompletionDate', 'revisedCompletionDate', 'actualCompletionDate'] as const;
const PLAIN_FIELDS = [
  'name', 'client', 'location', 'contractNo', 'projectType', 'contractAmount', 'contractPeriodMonths', 'defectLiabilityMonths',
  'advancePct', 'retentionPct', 'projectManager', 'clientEngineer', 'status', 'notes',
] as const;

/** Project Information + BOQ. Tenant-scoped. */
@Injectable()
export class ProjectService {
  constructor(private prisma: PrismaService, private sync: ProjectSyncService) {}

  private include = {
    company: { select: { id: true, name: true } },
    tender: { select: { id: true, ifbNumber: true, projectTitle: true, procuringEntity: true } },
    bid: { select: { id: true, status: true, bidAmount: true, contractAmount: true } },
  };

  private async boqStats(tenantId: string, ids: string[]) {
    const rows: any[] = ids.length ? await this.prisma.boqItem.findMany({ where: { tenantId, projectId: { in: ids } }, select: { projectId: true, amount: true, isHeading: true } }) : [];
    const out = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      const s = out.get(r.projectId) ?? { count: 0, total: 0 };
      if (!r.isHeading) { s.count++; s.total += num(r.amount); }
      out.set(r.projectId, s);
    }
    return out;
  }

  private async guaranteesOf(tenantId: string, ids: string[]) {
    return ids.length
      ? this.prisma.bankGuarantee.findMany({
          where: { tenantId, projectId: { in: ids } },
          select: { id: true, projectId: true, type: true, status: true, guaranteeNo: true, bankName: true, amount: true, expiryDate: true },
        })
      : [];
  }

  private decorate(p: any, stats: { count: number; total: number } | undefined, gs: any[]) {
    const today = new Date();
    const s = stats ?? { count: 0, total: 0 };
    const due = p.revisedCompletionDate ?? p.intendedCompletionDate;
    let timeUsedPct: number | null = null;
    if (p.startDate && due) {
      const total = new Date(due).getTime() - new Date(p.startDate).getTime();
      if (total > 0) timeUsedPct = Math.max(0, Math.round((1000 * (today.getTime() - new Date(p.startDate).getTime())) / total) / 10);
    }
    const open = gs.filter((g) => ['REQUESTED', 'ACTIVE'].includes(g.status));
    return {
      ...p,
      boqCount: s.count,
      boqTotal: Math.round(s.total * 100) / 100,
      timeUsedPct,
      daysToCompletion: due ? Math.ceil((new Date(due).getTime() - today.getTime()) / 86_400_000) : null,
      openGuarantees: open.length,
      openGuaranteeAmount: open.reduce((t, g) => t + num(g.amount), 0),
      alerts: projectAlerts(p, s.total, s.count, open, today),
    };
  }

  async list(tenantId: string, f: { status?: string; companyId?: string } = {}) {
    const where: any = { tenantId };
    if (f.companyId) where.companyId = f.companyId;
    if (f.status === 'ACTIVE') where.status = { in: ACTIVE_PROJECT };
    else if (f.status) where.status = f.status;
    const rows: any[] = await this.prisma.project.findMany({ where, include: this.include, orderBy: { createdAt: 'desc' } });
    const ids = rows.map((p) => p.id);
    const stats = await this.boqStats(tenantId, ids);
    const gs: any[] = await this.guaranteesOf(tenantId, ids);
    return rows.map((p) => this.decorate(p, stats.get(p.id), gs.filter((g) => g.projectId === p.id)));
  }

  async findOne(tenantId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, tenantId }, include: this.include });
    if (!p) throw new NotFoundException('Project not found or access denied');
    const stats = await this.boqStats(tenantId, [id]);
    const guarantees: any[] = await this.guaranteesOf(tenantId, [id]);
    return { ...this.decorate(p, stats.get(id), guarantees), guarantees };
  }

  /** Won bids that do not have a project yet */
  async wonBids(tenantId: string) {
    const bids: any[] = await this.prisma.bid.findMany({
      where: { tenantId, status: { in: WON_BID } },
      include: { tender: { select: { ifbNumber: true, projectTitle: true, procuringEntity: true } }, company: { select: { name: true } } },
    });
    const taken = new Set((await this.prisma.project.findMany({ where: { tenantId }, select: { bidId: true } })).map((p: any) => p.bidId));
    return bids.filter((b) => !taken.has(b.id));
  }

  private dataFrom(dto: UpdateProjectDto) {
    const data: any = {};
    for (const k of PLAIN_FIELDS) if ((dto as any)[k] !== undefined) data[k] = typeof (dto as any)[k] === 'string' ? ((dto as any)[k].trim() || null) : (dto as any)[k];
    for (const k of DATE_FIELDS) if ((dto as any)[k] !== undefined) data[k] = (dto as any)[k] ? new Date((dto as any)[k]) : null;
    if (data.name === null) throw new BadRequestException('Project name is required');
    return data;
  }

  private check(m: any) {
    const t = (k: string) => (m[k] ? new Date(m[k]).getTime() : null);
    if (t('startDate') && t('intendedCompletionDate') && t('intendedCompletionDate')! < t('startDate')!) throw new BadRequestException('Intended completion is before the start date');
    if (t('intendedCompletionDate') && t('revisedCompletionDate') && t('revisedCompletionDate')! < t('intendedCompletionDate')!) throw new BadRequestException('The revised (extended) completion date is before the intended completion date');
    if (t('startDate') && t('actualCompletionDate') && t('actualCompletionDate')! < t('startDate')!) throw new BadRequestException('Actual completion is before the start date');
    if (['COMPLETED', 'HANDED_OVER', 'CLOSED'].includes(m.status) && !m.actualCompletionDate) m.actualCompletionDate = new Date();
  }

  private async code(tenantId: string, code: string | undefined, exceptId?: string) {
    if (!code?.trim()) return this.sync.nextCode(tenantId);
    const c = code.trim();
    const twin: any = await this.prisma.project.findFirst({ where: { tenantId, code: c } });
    if (twin && twin.id !== exceptId) throw new ConflictException(`Project code ${c} is already used`);
    return c;
  }

  async create(tenantId: string, userId: string, dto: CreateProjectDto) {
    const company = await this.prisma.company.findFirst({ where: { id: dto.companyId, tenantId } });
    if (!company) throw new NotFoundException('Company not found or access denied');
    if (dto.tenderId) {
      const t = await this.prisma.tender.findFirst({ where: { id: dto.tenderId, tenantId } });
      if (!t) throw new NotFoundException('Tender not found or access denied');
    }
    const data: any = { tenantId, companyId: dto.companyId, tenderId: dto.tenderId ?? null, status: dto.status ?? 'ONGOING', source: 'MANUAL', ...this.dataFrom(dto) };
    data.code = await this.code(tenantId, dto.code);
    if (!data.intendedCompletionDate && data.startDate && data.contractPeriodMonths) data.intendedCompletionDate = addMonths(data.startDate, data.contractPeriodMonths);
    this.check(data);
    data.statusHistory = [{ status: data.status, at: new Date().toISOString(), byUserId: userId }];
    const p = await this.prisma.project.create({ data });
    return this.findOne(tenantId, p.id);
  }

  async createFromBid(tenantId: string, userId: string, bidId: string) {
    const bid: any = await this.prisma.bid.findFirst({ where: { id: bidId, tenantId } });
    if (!bid) throw new NotFoundException('Bid not found or access denied');
    if (!WON_BID.includes(bid.status)) throw new BadRequestException('Only an awarded or contract-signed bid can become a project');
    const r = await this.sync.fromBid(tenantId, bidId, userId);
    if (!r!.created) throw new ConflictException(`This bid is already project ${r!.project.code}`);
    return this.findOne(tenantId, r!.project.id);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateProjectDto) {
    const cur: any = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Project not found or access denied');
    if (dto.companyId && dto.companyId !== cur.companyId) {
      if (cur.bidId) throw new BadRequestException('A project created from a bid stays with the bidding company');
      const c = await this.prisma.company.findFirst({ where: { id: dto.companyId, tenantId } });
      if (!c) throw new NotFoundException('Company not found or access denied');
    }
    if (dto.tenderId && dto.tenderId !== cur.tenderId) {
      if (cur.bidId) throw new BadRequestException('A project created from a bid stays linked to its tender');
      const t = await this.prisma.tender.findFirst({ where: { id: dto.tenderId, tenantId } });
      if (!t) throw new NotFoundException('Tender not found or access denied');
    }
    const data: any = this.dataFrom(dto);
    if (dto.companyId !== undefined) data.companyId = dto.companyId;
    if (dto.tenderId !== undefined && !cur.bidId) data.tenderId = dto.tenderId || null;
    if (dto.code !== undefined) data.code = await this.code(tenantId, dto.code, id);
    const m: any = { ...cur, ...data };
    if (dto.intendedCompletionDate === undefined && (dto.startDate !== undefined || dto.contractPeriodMonths !== undefined) && m.startDate && m.contractPeriodMonths) {
      data.intendedCompletionDate = m.intendedCompletionDate = addMonths(new Date(m.startDate), m.contractPeriodMonths);
    }
    this.check(m);
    if (m.actualCompletionDate && !cur.actualCompletionDate && dto.actualCompletionDate === undefined) data.actualCompletionDate = m.actualCompletionDate;
    if (dto.status !== undefined && dto.status !== cur.status) {
      data.statusHistory = [...((cur.statusHistory as any[]) ?? []), { status: dto.status, at: new Date().toISOString(), byUserId: userId }];
    }
    await this.prisma.project.update({ where: { id }, data });
    return this.findOne(tenantId, id);
  }

  async remove(tenantId: string, role: string, id: string) {
    if (!CAN_DELETE_PROJECT.includes(role)) throw new ForbiddenException('Only the Owner or a Director can delete projects');
    const p = await this.prisma.project.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    await this.prisma.project.delete({ where: { id } });
    return { deleted: true, id };
  }

  // ---------------------------------------------------------------- BOQ
  async getBoq(tenantId: string, projectId: string) {
    const p: any = await this.prisma.project.findFirst({ where: { id: projectId, tenantId }, select: { id: true, code: true, name: true, contractAmount: true } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    const items = (await this.prisma.boqItem.findMany({ where: { tenantId, projectId }, orderBy: { sortOrder: 'asc' } }) as any[])
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const lines = items.filter((i) => !i.isHeading);
    const total = Math.round(lines.reduce((t, i) => t + num(i.amount), 0) * 100) / 100;
    return { project: p, items, count: lines.length, total, contractAmount: p.contractAmount != null ? num(p.contractAmount) : null };
  }

  /**
   * Saves the BOQ. Amount = quantity × rate (rounded to paisa); a typed amount that differs is reported,
   * not trusted. Lines without quantity, rate and amount are headings.
   */
  async saveBoq(tenantId: string, projectId: string, dto: SaveBoqDto) {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, tenantId } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    const mode = dto.mode ?? 'replace';
    const existing: any[] = mode === 'append' ? await this.prisma.boqItem.findMany({ where: { tenantId, projectId }, select: { sortOrder: true } }) : [];
    if (existing.length + dto.items.length > MAX_BOQ_ITEMS) throw new BadRequestException(`A BOQ can have at most ${MAX_BOQ_ITEMS} lines`);
    let order = existing.reduce((m, i) => Math.max(m, i.sortOrder), 0);
    const warnings: string[] = [];
    const rows = dto.items.map((it, i) => {
      const q = it.quantity ?? null;
      const r = it.rate ?? null;
      const computed = lineAmount(q, r);
      const heading = it.isHeading ?? (q === null && r === null && (it.amount === null || it.amount === undefined));
      let amount = computed ?? (it.amount ?? null);
      if (computed !== null && it.amount !== null && it.amount !== undefined && Math.abs(computed - it.amount) > 1) {
        warnings.push(`Line ${i + 1}${it.itemNo ? ' (item ' + it.itemNo + ')' : ''}: amount ${it.amount} ≠ quantity × rate ${computed} — quantity × rate was used`);
      }
      if (heading) amount = null;
      return {
        tenantId, projectId, sortOrder: ++order,
        itemNo: it.itemNo?.trim() || null, section: it.section?.trim() || null, description: it.description.trim(),
        unit: it.unit?.trim() || null, quantity: heading ? null : q, rate: heading ? null : r, amount,
        isHeading: heading, notes: it.notes?.trim() || null,
      };
    });
    if (mode === 'replace') await this.prisma.boqItem.deleteMany({ where: { tenantId, projectId } });
    if (rows.length) await this.prisma.boqItem.createMany({ data: rows });
    return { ...(await this.getBoq(tenantId, projectId)), warnings };
  }
}
