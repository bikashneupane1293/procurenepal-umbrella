import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { daysTo, ErpService, ErpUser, num, r2 } from './erp.service';
import { ENTITIES, entityDef, MENUS, moduleOf } from './erp.registry';
import { AccessService } from '../access/access.service';

type Row = Record<string, any>;
export interface Table { title: string; columns: { k: string; label: string; num?: boolean }[]; rows: Row[]; note?: string }
export interface Report { title: string; cards?: { label: string; value: string | number; hint?: string; tone?: string }[]; tables: Table[]; chart?: any; actions?: { label: string; action: string; body: any }[]; note?: string }
const today = () => new Date().toISOString().slice(0, 10);
const c = (k: string, label: string, isNum = false) => ({ k, label, num: isNum });
const OPEN_G = ['REQUESTED', 'ACTIVE'];
const COUNTED = ['SUBMITTED', 'APPROVED'];
const money = (v: number) => 'Rs ' + Math.round(v).toLocaleString('en-IN');

/** The automatic steps between documents ("actions") and the calculated pages ("reports"). */
@Injectable()
export class ErpFlowService {
  constructor(private erp: ErpService, private access: AccessService) {}
  private get db() { return this.erp.prisma; }

  private async rec(user: ErpUser, entity: string, id: string) {
    const r: any = await this.db.erpRecord.findFirst({ where: { id, tenantId: user.tenantId, entity } });
    if (!r) throw new NotFoundException(`${entityDef(entity)!.one} not found or access denied`);
    return r;
  }
  private async names(t: string, ref: string, ids: string[]) {
    const m = await this.erp.labels(t, ref, ids);
    return (id: string) => m.get(id)?.label ?? '';
  }

  // ================================================================ ACTIONS
  async action(user: ErpUser, name: string, body: any): Promise<{ message: string; goto?: { menu: string; entity: string; id: string }; open?: string }> {
    const t = user.tenantId;
    switch (name) {
      case 'make-rfq': {
        const req = await this.rec(user, 'proc.requisition', body.id);
        await this.erp.def(user, 'proc.rfq');
        if (req.status !== 'APPROVED') throw new BadRequestException('Only an APPROVED requisition can become an RFQ');
        const vendors = (await this.erp.raw(t, 'proc.vendor')).map((v) => v.id);
        if (!vendors.length) throw new BadRequestException('Add at least one vendor first (Vendor Management)');
        const rfq = await this.erp.createRaw(user, entityDef('proc.rfq')!, {
          data: { date: today(), subject: req.data.purpose ?? `Materials for ${req.number}`, requisition: req.id, project: req.data.project, vendors },
          lines: (req.lines ?? []).map((l: any) => ({ product: l.product, qty: l.qty, remarks: l.remarks })),
        });
        return { message: `RFQ ${rfq.number} created from ${req.number} with all ${vendors.length} vendor(s) — untick the ones you do not want, then email them.`, goto: { menu: 'proc.rfq', entity: 'proc.rfq', id: rfq.id } };
      }
      case 'email-rfq': {
        const rfq = await this.rec(user, 'proc.rfq', body.id);
        const vs = (await this.erp.raw(t, 'proc.vendor')).filter((v) => (rfq.data.vendors ?? []).includes(v.id));
        const mails = vs.map((v) => v.data.email).filter(Boolean);
        if (!mails.length) throw new BadRequestException('None of the chosen vendors has an email address — add emails in Vendor Management');
        const pn = await this.names(t, 'proc.product', (rfq.lines ?? []).map((l: any) => l.product));
        const text = [
          'Dear Sir/Madam,', '', `Please send your best rates (excluding VAT) for the following items${rfq.data.dueDate ? ' by ' + rfq.data.dueDate : ''}:`, '',
          ...(rfq.lines ?? []).map((l: any, i: number) => `${i + 1}. ${pn(l.product)} — ${l.qty} ${l.unit ?? ''}`), '',
          rfq.data.terms ? `Terms: ${rfq.data.terms}` : '', `Reference: ${rfq.number}`, '', 'Thank you.',
        ].filter((x) => x !== null).join('\n');
        if (rfq.status === 'DRAFT') await this.db.erpRecord.update({ where: { id: rfq.id }, data: { status: 'SENT' } });
        const missing = vs.filter((v) => !v.data.email).map((v) => v.data.name);
        return {
          message: `Your mail program opens with ${mails.length} vendor(s) in BCC — check it and press Send.${missing.length ? ' No email on file for: ' + missing.join(', ') + '.' : ''} The RFQ is marked SENT.`,
          open: `mailto:?bcc=${encodeURIComponent(mails.join(','))}&subject=${encodeURIComponent(`Request for Quotation ${rfq.number}${rfq.data.subject ? ' — ' + rfq.data.subject : ''}`)}&body=${encodeURIComponent(text)}`,
        };
      }
      case 'award': {
        const q = await this.rec(user, 'proc.quotation', body.id);
        await this.erp.def(user, 'proc.po');
        const rfq = await this.rec(user, 'proc.rfq', q.data.rfq);
        if (rfq.status === 'AWARDED') throw new ConflictException(`RFQ ${rfq.number} is already awarded`);
        const req: any = rfq.data.requisition ? await this.db.erpRecord.findFirst({ where: { id: rfq.data.requisition, tenantId: t } }) : null;
        const po = await this.erp.createRaw(user, entityDef('proc.po')!, {
          data: { date: today(), vendor: q.data.vendor, subject: rfq.data.subject, project: rfq.data.project ?? req?.data.project, warehouse: req?.data.warehouse, quotation: q.id, rfq: rfq.id,
            paymentTerms: q.data.paymentTerms, vatPct: q.data.vatPct ?? 13 },
          lines: (q.lines ?? []).filter((l: any) => l.rate != null).map((l: any) => ({ product: l.product, qty: l.qty, rate: l.rate })),
        });
        for (const o of (await this.erp.raw(t, 'proc.quotation')).filter((o) => o.data.rfq === rfq.id)) await this.db.erpRecord.update({ where: { id: o.id }, data: { status: o.id === q.id ? 'AWARDED' : 'REJECTED' } });
        await this.db.erpRecord.update({ where: { id: rfq.id }, data: { status: 'AWARDED' } });
        if (req && ['APPROVED', 'SUBMITTED'].includes(req.status)) await this.db.erpRecord.update({ where: { id: req.id }, data: { status: 'ORDERED' } });
        return { message: `Awarded. Purchase order ${po.number} was created as a DRAFT — check it and set it to ISSUED.`, goto: { menu: 'proc.po', entity: 'proc.po', id: po.id } };
      }
      case 'make-grn': {
        const po = await this.rec(user, 'proc.po', body.id);
        await this.erp.def(user, 'proc.grn');
        if (!po.data.warehouse) throw new BadRequestException('Choose "Deliver to warehouse" on the purchase order first');
        const got = new Map<string, number>();
        for (const g of (await this.erp.raw(t, 'proc.grn', { status: 'POSTED' })).filter((g) => g.data.po === po.id)) for (const l of g.lines ?? []) got.set(l.product, (got.get(l.product) ?? 0) + num(l.qty));
        const lines = (po.lines ?? []).map((l: any) => ({ product: l.product, qty: r2(num(l.qty) - (got.get(l.product) ?? 0)), rate: l.rate })).filter((l: any) => l.qty > 0);
        if (!lines.length) throw new BadRequestException('Everything on this purchase order has been received');
        const grn = await this.erp.createRaw(user, entityDef('proc.grn')!, { data: { date: today(), po: po.id, warehouse: po.data.warehouse }, lines });
        return { message: `GRN ${grn.number} prepared with the quantities still to receive — correct them to what actually arrived, then set the status to POSTED.`, goto: { menu: 'proc.grn', entity: 'proc.grn', id: grn.id } };
      }
      case 'make-proforma': {
        const po = await this.rec(user, 'proc.po', body.id);
        await this.erp.def(user, 'proc.proforma');
        const billed = (await this.erp.raw(t, 'proc.proforma')).filter((p) => p.data.po === po.id && p.status !== 'CANCELLED').reduce((s, p) => s + num(p.data.amount), 0);
        const left = r2(num(po.total) - billed);
        if (left <= 0) throw new BadRequestException('This purchase order is already fully invoiced');
        const pi = await this.erp.createRaw(user, entityDef('proc.proforma')!, { data: { po: po.id, date: today(), amount: left } });
        return { message: `Pro forma ${pi.number} created for the un-invoiced balance ${money(left)} — add the vendor's invoice number and the payment details.`, goto: { menu: 'proc.proforma', entity: 'proc.proforma', id: pi.id } };
      }
      case 'payroll-calc': {
        const p = await this.rec(user, 'hr.payroll', body.id);
        if (p.status !== 'DRAFT') throw new BadRequestException('Only a DRAFT payroll can be recalculated');
        const emps = (await this.erp.raw(t, 'hr.employee', { status: 'ACTIVE' })).filter((e) => !p.data.company || !e.data.company || e.data.company === p.data.company);
        if (!emps.length) throw new BadRequestException('No active employees found (Employee User Setup)');
        const allow = (await this.erp.raw(t, 'fleet.allowance')).filter((a) => !a.data.paid && a.data.date >= p.data.fromDate && a.data.date <= p.data.toDate);
        const old = new Map<string, any>((p.lines ?? []).map((l: any) => [l.employee, l]));
        const lines = emps.sort((a, b) => String(a.data.name).localeCompare(b.data.name)).map((e) => ({
          employee: e.id, days: old.get(e.id)?.days ?? 30, basic: num(e.data.basicSalary), allowance: num(e.data.allowance),
          otherAllowance: r2(allow.filter((a) => a.data.employee === e.id).reduce((s, a) => s + num(a.data.amount), 0)),
          tax: old.get(e.id)?.tax ?? 0, deduction: old.get(e.id)?.deduction ?? 0,
        }));
        const r = await this.erp.update(user, 'hr.payroll', p.id, { lines });
        return { message: `Salary sheet filled for ${lines.length} employee(s). Net pay ${money(num(r.data.totalNet))}. Type income tax (TDS) and deductions, then Save.`, goto: { menu: 'hr.payroll', entity: 'hr.payroll', id: p.id } };
      }
      case 'material-requisition': {
        await this.erp.def(user, 'proc.requisition');
        const plan = await this.materialPlan(user, body.project);
        const lines = plan.tables[0].rows.filter((r) => r.balance > 0).map((r) => ({ product: r._product, qty: r.balance }));
        if (!lines.length) throw new BadRequestException('Nothing to requisition — every material is already issued or in the site warehouse');
        const req = await this.erp.createRaw(user, entityDef('proc.requisition')!, { data: { date: today(), project: body.project, purpose: 'Balance materials from the material plan (BOQ × norms)' }, lines });
        return { message: `Requisition ${req.number} created for ${lines.length} material(s).`, goto: { menu: 'proc.requisition', entity: 'proc.requisition', id: req.id } };
      }
      case 'make-certificate': return this.makeCertificate(user, body.project);
      default: throw new NotFoundException(`Unknown action "${name}"`);
    }
  }

