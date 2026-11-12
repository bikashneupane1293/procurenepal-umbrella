import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { CAN_DELETE_ERP, ENTITIES, EntityDef, entityDef, FieldDef, MENUS, menuDef, moduleOf, REPORT_MODULE, STOCK_ENTITIES } from './erp.registry';

export interface ErpUser { tenantId: string; userId: string; role: string }
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const num = (v: any) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const DAY = 86_400_000;
export const daysTo = (d: any) => Math.ceil((new Date(d).getTime() - Date.now()) / DAY);
const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !isNaN(new Date(v.slice(0, 10)).getTime());

/**
 * ERP engine: every register / document defined in erp.registry.ts is stored in ErpRecord.
 * This service validates against the definition, numbers documents, resolves links to other
 * records (tenant-scoped) and applies the stock and status rules.
 */
@Injectable()
export class ErpService {
  constructor(public prisma: PrismaService, private access: AccessService) {}

  // ---------------------------------------------------------------- access
  private modulesForEntity(key: string) {
    return new Set([moduleOf(key), ...MENUS.filter((m) => m.tabs.some((t) => t.entity === key)).map((m) => moduleOf(m.id))].filter(Boolean) as string[]);
  }
  private modulesForReport(name: string) {
    return new Set([REPORT_MODULE[name], ...MENUS.filter((m) => m.tabs.some((t) => t.report === name)).map((m) => moduleOf(m.id))].filter(Boolean) as string[]);
  }
  private async need(user: ErpUser, modules: Set<string>, what: string) {
    const mine = await this.access.effectiveModules(user.tenantId, user.userId, user.role);
    if (![...modules].some((m) => mine.includes(m))) throw new ForbiddenException(`${what} is in a module that is not active for your account. Ask the workspace Owner (Companies → User Setup).`);
  }
  async def(user: ErpUser, key: string): Promise<EntityDef> {
    const d = entityDef(key);
    if (!d) throw new NotFoundException(`Unknown register "${key}"`);
    await this.need(user, this.modulesForEntity(key), d.title);
    return d;
  }
  async needReport(user: ErpUser, name: string) {
    if (!REPORT_MODULE[name]) throw new NotFoundException(`Unknown report "${name}"`);
    await this.need(user, this.modulesForReport(name), 'This report');
  }
  async menu(user: ErpUser, id: string) {
    const m = menuDef(id);
    if (!m) throw new NotFoundException('Unknown menu item');
    await this.need(user, new Set([moduleOf(id)!]), m.title);
    return { ...m, tabs: m.tabs.map((t) => (t.entity ? { ...t, def: entityDef(t.entity) } : t)), canDelete: CAN_DELETE_ERP.includes(user.role) };
  }

  // ---------------------------------------------------------------- labels of linked records
  label(def: EntityDef, r: any): string {
    const base = r.data?.[def.labelField ?? 'name'];
    return def.series ? [r.number, base].filter(Boolean).join(' — ') : String(base || r.number || '(no name)');
  }
  /** id → label for one kind of link (company, project, tender, bank, boq or an ERP entity) */
  async labels(tenantId: string, ref: string, ids: string[]): Promise<Map<string, { label: string; extra?: any }>> {
    const out = new Map<string, { label: string; extra?: any }>();
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return out;
    const where = { tenantId, id: { in: uniq } };
    if (ref === 'company') for (const c of await this.prisma.company.findMany({ where })) out.set(c.id, { label: c.name });
    else if (ref === 'project') for (const p of (await this.prisma.project.findMany({ where })) as any[]) out.set(p.id, { label: `${p.code} — ${p.name}`, extra: { companyId: p.companyId } });
    else if (ref === 'tender') for (const t of (await this.prisma.tender.findMany({ where })) as any[]) out.set(t.id, { label: `${t.ifbNumber} — ${t.projectTitle}` });
    else if (ref === 'bank') for (const b of (await this.prisma.bank.findMany({ where })) as any[]) out.set(b.id, { label: b.name + (b.branch ? ` (${b.branch})` : ''), extra: { companyId: b.companyId } });
    else if (ref === 'boq') {
      for (const b of (await this.prisma.boqItem.findMany({ where })) as any[]) {
        out.set(b.id, { label: `${b.itemNo ?? ''} ${String(b.description).slice(0, 70)}`.trim(), extra: { unit: b.unit, rate: num(b.rate), quantity: num(b.quantity), projectId: b.projectId, isHeading: b.isHeading } });
      }
    } else {
      const d = entityDef(ref);
      if (d) for (const r of (await this.prisma.erpRecord.findMany({ where: { ...where, entity: ref } })) as any[]) out.set(r.id, { label: this.label(d, r), extra: r.data });
    }
    return out;
  }

