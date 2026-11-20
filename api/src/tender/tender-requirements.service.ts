// Requirements read from a tender's bidding document (Task 13 — Tender data extraction Phase A).
// The web app's Bid Document Reader extracts them; a person reviews each one and saves. Every row
// stays "needs verification" until someone confirms it — the reader is a reading aid, not a
// compliance tool. © Cuidado Technology Pvt. Ltd.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const REQUIREMENT_KINDS = [
  'TURNOVER', 'SIMILAR_CONTRACT', 'KEY_ACTIVITY', 'GENERAL_EXPERIENCE', 'FINANCIAL_RESOURCES', 'BID_CAPACITY',
  'PERSONNEL', 'EQUIPMENT', 'COMPLETION_PERIOD', 'BID_SECURITY', 'BID_VALIDITY', 'PRICE_ADJUSTMENT',
] as const;
const MAX_ROWS = 200;

@Injectable()
export class TenderRequirementsService {
  constructor(private prisma: PrismaService) {}

  private async tender(tenantId: string, tenderId: string) {
    const t = await this.prisma.tender.findFirst({ where: { id: tenderId, tenantId } });
    if (!t) throw new NotFoundException('Tender not found or access denied');
    return t;
  }

  async list(tenantId: string, tenderId: string) {
    await this.tender(tenantId, tenderId);
    const rows = await this.prisma.tenderRequirement.findMany({ where: { tenantId, tenderId } });
    return rows.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  }

  private clean(raw: any, i: number) {
    const where = `Row ${i + 1}`;
    if (!raw || typeof raw !== 'object') throw new BadRequestException(`${where}: must be an object`);
    if (!REQUIREMENT_KINDS.includes(raw.kind)) throw new BadRequestException(`${where}: unknown kind "${raw.kind}"`);
    const label = String(raw.label ?? '').trim();
    if (!label || label.length > 300) throw new BadRequestException(`${where}: label must be 1–300 characters`);
    if (raw.data == null || typeof raw.data !== 'object' || Array.isArray(raw.data)) throw new BadRequestException(`${where}: data must be an object`);
    if (JSON.stringify(raw.data).length > 4000) throw new BadRequestException(`${where}: data is too large`);
    const confidence = Number(raw.confidence ?? 0);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new BadRequestException(`${where}: confidence must be between 0 and 1`);
    const sourceText = raw.sourceText == null ? null : String(raw.sourceText).slice(0, 1000);
    return { kind: raw.kind, label, data: raw.data, sourceText, confidence, confirmed: raw.confirmed === true };
  }

  /** Replaces this tender's requirement rows with the reviewed set from the reader. */
  async replace(tenantId: string, userId: string, tenderId: string, body: any) {
    await this.tender(tenantId, tenderId);
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    if (!rows) throw new BadRequestException('Send { rows: [...] }');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows`);
    const cleaned = rows.map((r: any, i: number) => this.clean(r, i));
    await this.prisma.tenderRequirement.deleteMany({ where: { tenantId, tenderId } });
    const now = new Date();
    for (const [i, r] of cleaned.entries()) {
      await this.prisma.tenderRequirement.create({
        data: {
          tenantId, tenderId, kind: r.kind, label: r.label, data: r.data, sourceText: r.sourceText, confidence: r.confidence,
          sortOrder: i, needsVerification: !r.confirmed, confirmedAt: r.confirmed ? now : null, confirmedBy: r.confirmed ? userId : null,
        },
      });
    }
    return this.list(tenantId, tenderId);
  }

  /** Confirm / un-confirm one row, or correct its label / data. */
  async update(tenantId: string, userId: string, tenderId: string, id: string, body: any) {
    await this.tender(tenantId, tenderId);
    const row = await this.prisma.tenderRequirement.findFirst({ where: { id, tenantId, tenderId } });
    if (!row) throw new NotFoundException('Requirement not found');
    const data: any = {};
    if (body?.label !== undefined) {
      const label = String(body.label).trim();
      if (!label || label.length > 300) throw new BadRequestException('label must be 1–300 characters');
      data.label = label;
    }
    if (body?.data !== undefined) {
      if (body.data == null || typeof body.data !== 'object' || Array.isArray(body.data)) throw new BadRequestException('data must be an object');
      data.data = body.data;
    }
    if (body?.confirmed !== undefined) {
      const c = body.confirmed === true;
      Object.assign(data, { needsVerification: !c, confirmedAt: c ? new Date() : null, confirmedBy: c ? userId : null });
    }
    return this.prisma.tenderRequirement.update({ where: { id }, data });
  }

  async remove(tenantId: string, tenderId: string, id: string) {
    await this.tender(tenantId, tenderId);
    const row = await this.prisma.tenderRequirement.findFirst({ where: { id, tenantId, tenderId } });
    if (!row) throw new NotFoundException('Requirement not found');
    await this.prisma.tenderRequirement.delete({ where: { id } });
    return { ok: true };
  }
}