  /** Background link Project → Bolpatra: a completed project becomes an experience certificate. */
  private async makeCertificate(user: ErpUser, projectId: string) {
    const t = user.tenantId;
    const p: any = await this.db.project.findFirst({ where: { id: projectId, tenantId: t } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    if (!['COMPLETED', 'HANDED_OVER', 'CLOSED'].includes(p.status)) throw new BadRequestException('Mark the project Completed first (Project Information)');
    const certId = `PRJ-${p.code}`;
    if (await this.db.certificate.findUnique({ where: { certificateId: certId } })) throw new ConflictException(`Certificate ${certId} already exists for this project`);
    // Nepali fiscal year starts in mid-July (1 Shrawan); the user should check the year on the certificate
    const fy = (d: Date) => { const bs = d.getUTCFullYear() + (d.getUTCMonth() > 6 || (d.getUTCMonth() === 6 && d.getUTCDate() >= 16) ? 57 : 56); return `${bs}/${String((bs + 1) % 100).padStart(2, '0')}`; };
    const done = p.actualCompletionDate ?? new Date();
    const boq = new Map<string, any>(((await this.db.boqItem.findMany({ where: { tenantId: t, projectId } })) as any[]).map((b) => [b.id, b]));
    const acts = new Map<string, { name: string; unit: string; fiscalYear: string; quantity: number }>();
    let value = 0;
    for (const r of (await this.erp.raw(t, 'project.progress')).filter((r) => r.data.project === projectId && COUNTED.includes(r.status))) for (const l of r.lines ?? []) {
      const b = boq.get(l.boqItem); if (!b) continue;
      value += num(l.amount);
      const year = fy(new Date(r.data.date));
      const k = `${b.id}|${year}`;
      acts.set(k, { name: String(b.description).slice(0, 200), unit: b.unit ?? '', fiscalYear: year, quantity: r2((acts.get(k)?.quantity ?? 0) + num(l.qty)) });
    }
    const share = p.bidderType === 'JV' ? num((p.jvPartners as any[] ?? []).find((j) => j.companyId === p.companyId)?.share) || 100 : 100;
    const keyActivities = [...acts.values()].filter((a) => a.unit && a.quantity > 0).slice(0, 200);
    await this.db.certificate.create({
      data: {
        tenantId: t, companyId: p.companyId, certificateId: certId, projectName: p.name, employerName: p.client, contractAmount: p.contractAmount ?? 0,
        finalAmount: value > 0 ? r2(value) : p.contractAmount ?? undefined, fiscalYear: fy(new Date(done)), projectType: p.projectType ?? 'OTHER',
        activities: [...new Set(keyActivities.map((a) => a.name))], keyActivities: keyActivities.length ? keyActivities : undefined,
        verificationStatus: 'unverified', completionStatus: 'completed', jvShare: share, jvName: p.bidderType === 'JV' ? (p.jvPartners as any[] ?? []).map((j) => j.name).join(' – ') : undefined,
        startDate: p.startDate ?? undefined, completionDate: done,
      },
    });
    return { message: `Experience certificate ${certId} was added to Bolpatra → Certificates as "unverified" with ${keyActivities.length} key-activity quantities from the progress reports. Check the fiscal year and amounts against the employer's certificate.` };
  }

  // ================================================================ REPORTS
  async report(user: ErpUser, name: string, q: Row): Promise<Report> {
    await this.erp.needReport(user, name);
    const need = (k: string, what: string) => { if (!q[k]) throw new BadRequestException(`Choose the ${what}`); return q[k]; };
    switch (name) {
      case 'stock': return this.stockReport(user, q.warehouse);
      case 'compare': return this.compare(user, need('rfq', 'RFQ'));
      case 'payables': return this.payables(user);
      case 'fleet-expiry': return this.fleetExpiry(user);
      case 'fleet-where': return this.fleetWhere(user);
      case 'fleet-earnings': return this.fleetEarnings(user, q.from, q.to);
      case 'material-plan': return this.materialPlan(user, need('project', 'project'));
      case 'progress': return this.progress(user, need('project', 'project'));
      case 'scurve': return this.scurve(user, need('project', 'project'));
      case 'portfolio': return this.portfolio(user);
      case 'petty-materials': return this.pettyMaterials(user);
      case 'amortization': return this.amortization(user, need('loan', 'loan'));
      case 'finance': return this.finance(user);
      default: return this.bankLoan(user);
    }
  }

  private async stockReport(user: ErpUser, warehouse?: string): Promise<Report> {
    const t = user.tenantId;
    const stock = await this.erp.stock(t);
    const products = new Map((await this.erp.raw(t, 'proc.product')).map((p) => [p.id, p]));
    const whs = new Map((await this.erp.raw(t, 'proc.warehouse')).map((w) => [w.id, w]));
    const rate = new Map<string, number>();
    for (const g of (await this.erp.raw(t, 'proc.grn', { status: 'POSTED' })).sort((a, b) => String(a.data.date).localeCompare(b.data.date))) for (const l of g.lines ?? []) if (l.rate != null) rate.set(l.product, num(l.rate));
    const rows: Row[] = [];
    for (const [k, qty] of stock) {
      const [w, p] = k.split('|');
      if ((warehouse && w !== warehouse) || Math.abs(qty) < 1e-9) continue;
      const pr = products.get(p)?.data ?? {};
      const rt = rate.get(p) ?? num(pr.lastRate);
      const low = pr.reorderLevel != null && qty < num(pr.reorderLevel);
      rows.push({ warehouse: whs.get(w)?.data.name ?? '(deleted)', product: pr.name ?? '(deleted)', unit: pr.unit ?? '', qty, reorder: pr.reorderLevel ?? '', rate: rt, value: r2(qty * rt), note: low ? 'Below re-order level' : '', _tone: low ? 'warn' : '' });
    }
    rows.sort((a, b) => (a.warehouse + a.product).localeCompare(b.warehouse + b.product));
    return {
      title: 'Stock by warehouse',
      cards: [{ label: 'Stock lines', value: rows.length }, { label: 'Stock value', value: money(rows.reduce((s, r) => s + r.value, 0)), hint: 'at the latest received rate' },
        { label: 'Below re-order level', value: rows.filter((r) => r._tone).length, tone: rows.some((r) => r._tone) ? 'warn' : '' }],
      tables: [{ title: 'Stock', columns: [c('warehouse', 'Warehouse'), c('product', 'Product'), c('unit', 'Unit'), c('qty', 'In stock', true), c('reorder', 'Re-order level', true), c('rate', 'Rate', true), c('value', 'Value (NPR)', true), c('note', '')], rows,
        note: 'Stock = POSTED goods receipts + returns from site − dispatches − issues to petty contractors − returns to vendors ± transfers.' }],
    };
  }

  private async compare(user: ErpUser, rfqId: string): Promise<Report> {
    const t = user.tenantId;
    const rfq = await this.rec(user, 'proc.rfq', rfqId);
    const qs = (await this.erp.raw(t, 'proc.quotation')).filter((q) => q.data.rfq === rfqId);
    const vn = await this.names(t, 'proc.vendor', qs.map((q) => q.data.vendor));
    const pn = await this.names(t, 'proc.product', (rfq.lines ?? []).map((l: any) => l.product));
    const rateOf = (q: any, p: string) => (q.lines ?? []).find((l: any) => l.product === p)?.rate ?? null;
    const lowCount = new Map<string, number>();
    const rows = (rfq.lines ?? []).map((l: any) => {
      const rates = qs.map((q) => rateOf(q, l.product)).filter((x) => x != null) as number[];
      const low = rates.length ? Math.min(...rates) : null;
      const row: Row = { product: pn(l.product), unit: l.unit ?? '', qty: l.qty };
      for (const q of qs) {
        const r = rateOf(q, l.product);
        row['q_' + q.id] = r == null ? '—' : num(r).toLocaleString('en-IN', { minimumFractionDigits: 2 }) + (r === low && rates.length > 1 ? ' ✓' : '');
        if (r != null && r === low) lowCount.set(q.id, (lowCount.get(q.id) ?? 0) + 1);
      }
      return row;
    });
    const n = (rfq.lines ?? []).length;
    const totals = qs.map((q) => {
      const quoted = (rfq.lines ?? []).filter((l: any) => rateOf(q, l.product) != null).length;
      const sub = (rfq.lines ?? []).reduce((s: number, l: any) => s + num(l.qty) * num(rateOf(q, l.product)), 0);
      return { vendor: vn(q.data.vendor), quotation: q.number, quoted: `${quoted} of ${n}`, lowest: lowCount.get(q.id) ?? 0, sub: r2(sub), total: r2(sub * (1 + num(q.data.vatPct) / 100)),
        delivery: q.data.deliveryDays ?? '', terms: q.data.paymentTerms ?? '', status: q.status, _complete: quoted === n,
        _action: rfq.status === 'AWARDED' ? null : { label: 'Award → create PO', action: 'award', body: { id: q.id } } };
    }).sort((a, b) => a.sub - b.sub);
    const complete = totals.filter((x) => x._complete);
    if (complete.length) (complete[0] as Row)._tone = 'good';
    return {
      title: `Comparison — ${rfq.number}`,
      cards: [{ label: 'Quotations received', value: `${qs.length} of ${(rfq.data.vendors ?? []).length} vendors` }, { label: 'Lowest complete offer', value: complete.length ? money(complete[0].sub) : '—', hint: complete.length ? complete[0].vendor + ' (excl. VAT)' : 'no vendor quoted every item' },
        { label: 'RFQ status', value: rfq.status }],
      tables: [
        { title: 'Totals for the RFQ quantities (lowest first)', columns: [c('vendor', 'Vendor'), c('quotation', 'Quotation'), c('quoted', 'Items quoted'), c('lowest', 'Lowest on', true), c('sub', 'Total excl. VAT', true), c('total', 'Total incl. VAT', true), c('delivery', 'Delivery (days)', true), c('terms', 'Payment terms'), c('status', 'Status')], rows: totals,
          note: 'Totals use the RFQ quantities so vendors are compared like for like. The lowest total is highlighted only among vendors who quoted every item — price is not the only criterion; you decide the award.' },
        { title: 'Rates per item (✓ = lowest)', columns: [c('product', 'Item'), c('unit', 'Unit'), c('qty', 'Qty', true), ...qs.map((q) => c('q_' + q.id, vn(q.data.vendor)))], rows },
      ],
    };
  }

  private async payables(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const pos = (await this.erp.raw(t, 'proc.po')).filter((p) => !['DRAFT', 'CANCELLED'].includes(p.status));
    const pis = (await this.erp.raw(t, 'proc.proforma')).filter((p) => p.status !== 'CANCELLED');
    const vn = await this.names(t, 'proc.vendor', pos.map((p) => p.data.vendor));
    const rows = pos.map((p) => {
      const mine = pis.filter((x) => x.data.po === p.id);
      const invoiced = mine.reduce((s, x) => s + num(x.data.amount), 0), paid = mine.reduce((s, x) => s + num(x.data.paidAmount), 0);
      return { po: p.number, vendor: vn(p.data.vendor), status: p.status, total: num(p.total), invoiced: r2(invoiced), paid: r2(paid), unpaid: r2(invoiced - paid), uninvoiced: r2(num(p.total) - invoiced) };
    });
    return { title: 'Payables', cards: [{ label: 'Invoiced, not yet paid', value: money(rows.reduce((s, r) => s + r.unpaid, 0)) }, { label: 'Ordered, not yet invoiced', value: money(rows.reduce((s, r) => s + Math.max(0, r.uninvoiced), 0)) }],
      tables: [{ title: 'By purchase order', columns: [c('po', 'PO'), c('vendor', 'Vendor'), c('status', 'Status'), c('total', 'PO total', true), c('invoiced', 'Invoiced', true), c('paid', 'Paid', true), c('unpaid', 'Unpaid', true), c('uninvoiced', 'Not invoiced', true)], rows }] };
  }

  private async fleetExpiry(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const vn = await this.names(t, 'fleet.vehicle', (await this.erp.raw(t, 'fleet.vehicle')).map((v) => v.id));
    const rows: Row[] = [];
    for (const x of await this.erp.raw(t, 'fleet.tax', { status: 'ACTIVE' })) { const left = daysTo(x.data.expiry); if (left <= 30) rows.push({ vehicle: vn(x.data.vehicle), what: String(x.data.kind).replace(/_/g, ' ').toLowerCase(), date: x.data.expiry, days: left, _tone: left < 0 ? 'bad' : 'warn' }); }
    for (const x of await this.erp.raw(t, 'fleet.maintenance')) { if (!x.data.nextDueDate) continue; const left = daysTo(x.data.nextDueDate); if (left <= 30 && left > -365) rows.push({ vehicle: vn(x.data.vehicle), what: 'next service', date: x.data.nextDueDate, days: left, _tone: left < 0 ? 'bad' : 'warn' }); }
    rows.sort((a, b) => a.days - b.days);
    return { title: 'Expiring and due', cards: [{ label: 'Already expired / overdue', value: rows.filter((r) => r.days < 0).length, tone: rows.some((r) => r.days < 0) ? 'bad' : '' }, { label: 'Due in 30 days', value: rows.filter((r) => r.days >= 0).length }],
      tables: [{ title: 'Renewals and services', columns: [c('vehicle', 'Vehicle'), c('what', 'What'), c('date', 'Date'), c('days', 'Days left', true)], rows, note: 'When you renew, set the old row to RENEWED and add a new row with the new expiry.' }] };
  }

  private async fleetWhere(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const vs = (await this.erp.raw(t, 'fleet.vehicle')).filter((v) => v.status !== 'SOLD');
    const mv = (await this.erp.raw(t, 'fleet.movement', { status: 'ASSIGNED' })).sort((a, b) => String(b.data.from).localeCompare(a.data.from));
    const pn = await this.names(t, 'project', mv.map((m) => m.data.project));
    const rows = vs.map((v) => { const m = mv.find((x) => x.data.vehicle === v.id && (!x.data.to || x.data.to >= today())); return { vehicle: v.data.name, regNo: v.data.regNo, status: v.status, project: m ? pn(m.data.project) : '', location: m?.data.location ?? '', since: m?.data.from ?? '', _tone: m ? '' : 'warn', note: m ? '' : 'not assigned' }; });
    return { title: 'Where is each vehicle', cards: [{ label: 'Vehicles', value: vs.length }, { label: 'Not assigned', value: rows.filter((r) => r._tone).length }],
      tables: [{ title: 'Current assignment', columns: [c('vehicle', 'Vehicle'), c('regNo', 'Reg. no.'), c('status', 'Status'), c('project', 'Project'), c('location', 'Location'), c('since', 'Since'), c('note', '')], rows }] };
  }

  private async fleetEarnings(user: ErpUser, from?: string, to?: string): Promise<Report> {
    const t = user.tenantId;
    const inR = (d: any) => (!from || (d && d >= from)) && (!to || (d && d <= to));
    const vs = await this.erp.raw(t, 'fleet.vehicle');
    const [logs, trips, txn, maint, tax, allow] = await Promise.all(['fleet.log', 'fleet.trip', 'fleet.txn', 'fleet.maintenance', 'fleet.tax', 'fleet.allowance'].map((e) => this.erp.raw(t, e)));
    const sum = (l: any[], v: string, k: string, dk = 'date') => l.filter((x) => x.data.vehicle === v && inR(x.data[dk])).reduce((s, x) => s + num(x.data[k]), 0);
    const rows = vs.map((v) => {
      const id = v.id;
      const income = sum(logs, id, 'earning') + sum(trips, id, 'income') + txn.filter((x) => x.data.vehicle === id && x.data.kind === 'INCOME' && inR(x.data.date)).reduce((s, x) => s + num(x.data.amount), 0);
      const fuel = sum(logs, id, 'fuelCost') + sum(trips, id, 'fuelCost');
      const other = sum(trips, id, 'otherCost') + txn.filter((x) => x.data.vehicle === id && x.data.kind === 'EXPENSE' && inR(x.data.date)).reduce((s, x) => s + num(x.data.amount), 0);
      const expense = fuel + sum(maint, id, 'cost') + sum(tax, id, 'amount', 'from') + sum(allow, id, 'amount') + other;
      const km = sum(logs, id, 'km') + sum(trips, id, 'km'), litres = sum(logs, id, 'fuelLitres');
      return { vehicle: v.data.name, regNo: v.data.regNo, hours: sum(logs, id, 'hours'), km, litres, kmpl: litres ? r2(sum(logs, id, 'km') / litres) : '', income: r2(income), fuel: r2(fuel), maintenance: r2(sum(maint, id, 'cost')),
        tax: r2(sum(tax, id, 'amount', 'from')), allowance: r2(sum(allow, id, 'amount')), other: r2(other), expense: r2(expense), net: r2(income - expense), _tone: income - expense < 0 ? 'bad' : '' };
    });
    const ti = rows.reduce((s, r) => s + r.income, 0), te = rows.reduce((s, r) => s + r.expense, 0);
    return { title: 'Vehicle-wise earning and expense', cards: [{ label: 'Income', value: money(ti) }, { label: 'Expense', value: money(te) }, { label: 'Net', value: money(ti - te), tone: ti - te < 0 ? 'bad' : 'good' }],
      tables: [{ title: `Per vehicle${from || to ? ` (${from ?? '…'} to ${to ?? '…'})` : ' (all dates)'}`, columns: [c('vehicle', 'Vehicle'), c('regNo', 'Reg. no.'), c('hours', 'Hours', true), c('km', 'Km', true), c('litres', 'Fuel (l)', true), c('kmpl', 'Km / litre', true), c('income', 'Income', true), c('fuel', 'Fuel', true), c('maintenance', 'Maintenance', true), c('tax', 'Tax + insurance', true), c('allowance', 'Allowances', true), c('other', 'Other', true), c('expense', 'Total expense', true), c('net', 'Net', true)], rows,
        note: 'Income = work-log earnings + trip income + other income. Tax and insurance are counted by their "valid from" date. Depreciation and loan interest are not included.' }] };
  }

  private async issuedToProject(t: string, projectId: string) {
    const m = new Map<string, number>();
    const add = (docs: any[], sign: number) => { for (const d of docs) for (const l of d.lines ?? []) m.set(l.product, (m.get(l.product) ?? 0) + sign * num(l.qty)); };
    add((await this.erp.raw(t, 'proc.dispatch', { status: 'POSTED' })).filter((d) => d.data.project === projectId), 1);
    add((await this.erp.raw(t, 'project.petty-issue', { status: 'POSTED' })).filter((d) => d.data.project === projectId), 1);
    add((await this.erp.raw(t, 'proc.return', { status: 'POSTED' })).filter((d) => d.data.project === projectId && d.data.type === 'SITE_TO_WAREHOUSE'), -1);
    return m;
  }

  private async materialPlan(user: ErpUser, projectId: string): Promise<Report> {
    const t = user.tenantId;
    const p: any = await this.db.project.findFirst({ where: { id: projectId, tenantId: t } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    const boq = ((await this.db.boqItem.findMany({ where: { tenantId: t, projectId } })) as any[]).filter((b) => !b.isHeading).sort((a, b) => a.sortOrder - b.sortOrder);
    const norms = (await this.erp.raw(t, 'project.norm')).sort((a, b) => String(b.data.boqKeyword).length - String(a.data.boqKeyword).length);
    const products = new Map((await this.erp.raw(t, 'proc.product')).map((x) => [x.id, x.data]));
    const need = new Map<string, number>();
    let skilled = 0, unskilled = 0;
    const items = boq.map((b) => {
      const n = norms.find((x) => String(b.description).toLowerCase().includes(String(x.data.boqKeyword).toLowerCase()));
      if (n) {
        for (const l of n.lines ?? []) need.set(l.product, (need.get(l.product) ?? 0) + num(b.quantity) * num(l.qty));
        skilled += num(b.quantity) * num(n.data.skilledLabour); unskilled += num(b.quantity) * num(n.data.unskilledLabour);
      }
      return { item: b.itemNo ?? '', description: String(b.description).slice(0, 90), unit: b.unit ?? '', qty: num(b.quantity), norm: n ? n.data.name : 'no norm linked', _tone: n ? '' : 'warn' };
    });
    const issued = await this.issuedToProject(t, projectId);
    const stock = await this.erp.stock(t);
    const siteWh = (await this.erp.raw(t, 'proc.warehouse')).filter((w) => w.data.project === projectId).map((w) => w.id);
    const rows = [...new Set([...need.keys(), ...issued.keys()])].map((pid) => {
      const required = r2(need.get(pid) ?? 0), out = r2(issued.get(pid) ?? 0), inSite = r2(siteWh.reduce((s, w) => s + (stock.get(`${w}|${pid}`) ?? 0), 0));
      const balance = Math.max(0, r2(required - out - inSite));
      return { _product: pid, product: products.get(pid)?.name ?? '(deleted)', unit: products.get(pid)?.unit ?? '', required, issued: out, inSite, balance, value: r2(balance * num(products.get(pid)?.lastRate)),
        note: out > required && required ? 'issued more than planned' : '', _tone: out > required && required ? 'bad' : '' };
    }).sort((a, b) => a.product.localeCompare(b.product));
    const linked = items.filter((i) => !i._tone).length;
    return {
      title: `Material plan — ${p.code}`,
      cards: [{ label: 'BOQ items with a norm', value: `${linked} of ${items.length}`, tone: linked < items.length ? 'warn' : '' }, { label: 'Still to procure', value: money(rows.reduce((s, r) => s + r.value, 0)), hint: 'at the usual product rates' },
        { label: 'Labour (days)', value: `${Math.round(skilled)} skilled · ${Math.round(unskilled)} unskilled` }],
      tables: [
        { title: 'Materials', columns: [c('product', 'Material'), c('unit', 'Unit'), c('required', 'Required (BOQ × norm)', true), c('issued', 'Issued to site', true), c('inSite', 'In site warehouse', true), c('balance', 'Still needed', true), c('value', 'Value (NPR)', true), c('note', '')], rows,
          note: 'Required = BOQ quantity × the norm you entered in Norms Ratio Management. Wastage is not added unless it is in your norm.' },
        { title: 'BOQ items and their norm', columns: [c('item', 'Item'), c('description', 'Description'), c('unit', 'Unit'), c('qty', 'BOQ qty', true), c('norm', 'Norm')], rows: items },
      ],
      actions: rows.some((r) => r.balance > 0) ? [{ label: 'Create requisition for "Still needed" →', action: 'material-requisition', body: { project: projectId } }] : [],
    };
  }

  private async progressData(t: string, projectId: string) {
    const boq = ((await this.db.boqItem.findMany({ where: { tenantId: t, projectId } })) as any[]).filter((b) => !b.isHeading).sort((a, b) => a.sortOrder - b.sortOrder);
    const reports = (await this.erp.raw(t, 'project.progress')).filter((r) => r.data.project === projectId && COUNTED.includes(r.status));
    const total = boq.reduce((s, b) => s + num(b.amount), 0);
    return { boq, reports, total };
  }

  private async progress(user: ErpUser, projectId: string): Promise<Report> {
    const t = user.tenantId;
    const p: any = await this.db.project.findFirst({ where: { id: projectId, tenantId: t } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    const { boq, reports, total } = await this.progressData(t, projectId);
    const done = new Map<string, number>();
    for (const r of reports) for (const l of r.lines ?? []) done.set(l.boqItem, (done.get(l.boqItem) ?? 0) + num(l.qty));
    const rows = boq.map((b) => {
      const q = r2(done.get(b.id) ?? 0), pct = num(b.quantity) ? r2((100 * q) / num(b.quantity)) : 0;
      return { item: b.itemNo ?? '', description: String(b.description).slice(0, 90), unit: b.unit ?? '', boq: num(b.quantity), done: q, pct, value: r2(q * num(b.rate)), balance: r2(num(b.quantity) - q),
        note: pct > 100 ? 'more than the BOQ quantity — variation order?' : '', _tone: pct > 100 ? 'warn' : pct >= 100 ? 'good' : '' };
    });
    const value = rows.reduce((s, r) => s + r.value, 0);
    const completed = ['COMPLETED', 'HANDED_OVER', 'CLOSED'].includes(p.status);
    return {
      title: `Progress — ${p.code}`,
      cards: [{ label: 'Work done (value)', value: money(value), hint: `${reports.length} submitted report(s)` }, { label: 'Physical progress', value: total ? r2((100 * value) / total) + '%' : '—', hint: 'value done ÷ BOQ total' },
        { label: 'BOQ total', value: money(total) }, { label: 'Project status', value: p.status }],
      tables: [{ title: 'By BOQ item', columns: [c('item', 'Item'), c('description', 'Description'), c('unit', 'Unit'), c('boq', 'BOQ qty', true), c('done', 'Done', true), c('pct', '%', true), c('value', 'Value (NPR)', true), c('balance', 'Balance qty', true), c('note', '')], rows }],
      actions: completed ? [{ label: '📜 Create experience certificate in Bolpatra →', action: 'make-certificate', body: { project: projectId } }] : [],
      note: completed ? '' : 'When the project is marked Completed (Project Information), a button here turns these quantities into an experience certificate.',
    };
  }

  private async scurve(user: ErpUser, projectId: string): Promise<Report> {
    const t = user.tenantId;
    const p: any = await this.db.project.findFirst({ where: { id: projectId, tenantId: t } });
    if (!p) throw new NotFoundException('Project not found or access denied');
    const acts = (await this.erp.raw(t, 'project.activity')).filter((a) => a.data.project === projectId);
    const { reports, total } = await this.progressData(t, projectId);
    const dates = [...acts.flatMap((a) => [a.data.plannedStart, a.data.plannedEnd]), ...reports.map((r) => r.data.date)].filter(Boolean).sort();
    if (!dates.length) return { title: `S-curve — ${p.code}`, tables: [], note: 'Nothing to draw yet. Add activities with weights in Work Schedule, and submit progress reports.' };
    const months: string[] = [];
    for (let d = new Date(dates[0].slice(0, 7) + '-01T00:00:00Z'); d.toISOString().slice(0, 7) <= dates[dates.length - 1].slice(0, 7) && months.length < 240; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
    const weight = acts.reduce((s, a) => s + num(a.data.weightPct), 0);
    const endOf = (m: string) => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.getTime() - 1; };
    const now = today().slice(0, 7);
    const rows = months.map((m) => {
      const e = endOf(m);
      const planned = weight ? acts.reduce((s, a) => {
        const s0 = +new Date(a.data.plannedStart), e0 = +new Date(a.data.plannedEnd) + 86_399_999;
        return s + num(a.data.weightPct) * Math.min(1, Math.max(0, (e - s0) / Math.max(1, e0 - s0)));
      }, 0) * 100 / weight : null;
      const value = reports.filter((r) => String(r.data.date).slice(0, 7) <= m).reduce((s, r) => s + (r.lines ?? []).reduce((x: number, l: any) => x + num(l.amount), 0), 0);
      const actual = total && m <= now ? (100 * value) / total : null;
      return { month: m, planned: planned == null ? '' : r2(planned), actual: actual == null ? '' : r2(actual), variance: planned != null && actual != null ? r2(actual - planned) : '', value: m <= now ? r2(value) : '',
        _tone: planned != null && actual != null && actual - planned < -5 ? 'bad' : '' };
    });
    const cur = [...rows].reverse().find((r) => r.actual !== '');
    return {
      title: `S-curve — ${p.code}`,
      cards: [{ label: 'Planned to date', value: cur && cur.planned !== '' ? cur.planned + '%' : '—' }, { label: 'Actual to date', value: cur ? cur.actual + '%' : '—' },
        { label: 'Variance', value: cur && cur.variance !== '' ? (Number(cur.variance) > 0 ? '+' : '') + cur.variance + ' points' : '—', tone: cur && Number(cur.variance) < -5 ? 'bad' : cur && Number(cur.variance) >= 0 ? 'good' : 'warn' },
        { label: 'Schedule weights', value: r2(weight) + '%', tone: Math.abs(weight - 100) > 0.5 ? 'warn' : '', hint: Math.abs(weight - 100) > 0.5 ? 'should add up to 100' : '' }],
      chart: { labels: months, unit: '%', series: [{ name: 'Planned', values: rows.map((r) => (r.planned === '' ? null : r.planned)) }, { name: 'Actual', values: rows.map((r) => (r.actual === '' ? null : r.actual)) }] },
      tables: [{ title: 'Cumulative progress by month (AD)', columns: [c('month', 'Month'), c('planned', 'Planned %', true), c('actual', 'Actual %', true), c('variance', 'Variance (points)', true), c('value', 'Work done (NPR)', true)], rows,
        note: 'Planned = schedule weights spread evenly over each activity\'s planned dates. Actual = value of work in submitted progress reports ÷ BOQ total.' }],
    };
  }

  private async portfolio(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const ps = (await this.db.project.findMany({ where: { tenantId: t } })) as any[];
    const cn = await this.names(t, 'company', ps.map((p) => p.companyId));
    const gs = (await this.db.bankGuarantee.findMany({ where: { tenantId: t, status: { in: OPEN_G } } })) as any[];
    const rows: Row[] = [];
    for (const p of ps) {
      const { reports, total } = await this.progressData(t, p.id);
      const value = reports.reduce((s, r) => s + (r.lines ?? []).reduce((x: number, l: any) => x + num(l.amount), 0), 0);
      const due = p.revisedCompletionDate ?? p.intendedCompletionDate;
      const span = p.startDate && due ? +new Date(due) - +new Date(p.startDate) : 0;
      const time = span > 0 ? Math.max(0, r2((100 * (Date.now() - +new Date(p.startDate))) / span)) : null;
      const prog = total ? r2((100 * value) / total) : null;
      const active = ['PLANNED', 'MOBILIZING', 'ONGOING', 'SUSPENDED'].includes(p.status);
      const behind = active && time != null && prog != null && prog < Math.min(100, time) - 10;
      rows.push({ code: p.code, name: p.name, company: cn(p.companyId), status: p.status, contract: num(p.contractAmount), done: r2(value), progress: prog ?? '', time: time ?? '', due: due ? new Date(due).toISOString().slice(0, 10) : '',
        guarantees: r2(gs.filter((g) => g.projectId === p.id).reduce((s, g) => s + num(g.amount), 0)), note: behind ? 'behind schedule' : active && due && daysTo(due) < 0 ? 'completion date passed' : '', _tone: behind || (active && due && daysTo(due) < 0) ? 'bad' : '', _active: active });
    }
    const act = rows.filter((r) => r._active);
    return { title: 'Portfolio',
      cards: [{ label: 'Active projects', value: act.length, hint: `${rows.length} in total` }, { label: 'Active contract value', value: money(act.reduce((s, r) => s + r.contract, 0)) }, { label: 'Work done (active)', value: money(act.reduce((s, r) => s + r.done, 0)) },
        { label: 'Need attention', value: rows.filter((r) => r._tone).length, tone: rows.some((r) => r._tone) ? 'bad' : '' }],
      tables: [{ title: 'All projects', columns: [c('code', 'Code'), c('name', 'Project'), c('company', 'Company'), c('status', 'Status'), c('contract', 'Contract (NPR)', true), c('done', 'Work done (NPR)', true), c('progress', 'Progress %', true), c('time', 'Time used %', true), c('due', 'Completion'), c('guarantees', 'Open guarantees', true), c('note', '')], rows,
        note: '"Behind schedule" = progress more than 10 points below the time used.' }] };
  }

  private async pettyMaterials(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const docs = await this.erp.raw(t, 'project.petty-issue', { status: 'POSTED' });
    const cn = await this.names(t, 'project.petty', docs.map((d) => d.data.pettyContractor));
    const pn = await this.names(t, 'proc.product', docs.flatMap((d) => (d.lines ?? []).map((l: any) => l.product)));
    const prj = await this.names(t, 'project', docs.map((d) => d.data.project));
    const m = new Map<string, Row>();
    for (const d of docs) for (const l of d.lines ?? []) {
      const k = `${d.data.pettyContractor}|${d.data.project}|${l.product}`;
      const r = m.get(k) ?? { contractor: cn(d.data.pettyContractor), project: prj(d.data.project), product: pn(l.product), unit: l.unit ?? '', qty: 0, value: 0 };
      r.qty = r2(r.qty + num(l.qty)); r.value = r2(r.value + num(l.amount)); m.set(k, r);
    }
    const rows = [...m.values()].sort((a, b) => (a.contractor + a.product).localeCompare(b.contractor + b.product));
    return { title: 'Materials issued to petty contractors', cards: [{ label: 'Recovery value', value: money(rows.reduce((s, r) => s + r.value, 0)), hint: 'where a recovery rate was entered' }],
      tables: [{ title: 'Per contractor', columns: [c('contractor', 'Petty contractor'), c('project', 'Project'), c('product', 'Material'), c('unit', 'Unit'), c('qty', 'Issued', true), c('value', 'Recovery value (NPR)', true)], rows,
        note: 'Enter the recovery value as "Material recovery" on the contractor\'s bill.' }] };
  }

  /** monthly reducing-balance schedule */
  schedule(principal: number, ratePct: number, months: number, start: string, mode: string) {
    const i = ratePct / 1200;
    const n = Math.max(1, Math.round(months));
    const emi = mode === 'EMI' ? (i ? (principal * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1) : principal / n) : 0;
    const rows: Row[] = [];
    let bal = principal;
    for (let k = 1; k <= n && k <= 600; k++) {
      const d = new Date(start + 'T00:00:00Z'); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + k);
      d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
      const interest = r2(bal * i);
      let pr = mode === 'EMI' ? r2(emi - interest) : mode === 'EQUAL_PRINCIPAL' ? r2(principal / n) : k === n ? bal : 0;
      if (k === n || pr > bal) pr = r2(bal);
      rows.push({ no: k, date: d.toISOString().slice(0, 10), opening: r2(bal), interest, principal: pr, payment: r2(pr + interest), closing: r2(bal - pr) });
      bal = r2(bal - pr);
    }
    return { rows, emi: r2(emi) };
  }

  private async amortization(user: ErpUser, loanId: string): Promise<Report> {
    const l = await this.rec(user, 'bank.loan', loanId);
    const d = l.data;
    const { rows, emi } = this.schedule(num(d.principal), num(d.ratePct), num(d.tenureMonths), d.startDate, d.repayment ?? 'EMI');
    const next = rows.find((r) => r.date >= today());
    return { title: `Amortization — ${l.number}`,
      cards: [{ label: d.repayment === 'EMI' || !d.repayment ? 'Monthly instalment (EMI)' : 'First instalment', value: money(emi || rows[0].payment) }, { label: 'Total interest', value: money(rows.reduce((s, r) => s + r.interest, 0)) },
        { label: 'Outstanding (from repayments)', value: money(num(d.outstanding)) }, { label: 'Next instalment', value: next ? `${next.date} · ${money(next.payment)}` : 'none' }],
      tables: [{ title: 'Schedule (estimate)', columns: [c('no', '#', true), c('date', 'Due date'), c('opening', 'Opening balance', true), c('interest', 'Interest', true), c('principal', 'Principal', true), c('payment', 'Instalment', true), c('closing', 'Closing balance', true)], rows,
        note: 'Estimate only: monthly reducing balance at a fixed rate. Banks change rates and count days differently — your bank\'s schedule is final.' }] };
  }

  private async finance(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const gs = (await this.db.bankGuarantee.findMany({ where: { tenantId: t, status: { in: OPEN_G } } })) as any[];
    const loans = await this.erp.raw(t, 'bank.loan', { status: 'ACTIVE' });
    const lcs = (await this.erp.raw(t, 'bank.lc')).filter((x) => !['SETTLED', 'CANCELLED'].includes(x.status));
    const assets = (await this.erp.raw(t, 'bank.asset')).filter((a) => a.status !== 'SOLD');
    const pay = (await this.payables(user)).tables[0].rows;
    const cn = await this.names(t, 'company', (await this.db.company.findMany({ where: { tenantId: t } })).map((x) => x.id));
    const due: Row[] = [];
    for (const g of gs) if (g.expiryDate && daysTo(g.expiryDate) <= 30) due.push({ what: `Guarantee ${g.guaranteeNo ?? ''} (${g.bankName})`, date: new Date(g.expiryDate).toISOString().slice(0, 10), days: daysTo(g.expiryDate), amount: num(g.amount) });
    for (const x of lcs) { const d = x.data.dueDate ?? x.data.expiryDate; if (d && daysTo(d) <= 30) due.push({ what: `LC ${x.data.lcNo ?? x.number} ${x.data.dueDate ? 'payment' : 'expiry'}`, date: d, days: daysTo(d), amount: num(x.data.amount) }); }
    for (const l of loans) { const n = this.schedule(num(l.data.principal), num(l.data.ratePct), num(l.data.tenureMonths), l.data.startDate, l.data.repayment ?? 'EMI').rows.find((r) => r.date >= today()); if (n && daysTo(n.date) <= 30) due.push({ what: `Loan ${l.number} instalment`, date: n.date, days: daysTo(n.date), amount: n.payment }); }
    due.sort((a, b) => a.days - b.days).forEach((r) => (r._tone = r.days < 0 ? 'bad' : r.days <= 7 ? 'warn' : ''));
    const ids = [...new Set([...gs.map((g) => g.companyId), ...loans.map((l) => l.data.company), ...lcs.map((l) => l.data.company), ...assets.map((a) => a.data.company)])];
    const per = ids.map((id) => ({ company: cn(id), guarantees: r2(gs.filter((g) => g.companyId === id).reduce((s, g) => s + num(g.amount), 0)), margin: r2(gs.filter((g) => g.companyId === id).reduce((s, g) => s + num(g.marginAmount), 0)),
      loans: r2(loans.filter((l) => l.data.company === id).reduce((s, l) => s + num(l.data.outstanding), 0)), lc: r2(lcs.filter((l) => l.data.company === id).reduce((s, l) => s + num(l.data.amount), 0)),
      assets: r2(assets.filter((a) => a.data.company === id).reduce((s, a) => s + num(a.data.currentValue ?? a.data.cost), 0)) }));
    const S = (k: string) => per.reduce((s, r: Row) => s + r[k], 0);
    return { title: 'Finance dashboard',
      cards: [{ label: 'Open guarantees', value: money(S('guarantees')), hint: `margin held ${money(S('margin'))}` }, { label: 'Loans outstanding', value: money(S('loans')), hint: `${loans.length} active` }, { label: 'Open LCs', value: money(S('lc')), hint: `${lcs.length} open` },
        { label: 'Vendor invoices unpaid', value: money(pay.reduce((s, r) => s + r.unpaid, 0)) }, { label: 'Fixed assets', value: money(S('assets')), hint: 'current valuation or cost' }, { label: 'Due in 30 days', value: due.length, tone: due.some((d) => d.days < 0) ? 'bad' : due.length ? 'warn' : '' }],
      tables: [{ title: 'Due in the next 30 days', columns: [c('what', 'What'), c('date', 'Date'), c('days', 'Days', true), c('amount', 'Amount (NPR)', true)], rows: due },
        { title: 'By company', columns: [c('company', 'Company'), c('guarantees', 'Open guarantees', true), c('margin', 'Margin held', true), c('loans', 'Loans outstanding', true), c('lc', 'Open LCs', true), c('assets', 'Fixed assets', true)], rows: per }],
      note: 'This page shows bank commitments recorded in ProcureNepal. Cash and bank balances are not tracked yet.' };
  }

  private async bankLoan(user: ErpUser): Promise<Report> {
    const t = user.tenantId;
    const banks = (await this.db.bank.findMany({ where: { tenantId: t } })) as any[];
    const cn = await this.names(t, 'company', banks.map((b) => b.companyId));
    const gs = (await this.db.bankGuarantee.findMany({ where: { tenantId: t, status: { in: OPEN_G } } })) as any[];
    const loans = await this.erp.raw(t, 'bank.loan', { status: 'ACTIVE' });
    const lcs = (await this.erp.raw(t, 'bank.lc')).filter((x) => !['SETTLED', 'CANCELLED'].includes(x.status));
    const rows = banks.map((b) => {
      const g = r2(gs.filter((x) => x.bankId === b.id).reduce((s, x) => s + num(x.amount), 0)), ln = loans.filter((x) => x.data.bank === b.id), lo = r2(ln.reduce((s, x) => s + num(x.data.outstanding), 0)),
        lc = r2(lcs.filter((x) => x.data.bank === b.id).reduce((s, x) => s + num(x.data.amount), 0)), limit = b.bgLimit != null ? num(b.bgLimit) : null;
      return { bank: b.name + (b.branch ? ` (${b.branch})` : ''), company: cn(b.companyId), limit: limit ?? '', guarantees: g, free: limit != null ? r2(limit - g) : '', loans: lo, loanCount: ln.length, lc, exposure: r2(g + lo + lc), _tone: limit != null && g > limit ? 'bad' : '' };
    });
    return { title: 'Facilities per bank', cards: [{ label: 'Banks', value: banks.length }, { label: 'Total exposure', value: money(rows.reduce((s, r) => s + r.exposure, 0)), hint: 'guarantees + loans + LCs' }],
      tables: [{ title: 'Per bank', columns: [c('bank', 'Bank'), c('company', 'Company'), c('limit', 'Guarantee limit', true), c('guarantees', 'Guarantees used', true), c('free', 'Limit free', true), c('loans', 'Loans outstanding', true), c('loanCount', 'Loans', true), c('lc', 'Open LCs', true), c('exposure', 'Total exposure', true)], rows }] };
  }

  // ================================================================ CSV EXPORT
  async datasets(user: ErpUser) {
    const mine = await this.access.effectiveModules(user.tenantId, user.userId, user.role);
    const out = [{ key: 'core.banks', title: 'Banks' }, { key: 'core.guarantees', title: 'Bank guarantees' }];
    if (mine.includes('project')) out.push({ key: 'core.projects', title: 'Projects' });
    for (const e of ENTITIES) if (mine.includes(moduleOf(e.key)!) || MENUS.some((m) => mine.includes(moduleOf(m.id)!) && m.tabs.some((x) => x.entity === e.key))) out.push({ key: e.key, title: `${e.key.split('.')[0].toUpperCase()} — ${e.title}` });
    return out;
  }
  async dataset(user: ErpUser, key: string): Promise<{ title: string; columns: string[]; rows: any[][] }> {
    const t = user.tenantId;
    const d10 = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
    if (!(await this.datasets(user)).some((x) => x.key === key)) throw new NotFoundException('Unknown list, or it is in a module that is not active for you');
    if (key === 'core.banks') {
      const cn = await this.names(t, 'company', ((await this.db.bank.findMany({ where: { tenantId: t } })) as any[]).map((b) => b.companyId));
      return { title: 'Banks', columns: ['Company', 'Bank', 'Branch', 'Account No', 'Account Type', 'Guarantee Limit'], rows: ((await this.db.bank.findMany({ where: { tenantId: t } })) as any[]).map((b) => [cn(b.companyId), b.name, b.branch ?? '', b.accountNumber ?? '', b.accountType ?? '', b.bgLimit != null ? num(b.bgLimit) : '']) };
    }
    if (key === 'core.guarantees') {
      const gs = (await this.db.bankGuarantee.findMany({ where: { tenantId: t } })) as any[];
      const cn = await this.names(t, 'company', gs.map((g) => g.companyId));
      return { title: 'Bank guarantees', columns: ['Company', 'Bank', 'Type', 'Guarantee No', 'Beneficiary', 'Amount', 'Issue Date', 'Expiry Date', 'Margin', 'Commission', 'Status'],
        rows: gs.map((g) => [cn(g.companyId), g.bankName, g.type, g.guaranteeNo ?? '', g.beneficiary ?? '', num(g.amount), d10(g.issueDate), d10(g.expiryDate), num(g.marginAmount), num(g.commissionAmount), g.status]) };
    }
    if (key === 'core.projects') {
      const ps = (await this.db.project.findMany({ where: { tenantId: t } })) as any[];
      const cn = await this.names(t, 'company', ps.map((p) => p.companyId));
      return { title: 'Projects', columns: ['Code', 'Project', 'Company', 'Client', 'Contract Amount', 'Start', 'Intended Completion', 'Revised Completion', 'Status'],
        rows: ps.map((p) => [p.code, p.name, cn(p.companyId), p.client ?? '', num(p.contractAmount), d10(p.startDate), d10(p.intendedCompletionDate), d10(p.revisedCompletionDate), p.status]) };
    }
    const def = entityDef(key)!;
    const rows = await this.erp.list(user, key);
    const cols = def.fields.filter((f) => f.type !== 'textarea');
    return { title: def.title, columns: [...(def.series ? ['Number'] : []), ...(def.statuses ? ['Status'] : []), ...cols.map((f) => f.label), ...(def.lines ? ['Lines', 'Total'] : [])],
      rows: rows.map((r) => [...(def.series ? [r.number] : []), ...(def.statuses ? [r.status] : []), ...cols.map((f) => (f.type === 'ref' || f.type === 'multiref' ? r.labels[f.k] : r.data[f.k] ?? '')), ...(def.lines ? [(r.lines ?? []).length, r.total ?? ''] : [])]) };
  }
}