  /** choices for a link field */
  async options(user: ErpUser, ref: string, q: { projectId?: string } = {}) {
    const t = user.tenantId;
    if (ref === 'company') return (await this.prisma.company.findMany({ where: { tenantId: t } })).map((c) => ({ id: c.id, label: c.name }));
    if (ref === 'project') return ((await this.prisma.project.findMany({ where: { tenantId: t } })) as any[]).map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }));
    if (ref === 'tender') return ((await this.prisma.tender.findMany({ where: { tenantId: t } })) as any[]).map((x) => ({ id: x.id, label: `${x.ifbNumber} — ${x.projectTitle}` }));
    if (ref === 'bank') return ((await this.prisma.bank.findMany({ where: { tenantId: t } })) as any[]).map((b) => ({ id: b.id, label: b.name + (b.branch ? ` (${b.branch})` : ''), extra: { companyId: b.companyId } }));
    if (ref === 'boq') {
      if (!q.projectId) return [];
      return ((await this.prisma.boqItem.findMany({ where: { tenantId: t, projectId: q.projectId } })) as any[])
        .filter((b) => !b.isHeading).sort((a, b) => a.sortOrder - b.sortOrder)
        .map((b) => ({ id: b.id, label: `${b.itemNo ?? ''} ${String(b.description).slice(0, 70)}`.trim(), extra: { unit: b.unit, rate: num(b.rate), quantity: num(b.quantity) } }));
    }
    const d = entityDef(ref);
    if (!d) throw new NotFoundException(`Unknown list "${ref}"`);
    return ((await this.prisma.erpRecord.findMany({ where: { tenantId: t, entity: ref } })) as any[])
      .filter((r) => !['LEFT', 'SOLD', 'CANCELLED'].includes(r.status))
      .map((r) => ({ id: r.id, label: this.label(d, r), extra: { ...r.data, status: r.status } }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private refFields(def: EntityDef) {
    return { head: def.fields.filter((f) => f.type === 'ref' || f.type === 'multiref'), line: (def.lines?.cols ?? []).filter((f) => f.type === 'ref') };
  }

  /** adds labels of linked records and a plain-language alert */
  async decorate(tenantId: string, def: EntityDef, rows: any[]) {
    const { head, line } = this.refFields(def);
    const want = new Map<string, string[]>();
    const push = (ref: string, v: any) => { if (v) want.set(ref, [...(want.get(ref) ?? []), ...(Array.isArray(v) ? v : [v])]); };
    for (const r of rows) {
      for (const f of head) push(f.ref!, r.data?.[f.k]);
      for (const l of r.lines ?? []) for (const f of line) push(f.ref!, l[f.k]);
    }
    const maps = new Map<string, Map<string, { label: string; extra?: any }>>();
    for (const [ref, ids] of want) maps.set(ref, await this.labels(tenantId, ref, ids));
    const lab = (ref: string, id: any) => (Array.isArray(id) ? id.map((x) => maps.get(ref)?.get(x)?.label ?? '(deleted)').join(', ') : id ? maps.get(ref)?.get(id)?.label ?? '(deleted)' : '');
    return rows.map((r) => ({
      ...r,
      total: r.total != null ? num(r.total) : null,
      labels: Object.fromEntries(head.map((f) => [f.k, lab(f.ref!, r.data?.[f.k])])),
      lineLabels: (r.lines ?? []).map((l: any) => Object.fromEntries(line.map((f) => [f.k, lab(f.ref!, l[f.k])]))),
      alert: this.alert(def.key, r),
    }));
  }

  private alert(entity: string, r: any): string | null {
    const d = r.data ?? {};
    const soon = (date: any, what: string, open = true) => {
      if (!date || !open) return null;
      const left = daysTo(date);
      return left < 0 ? `${what} ${-left} day(s) ago` : left <= 30 ? `${what} in ${left} day(s)` : null;
    };
    if (entity === 'fleet.tax') return soon(d.expiry, 'Expires', r.status === 'ACTIVE')?.replace('Expires ', 'Expired ').replace('Expired in', 'Expires in') ?? null;
    if (entity === 'fleet.maintenance') return soon(d.nextDueDate, 'Next service due');
    if (entity === 'project.milestone') return r.status !== 'ACHIEVED' && d.targetDate && daysTo(d.targetDate) < 0 ? `Target date passed ${-daysTo(d.targetDate)} day(s) ago` : null;
    if (entity === 'bank.lc') return soon(d.dueDate ?? d.expiryDate, d.dueDate ? 'Payment due' : 'Expires', !['SETTLED', 'CANCELLED'].includes(r.status));
    if (entity === 'project.document') return soon(d.expiry, 'Expires');
    if (entity === 'proc.requisition') return ['SUBMITTED', 'APPROVED'].includes(r.status) && d.neededBy && daysTo(d.neededBy) < 0 ? 'Needed-by date has passed' : null;
    return null;
  }

  // ---------------------------------------------------------------- read
  async list(user: ErpUser, key: string, f: { status?: string; projectId?: string; companyId?: string } = {}) {
    const def = await this.def(user, key);
    const where: any = { tenantId: user.tenantId, entity: key };
    if (f.status) where.status = f.status;
    if (f.projectId) where.projectId = f.projectId;
    if (f.companyId) where.companyId = f.companyId;
    const rows = ((await this.prisma.erpRecord.findMany({ where })) as any[]).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    return this.decorate(user.tenantId, def, rows);
  }
  async raw(tenantId: string, key: string, where: any = {}): Promise<any[]> {
    return (await this.prisma.erpRecord.findMany({ where: { tenantId, entity: key, ...where } })) as any[];
  }
  async get(user: ErpUser, key: string, id: string) {
    const def = await this.def(user, key);
    const r = await this.prisma.erpRecord.findFirst({ where: { id, tenantId: user.tenantId, entity: key } });
    if (!r) throw new NotFoundException(`${def.one} not found or access denied`);
    return (await this.decorate(user.tenantId, def, [r]))[0];
  }

  // ---------------------------------------------------------------- validate
  private coerce(f: FieldDef, v: any, where: string): any {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const bad = (m: string) => { throw new BadRequestException(`${where}${f.label}: ${m}`); };
    switch (f.type) {
      case 'number': case 'money': {
        const n = Number(v);
        if (!isFinite(n) || n < 0) bad('must be a number, 0 or more');
        if (f.max !== undefined && n > f.max) bad(`cannot be more than ${f.max}`);
        return n;
      }
      case 'date': if (!isDate(v)) bad('is not a valid date'); return String(v).slice(0, 10);
      case 'select': if (!f.options!.includes(String(v))) bad(`must be one of ${f.options!.join(', ')}`); return String(v);
      case 'bool': return v === true || v === 'true' || v === 1 || v === 'Yes';
      case 'multiref': if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) bad('must be a list'); return v.length ? [...new Set(v as string[])] : null;
      case 'ref': if (typeof v !== 'string') bad('is not valid'); return v;
      case 'email': { const s = String(v).trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) bad('is not a valid email'); return s; }
      default: { const s = String(v).trim(); if (s.length > (f.type === 'textarea' ? 4000 : 500)) bad('is too long'); return s || null; }
    }
  }

  private async validate(tenantId: string, def: EntityDef, body: any, cur: any | null) {
    const data: any = { ...(cur?.data ?? {}) };
    for (const f of def.fields) {
      if (f.calc) continue;
      const v = this.coerce(f, body?.data?.[f.k], '');
      if (v !== undefined) data[f.k] = v;
      else if (!cur && f.def !== undefined && data[f.k] === undefined) data[f.k] = f.def;
    }
    for (const f of def.fields) if (f.req && !f.calc && (data[f.k] === null || data[f.k] === undefined)) throw new BadRequestException(`${f.label} is required`);
    let lines: any[] | undefined = cur?.lines ?? undefined;
    if (def.lines && body?.lines !== undefined) {
      if (!Array.isArray(body.lines) || body.lines.length > 1000) throw new BadRequestException('Lines must be a list of at most 1000 rows');
      lines = [];
      body.lines.forEach((row: any, i: number) => {
        const out: any = {};
        for (const c of def.lines!.cols) {
          if (c.calc) continue;
          const v = this.coerce(c, row?.[c.k], `Line ${i + 1} — `);
          if (v !== undefined && v !== null) out[c.k] = v;
          else if (c.def !== undefined) out[c.k] = c.def;
        }
        if (!Object.keys(out).filter((k) => def.lines!.cols.find((c) => c.k === k)?.def === undefined).length) return; // empty row
        for (const c of def.lines!.cols) if (c.req && !c.calc && (out[c.k] === undefined)) throw new BadRequestException(`Line ${i + 1} — ${c.label} is required`);
        lines!.push(out);
      });
    }
    if (def.lines?.required && !(lines ?? []).length) throw new BadRequestException(`Add at least one line under "${def.lines.title}"`);
    let status: string | null = cur?.status ?? def.statuses?.[0] ?? null;
    if (body?.status !== undefined && def.statuses) {
      if (!def.statuses.includes(body.status)) throw new BadRequestException(`Status must be one of ${def.statuses.join(', ')}`);
      status = body.status;
    }
    // links must exist in this workspace
    const { head, line } = this.refFields(def);
    const maps = new Map<string, Map<string, { label: string; extra?: any }>>();
    const refs = new Map<string, string[]>();
    const add = (ref: string, v: any) => { if (v) refs.set(ref, [...(refs.get(ref) ?? []), ...(Array.isArray(v) ? v : [v])]); };
    for (const f of head) add(f.ref!, data[f.k]);
    for (const l of lines ?? []) for (const c of line) add(c.ref!, l[c.k]);
    for (const [ref, ids] of refs) maps.set(ref, await this.labels(tenantId, ref, ids));
    const check = (f: FieldDef, v: any, where: string) => {
      for (const id of Array.isArray(v) ? v : v ? [v] : []) if (!maps.get(f.ref!)?.has(id)) throw new NotFoundException(`${where}${f.label} not found or access denied`);
    };
    for (const f of head) check(f, data[f.k], '');
    (lines ?? []).forEach((l, i) => { for (const c of line) check(c, l[c.k], `Line ${i + 1} — `); });
    // copy unit of the product / BOQ item into the line
    for (const l of lines ?? []) {
      const p = l.product ? maps.get('proc.product')?.get(l.product)?.extra : l.boqItem ? maps.get('boq')?.get(l.boqItem)?.extra : null;
      if (p && def.lines!.cols.some((c) => c.k === 'unit' && c.calc)) l.unit = p.unit ?? null;
    }
    return { data, lines, status, maps };
  }

  /** line amounts and document totals */
  private totals(def: EntityDef, data: any, lines: any[] | undefined): number | null {
    const cols = def.lines?.cols ?? [];
    if (cols.some((c) => c.k === 'amount' && c.calc)) {
      let sub = 0;
      for (const l of lines ?? []) { l.amount = l.rate != null && l.qty != null ? r2(Math.round(l.qty * 1000) * Math.round(l.rate * 100) / 100000) : null; sub += num(l.amount); }
      data.subTotal = r2(sub);
      if (def.fields.some((f) => f.k === 'vatPct')) { data.vat = r2(sub * num(data.vatPct) / 100); return r2(sub + data.vat); }
      return r2(sub);
    }
    for (const k of ['amount', 'principal', 'cost']) if (def.fields.some((f) => f.k === k) && data[k] != null) return num(data[k]);
    return null;
  }

  // ---------------------------------------------------------------- stock
  /** "warehouse|product" → quantity, from POSTED stock documents */
  async stock(tenantId: string, exceptId?: string): Promise<Map<string, number>> {
    const docs = ((await this.prisma.erpRecord.findMany({ where: { tenantId, entity: { in: STOCK_ENTITIES }, status: 'POSTED' } })) as any[]).filter((d) => d.id !== exceptId);
    const m = new Map<string, number>();
    for (const d of docs) for (const [wh, sign] of this.moves(d.entity, d.data)) for (const l of d.lines ?? []) {
      const k = `${wh}|${l.product}`;
      m.set(k, r2((m.get(k) ?? 0) + sign * num(l.qty)));
    }
    return m;
  }
  /** which warehouse a stock document adds to (+1) or takes from (−1) */
  moves(entity: string, d: any): [string, number][] {
    if (entity === 'proc.grn') return [[d.warehouse, 1]];
    if (entity === 'proc.transfer') return [[d.fromWarehouse, -1], [d.toWarehouse, 1]];
    if (entity === 'proc.return') return [[d.warehouse, d.type === 'TO_VENDOR' ? -1 : 1]];
    return [[d.warehouse, -1]]; // dispatch, petty-contractor issue
  }

  // ---------------------------------------------------------------- rules per document
  private async before(tenantId: string, def: EntityDef, m: { data: any; lines?: any[]; status: string | null; maps: Map<string, Map<string, any>> }, cur: any | null) {
    const d = m.data;
    const key = def.key;
    const ex = (ref: string, id: string) => m.maps.get(ref)?.get(id)?.extra;
    if (key === 'proc.transfer' && d.fromWarehouse === d.toWarehouse) throw new BadRequestException('From and To warehouse are the same');
    if (key === 'proc.return' && d.type === 'TO_VENDOR' && !d.vendor) throw new BadRequestException('Choose the vendor for a return to vendor');
    if (key === 'proc.series') {
      const twin = (await this.raw(tenantId, key)).find((r) => r.data.docType === d.docType && r.id !== cur?.id);
      if (twin) throw new ConflictException('This document already has a number series — edit that one');
    }
    if (key === 'proc.quotation') {
      const twin = (await this.raw(tenantId, key)).find((r) => r.data.rfq === d.rfq && r.data.vendor === d.vendor && r.id !== cur?.id);
      if (twin) throw new ConflictException(`This vendor already has quotation ${twin.number} for this RFQ — edit that one`);
    }
    if ((key === 'proc.grn' || key === 'proc.proforma') && d.po) {
      const po = await this.prisma.erpRecord.findFirst({ where: { id: d.po, tenantId, entity: 'proc.po' } }) as any;
      if (po.status === 'DRAFT' || po.status === 'CANCELLED') throw new BadRequestException(`Purchase order ${po.number} is ${po.status} — issue it first`);
      if (!d.vendor) d.vendor = po.data.vendor;
      if (key === 'proc.grn' && m.status === 'POSTED') {
        const got = new Map<string, number>();
        for (const g of (await this.raw(tenantId, 'proc.grn', { status: 'POSTED' })).filter((g) => g.data.po === d.po && g.id !== cur?.id)) for (const l of g.lines ?? []) got.set(l.product, (got.get(l.product) ?? 0) + num(l.qty));
        for (const l of m.lines ?? []) {
          const ordered = (po.lines ?? []).filter((x: any) => x.product === l.product).reduce((s: number, x: any) => s + num(x.qty), 0);
          const name = m.maps.get('proc.product')?.get(l.product)?.label;
          if (!ordered) throw new BadRequestException(`${name} is not on purchase order ${po.number}`);
          if ((got.get(l.product) ?? 0) + num(l.qty) > ordered + 1e-9) throw new BadRequestException(`${name}: receiving ${l.qty} would exceed the ordered quantity ${ordered} (already received ${got.get(l.product) ?? 0})`);
        }
      }
    }
    if (STOCK_ENTITIES.includes(key) && m.status === 'POSTED') {
      const out = this.moves(key, d).filter(([, s]) => s < 0);
      if (out.length) {
        const have = await this.stock(tenantId, cur?.id);
        const need = new Map<string, number>();
        for (const l of m.lines ?? []) need.set(l.product, (need.get(l.product) ?? 0) + num(l.qty));
        for (const [wh] of out) for (const [p, q] of need) {
          const avail = have.get(`${wh}|${p}`) ?? 0;
          if (q > avail + 1e-9) throw new BadRequestException(`Not enough stock of ${m.maps.get('proc.product')?.get(p)?.label}: ${avail} available in ${m.maps.get('proc.warehouse')?.get(wh)?.label}, ${q} needed`);
        }
      }
    }
    if (STOCK_ENTITIES.includes(key) && cur?.status === 'POSTED' && m.status !== 'POSTED') {
      const have = await this.stock(tenantId, cur.id);
      for (const [wh, s] of this.moves(key, cur.data)) if (s > 0) for (const l of cur.lines ?? []) {
        if ((have.get(`${wh}|${l.product}`) ?? 0) < -1e-9) throw new BadRequestException('This document cannot go back to DRAFT: stock it brought in has already been issued or transferred');
      }
    }
    if (key === 'fleet.maintenance') d.cost = r2(num(d.partsCost) + num(d.labourCost));
    if (key === 'fleet.log') {
      if (d.km == null && d.startMeter != null && d.endMeter != null) {
        if (d.endMeter < d.startMeter) throw new BadRequestException('End meter is less than start meter');
        d.km = r2(d.endMeter - d.startMeter);
      }
      if (d.earning == null) { const v = ex('fleet.vehicle', d.vehicle) ?? {}; const e = r2(num(d.hours) * num(v.hourlyRate) + num(d.km) * num(v.kmRate)); if (e) d.earning = e; }
    }
    if (key === 'fleet.allowance' && d.amount == null) d.amount = r2(num(d.qty) * num(d.rate));
    if (key === 'fleet.movement' && d.to && d.to < d.from) throw new BadRequestException('"To" is before "From"');
    if (key === 'project.activity' && d.plannedEnd < d.plannedStart) throw new BadRequestException('Planned finish is before planned start');
    if (key === 'project.progress') {
      for (const l of m.lines ?? []) {
        const b = ex('boq', l.boqItem);
        if (b.projectId !== d.project) throw new BadRequestException('A BOQ item of another project was chosen');
        l.rate = b.rate;
      }
    }
    if (key === 'project.pettybill') {
      const gross = (m.lines ?? []).reduce((s, l) => s + r2(num(l.qty) * num(l.rate)), 0);
      d.payable = r2(gross - gross * num(d.retentionPct) / 100 - gross * num(d.tdsPct) / 100 - num(d.materialRecovery));
    }
    if (key === 'hr.payroll') {
      if (d.toDate < d.fromDate) throw new BadRequestException('Period "to" is before "from"');
      for (const l of m.lines ?? []) {
        l.ssfEmployee = r2(num(l.basic) * num(d.ssfEmployeePct) / 100);
        l.ssfEmployer = r2(num(l.basic) * num(d.ssfEmployerPct) / 100);
        l.net = r2(num(l.basic) + num(l.allowance) + num(l.otherAllowance) - l.ssfEmployee - num(l.tax) - num(l.deduction));
      }
      d.totalNet = r2((m.lines ?? []).reduce((s, l) => s + l.net, 0));
      d.totalSsf = r2((m.lines ?? []).reduce((s, l) => s + l.ssfEmployee + l.ssfEmployer, 0));
    }
    if (key === 'bank.loan') d.outstanding = r2(num(d.principal) - (m.lines ?? []).reduce((s, l) => s + num(l.principalPaid), 0));
    if (key === 'bank.lc') {
      if (d.expiryDate < d.openDate) throw new BadRequestException('Expiry date is before the opening date');
      if (d.marginAmount == null && d.marginPct != null) d.marginAmount = r2(num(d.amount) * d.marginPct / 100);
      if (d.dueDate == null && d.lcType !== 'SIGHT' && d.shipmentDate && d.usanceDays != null) d.dueDate = new Date(new Date(d.shipmentDate).getTime() + d.usanceDays * DAY).toISOString().slice(0, 10);
    }
    for (const f of def.fields) {
      if (f.ref === 'bank' && d[f.k] && d.company && ex('bank', d[f.k])?.companyId !== d.company) throw new BadRequestException(`${f.label}: this bank is in another company's bank list`);
    }
  }

  private async after(tenantId: string, key: string, r: any) {
    const d = r.data;
    if (key === 'proc.grn' && d.po) {
      const po = await this.prisma.erpRecord.findFirst({ where: { id: d.po, tenantId, entity: 'proc.po' } }) as any;
      if (po && ['ISSUED', 'PARTIAL', 'RECEIVED'].includes(po.status)) {
        const got = new Map<string, number>();
        for (const g of (await this.raw(tenantId, 'proc.grn', { status: 'POSTED' })).filter((g) => g.data.po === d.po)) for (const l of g.lines ?? []) got.set(l.product, (got.get(l.product) ?? 0) + num(l.qty));
        const ordered = new Map<string, number>();
        for (const l of po.lines ?? []) ordered.set(l.product, (ordered.get(l.product) ?? 0) + num(l.qty));
        const all = [...ordered].every(([p, q]) => (got.get(p) ?? 0) >= q - 1e-9);
        const status = all ? 'RECEIVED' : got.size ? 'PARTIAL' : 'ISSUED';
        if (status !== po.status) await this.prisma.erpRecord.update({ where: { id: po.id }, data: { status } });
      }
    }
    if (key === 'project.eot' && r.status === 'APPROVED' && d.newCompletionDate) {
      await this.prisma.project.updateMany({ where: { id: d.project, tenantId }, data: { revisedCompletionDate: new Date(d.newCompletionDate) } });
    }
    if (key === 'hr.payroll' && r.status === 'PAID') {
      const emp = new Set((r.lines ?? []).filter((l: any) => num(l.otherAllowance) > 0).map((l: any) => l.employee));
      for (const a of await this.raw(tenantId, 'fleet.allowance')) {
        if (!a.data.paid && emp.has(a.data.employee) && a.data.date >= d.fromDate && a.data.date <= d.toDate) await this.prisma.erpRecord.update({ where: { id: a.id }, data: { data: { ...a.data, paid: true } } });
      }
    }
  }

  // ---------------------------------------------------------------- write
  private async nextNumber(tenantId: string, def: EntityDef): Promise<string> {
    const series: any = (await this.raw(tenantId, 'proc.series')).find((s) => s.data.docType === def.key);
    const prefix = series?.data.prefix ?? def.series!;
    const pad = Math.min(10, Math.max(1, num(series?.data.padding) || 4));
    const used = new Set((await this.raw(tenantId, def.key)).map((r) => r.number));
    let n = series ? Math.max(1, num(series.data.nextNumber)) : used.size + 1;
    while (used.has(`${prefix}-${String(n).padStart(pad, '0')}`)) n++;
    if (series) await this.prisma.erpRecord.update({ where: { id: series.id }, data: { data: { ...series.data, nextNumber: n + 1 } } });
    return `${prefix}-${String(n).padStart(pad, '0')}`;
  }

  private columns(data: any, total: number | null) {
    const d = data.date ?? data.startDate ?? data.openDate ?? data.appliedDate ?? data.fromDate ?? null;
    return { companyId: data.company ?? null, projectId: data.project ?? null, date: d ? new Date(d) : null, total };
  }

  async create(user: ErpUser, key: string, body: any) {
    const def = await this.def(user, key);
    return this.createRaw(user, def, body);
  }
  /** used by create() and by the automatic steps (RFQ from requisition, PO from quotation …) */
  async createRaw(user: ErpUser, def: EntityDef, body: any) {
    const m = await this.validate(user.tenantId, def, body, null);
    await this.before(user.tenantId, def, m, null);
    const total = this.totals(def, m.data, m.lines);
    const r = await this.prisma.erpRecord.create({
      data: { tenantId: user.tenantId, entity: def.key, number: def.series ? await this.nextNumber(user.tenantId, def) : null, status: m.status, data: m.data, lines: m.lines ?? undefined, createdBy: user.userId, ...this.columns(m.data, total) },
    });
    await this.after(user.tenantId, def.key, r);
    return (await this.decorate(user.tenantId, def, [r]))[0];
  }

  async update(user: ErpUser, key: string, id: string, body: any) {
    const def = await this.def(user, key);
    const cur: any = await this.prisma.erpRecord.findFirst({ where: { id, tenantId: user.tenantId, entity: key } });
    if (!cur) throw new NotFoundException(`${def.one} not found or access denied`);
    if (STOCK_ENTITIES.includes(key) && cur.status === 'POSTED' && body?.status !== 'DRAFT' && (body?.lines !== undefined || body?.data !== undefined)) {
      const changed = JSON.stringify(body.lines ?? cur.lines) !== JSON.stringify(cur.lines) || this.moves(key, { ...cur.data, ...(body.data ?? {}) }).join() !== this.moves(key, cur.data).join();
      if (changed) throw new BadRequestException('This document is POSTED. Set the status back to DRAFT to change items or warehouses.');
    }
    const m = await this.validate(user.tenantId, def, body, cur);
    await this.before(user.tenantId, def, m, cur);
    const total = this.totals(def, m.data, m.lines);
    const r = await this.prisma.erpRecord.update({ where: { id }, data: { status: m.status, data: m.data, lines: m.lines ?? undefined, ...this.columns(m.data, total) } });
    await this.after(user.tenantId, key, r);
    return (await this.decorate(user.tenantId, def, [r]))[0];
  }

  async remove(user: ErpUser, key: string, id: string) {
    const def = await this.def(user, key);
    if (!CAN_DELETE_ERP.includes(user.role)) throw new ForbiddenException('Only the Owner or a Director can delete');
    const cur: any = await this.prisma.erpRecord.findFirst({ where: { id, tenantId: user.tenantId, entity: key } });
    if (!cur) throw new NotFoundException(`${def.one} not found or access denied`);
    if (STOCK_ENTITIES.includes(key) && cur.status === 'POSTED') throw new ConflictException('A POSTED stock document cannot be deleted — set it back to DRAFT first');
    // is it used by another record?
    for (const other of ENTITIES) {
      const { head, line } = this.refFields(other);
      const hf = head.filter((f) => f.ref === key);
      const lf = line.filter((f) => f.ref === key);
      if (!hf.length && !lf.length) continue;
      const used = (await this.raw(user.tenantId, other.key)).find((r) => r.id !== id && (hf.some((f) => [r.data[f.k]].flat().includes(id)) || (r.lines ?? []).some((l: any) => lf.some((f) => l[f.k] === id))));
      if (used) throw new ConflictException(`This ${def.one} is used by ${other.one} ${used.number ?? this.label(other, used)} — it cannot be deleted`);
    }
    await this.prisma.erpRecord.delete({ where: { id } });
    return { deleted: true, id };
  }
}
