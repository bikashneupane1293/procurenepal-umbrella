// Task 4 — ERP engine: Procurement & Inventory, Fleet, HR, Project (schedule, progress …), Bank (loans, LC, assets).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { ENTITIES, MENUS, entityDef, REPORT_MODULE } from '../src/erp/erp.registry';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';
const today = new Date().toISOString().slice(0, 10);
const inDays = (k: number) => new Date(Date.now() + k * 86_400_000).toISOString().slice(0, 10);

describe('ERP registry', () => {
  it('every menu tab points at a defined register or report, and every link field at a known list', () => {
    const core = ['company', 'project', 'tender', 'bank', 'boq'];
    for (const m of MENUS) for (const t of m.tabs) {
      if (t.kind === 'entity') expect(entityDef(t.entity!)).toBeDefined();
      if (t.kind === 'report') expect(REPORT_MODULE[t.report!]).toBeDefined();
    }
    for (const e of ENTITIES) for (const f of [...e.fields, ...(e.lines?.cols ?? [])]) {
      if (f.type === 'ref' || f.type === 'multiref') expect(core.includes(f.ref!) || !!entityDef(f.ref!)).toBe(true);
      if (f.type === 'select') expect(f.options!.length).toBeGreaterThan(0);
    }
    expect(new Set(ENTITIES.map((e) => e.key)).size).toBe(ENTITIES.length);
    expect(MENUS).toHaveLength(41);
  });
});

describe('ERP API (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const A = () => as('ownerA');
  const mk = async (entity: string, body: any, code = 201, who = 'ownerA') => (await http().post(`/erp/records/${entity}`).set(as(who)).send(body).expect(code)).body;
  const patch = async (entity: string, id: string, body: any, code = 200) => (await http().patch(`/erp/records/${entity}/${id}`).set(A()).send(body).expect(code)).body;
  const act = async (name: string, body: any, code = 201) => (await http().post(`/erp/actions/${name}`).set(A()).send(body).expect(code)).body;
  const rep = async (name: string, q = '') => (await http().get(`/erp/reports/${name}${q}`).set(A()).expect(200)).body;
  let coA: string, coB: string, prj: string, bankA: string, cement: string, steel: string, whMain: string, whSite: string, v1: string, v2: string, vB: string, req: string, rfq: string, q1: string, q2: string, po: string, emp: string, veh: string;

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'A', name: 'A' }, { id: 'B', name: 'B' });
    for (const [id, role, t] of [['ownerA', 'OWNER', 'A'], ['accA', 'ACCOUNTANT', 'A'], ['ownerB', 'OWNER', 'B']]) {
      db.db.user.push({ id, email: `${id}@x.com`, role, tenantId: t, isActive: true, modules: [] });
      tok[id] = jwt.sign({ sub: id }, { secret: 'test-secret-only' });
    }
    coA = (await http().post('/companies').set(A()).send({ name: 'Alpha Builders', slug: 'alpha' }).expect(201)).body.id;
    coB = (await http().post('/companies').set(as('ownerB')).send({ name: 'Beta', slug: 'beta' }).expect(201)).body.id;
    prj = (await http().post('/projects').set(A()).send({ companyId: coA, name: 'Road One', startDate: inDays(-60), contractPeriodMonths: 6, contractAmount: 1_000_000 }).expect(201)).body.id;
    await http().put(`/projects/${prj}/boq`).set(A()).send({ items: [{ itemNo: '1', description: 'PCC 1:2:4 in foundation', unit: 'm3', quantity: 100, rate: 8000 }, { itemNo: '2', description: 'Earthwork excavation', unit: 'm3', quantity: 400, rate: 500 }] }).expect(200);
    bankA = (await http().post('/banks').set(A()).send({ companyId: coA, name: 'Nabil Bank', bgLimit: 1_000_000 }).expect(201)).body.id;
    vB = (await mk('proc.vendor', { data: { name: 'Beta vendor' } }, 201, 'ownerB')).id;
  });
  afterAll(() => app.close());

  it('menu definitions, masters, validation, links and options', async () => {
    const m = (await http().get('/erp/menu/proc.warehouse-setup').set(A()).expect(200)).body;
    expect(m.tabs.map((t: any) => t.entity)).toEqual(['proc.product', 'proc.category', 'proc.brand']);
    expect(m.tabs[0].def.fields.find((f: any) => f.k === 'unit').req).toBe(true);
    await http().get('/erp/menu/nope').set(A()).expect(404);
    const cat = await mk('proc.category', { data: { name: 'Cement' } });
    cement = (await mk('proc.product', { data: { name: 'OPC Cement', unit: 'bag', category: cat.id, reorderLevel: 50, lastRate: 800 } })).id;
    steel = (await mk('proc.product', { data: { name: 'TMT Steel', unit: 'kg', lastRate: 110 } })).id;
    await mk('proc.product', { data: { name: 'No unit' } }, 400);
    await mk('proc.product', { data: { name: 'X', unit: 'kg', category: 'missing' } }, 404);
    await mk('proc.product', { data: { name: 'X', unit: 'kg', lastRate: -1 } }, 400);
    await mk('nope.thing', { data: {} }, 404);
    whMain = (await mk('proc.warehouse', { data: { name: 'Main store', type: 'MAIN' } })).id;
    whSite = (await mk('proc.warehouse', { data: { name: 'Road One site', project: prj } })).id;
    v1 = (await mk('proc.vendor', { data: { name: 'Shree Suppliers', email: 'shree@example.com' } })).id;
    v2 = (await mk('proc.vendor', { data: { name: 'Hari Traders' } })).id;
    await mk('proc.vendor', { data: { name: 'Bad', email: 'nope' } }, 400);
    const l = (await http().get('/erp/records/proc.product').set(A()).expect(200)).body;
    expect(l).toHaveLength(2);
    expect(l.find((p: any) => p.id === cement).labels.category).toBe('Cement');
    const o = (await http().get('/erp/options/proc.product').set(A()).expect(200)).body;
    expect(o.map((x: any) => x.label)).toEqual(['OPC Cement', 'TMT Steel']);
    expect((await http().get(`/erp/options/boq?projectId=${prj}`).set(A()).expect(200)).body).toHaveLength(2);
    expect((await http().get('/erp/records/proc.warehouse').set(A()).expect(200)).body.find((w: any) => w.id === whSite).labels.project).toMatch(/Road One/);
    await http().delete(`/erp/records/proc.category/${cat.id}`).set(A()).expect(409); // used by the product
    await mk('proc.warehouse', { data: { name: 'X', project: 'not-mine' } }, 404);
  });

  it('requisition → RFQ → quotations → comparison → award → PO, with numbering', async () => {
    await mk('proc.requisition', { data: { date: today, project: prj }, lines: [] }, 400); // needs lines
    await mk('proc.requisition', { data: { date: today }, lines: [{ product: vB, qty: 1 }] }, 404); // other tenant's id
    const r = await mk('proc.requisition', { data: { date: today, project: prj, warehouse: whSite, purpose: 'Foundation' }, lines: [{ product: cement, qty: 500 }, { product: steel, qty: 2000 }, {}] });
    req = r.id;
    expect(r.number).toBe('REQ-0001');
    expect(r.status).toBe('DRAFT');
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].unit).toBe('bag');
    expect(r.lineLabels[0].product).toBe('OPC Cement');
    await act('make-rfq', { id: req }, 400); // not approved
    await patch('proc.requisition', req, { status: 'NOPE' }, 400);
    await patch('proc.requisition', req, { status: 'APPROVED' });
    const a = await act('make-rfq', { id: req });
    rfq = a.goto.id;
    const R = (await http().get(`/erp/records/proc.rfq/${rfq}`).set(A()).expect(200)).body;
    expect(R).toMatchObject({ number: 'RFQ-0001', status: 'DRAFT' });
    expect(R.data.vendors.sort()).toEqual([v1, v2].sort());
    expect(R.lines).toHaveLength(2);
    const mail = await act('email-rfq', { id: rfq });
    expect(mail.open).toMatch(/^mailto:\?bcc=shree%40example\.com&subject=Request%20for%20Quotation%20RFQ-0001/);
    expect(mail.message).toMatch(/No email on file for: Hari Traders/);
    expect((await http().get(`/erp/records/proc.rfq/${rfq}`).set(A()).expect(200)).body.status).toBe('SENT');
    // custom number series
    await mk('proc.series', { data: { docType: 'proc.quotation', prefix: 'Q-2083', padding: 3, nextNumber: 7 } });
    await mk('proc.series', { data: { docType: 'proc.quotation', prefix: 'X' } }, 409);
    await mk('proc.series', { data: { docType: 'nope', prefix: 'X' } }, 400);
    const a1 = await mk('proc.quotation', { data: { rfq, vendor: v1, date: today, deliveryDays: 7 }, lines: [{ product: cement, qty: 500, rate: 790 }, { product: steel, qty: 2000, rate: 112.5 }] });
    q1 = a1.id;
    expect(a1.number).toBe('Q-2083-007');
    expect(a1.lines[1].amount).toBe(225000);
    expect(a1.data.subTotal).toBe(620000);
    expect(a1.total).toBe(700600); // + 13% VAT (default, editable)
    await mk('proc.quotation', { data: { rfq, vendor: v1, date: today }, lines: [{ product: cement, qty: 1, rate: 1 }] }, 409);
    q2 = (await mk('proc.quotation', { data: { rfq, vendor: v2, date: today }, lines: [{ product: cement, qty: 500, rate: 780 }] })).id; // partial offer
    const cmp = await rep('compare', `?rfq=${rfq}`);
    expect(cmp.tables[0].rows.map((x: any) => x.vendor)).toEqual(['Hari Traders', 'Shree Suppliers']); // cheapest total first …
    expect(cmp.tables[0].rows[1]._tone).toBe('good'); // … but only the complete offer is highlighted
    expect(cmp.tables[0].rows[0].quoted).toBe('1 of 2');
    expect(cmp.tables[1].rows[0][`q_${q2}`]).toMatch(/780\.00 ✓/);
    await http().get('/erp/reports/compare').set(A()).expect(400);
    const aw = await act('award', { id: q1 });
    po = aw.goto.id;
    const P = (await http().get(`/erp/records/proc.po/${po}`).set(A()).expect(200)).body;
    expect(P).toMatchObject({ number: 'PO-0001', status: 'DRAFT', total: 700600 });
    expect(P.data).toMatchObject({ vendor: v1, project: prj, warehouse: whSite, quotation: q1 });
    await act('award', { id: q2 }, 409);
    const st = async (e: string, id: string) => (await http().get(`/erp/records/${e}/${id}`).set(A()).expect(200)).body.status;
    expect([await st('proc.quotation', q1), await st('proc.quotation', q2), await st('proc.rfq', rfq), await st('proc.requisition', req)]).toEqual(['AWARDED', 'REJECTED', 'AWARDED', 'ORDERED']);
  });

  it('GRN → stock; over-receipt, transfer, dispatch, returns and negative-stock rules', async () => {
    await act('make-grn', { id: po }, 400); // PO still a draft → GRN save refuses
    await patch('proc.po', po, { status: 'ISSUED' });
    const g = (await act('make-grn', { id: po })).goto.id;
    let G = (await http().get(`/erp/records/proc.grn/${g}`).set(A()).expect(200)).body;
    expect(G.lines.map((l: any) => l.qty)).toEqual([500, 2000]);
    expect(G.data.vendor).toBe(v1);
    await patch('proc.grn', g, { lines: [{ product: cement, qty: 600, rate: 790 }], status: 'POSTED' }, 400); // more than ordered
    await patch('proc.grn', g, { lines: [{ product: cement, qty: 300, rate: 790 }], status: 'POSTED' });
    expect((await http().get(`/erp/records/proc.po/${po}`).set(A()).expect(200)).body.status).toBe('PARTIAL');
    await patch('proc.grn', g, { lines: [{ product: cement, qty: 999, rate: 1 }] }, 400); // posted documents are locked
    const g2 = (await act('make-grn', { id: po })).goto.id;
    G = (await http().get(`/erp/records/proc.grn/${g2}`).set(A()).expect(200)).body;
    expect(G.lines.map((l: any) => l.qty)).toEqual([200, 2000]); // only what is still to come
    await patch('proc.grn', g2, { status: 'POSTED' });
    expect((await http().get(`/erp/records/proc.po/${po}`).set(A()).expect(200)).body.status).toBe('RECEIVED');
    await act('make-grn', { id: po }, 400);
    let s = await rep('stock');
    expect(s.tables[0].rows.map((r: any) => [r.warehouse, r.product, r.qty])).toEqual([['Road One site', 'OPC Cement', 500], ['Road One site', 'TMT Steel', 2000]]);
    expect(s.tables[0].rows[0].value).toBe(395000);
    // transfer
    await mk('proc.transfer', { data: { date: today, fromWarehouse: whSite, toWarehouse: whSite }, lines: [{ product: cement, qty: 1 }] }, 400);
    await mk('proc.transfer', { data: { date: today, fromWarehouse: whSite, toWarehouse: whMain }, lines: [{ product: cement, qty: 501 }], status: 'POSTED' }, 400);
    const tr = await mk('proc.transfer', { data: { date: today, fromWarehouse: whSite, toWarehouse: whMain }, lines: [{ product: cement, qty: 100 }] });
    expect((await rep('stock', `?warehouse=${whMain}`)).tables[0].rows).toHaveLength(0); // a draft moves nothing
    await patch('proc.transfer', tr.id, { status: 'POSTED' });
    expect((await rep('stock', `?warehouse=${whMain}`)).tables[0].rows[0].qty).toBe(100);
    // dispatch to site, return from site, return to vendor
    const err = (await mk('proc.dispatch', { data: { date: today, warehouse: whSite, project: prj }, lines: [{ product: cement, qty: 401 }], status: 'POSTED' }, 400)).message;
    expect(err).toBe('Not enough stock of OPC Cement: 400 available in Road One site, 401 needed');
    await mk('proc.dispatch', { data: { date: today, warehouse: whSite, project: prj }, lines: [{ product: cement, qty: 380 }], status: 'POSTED' });
    await mk('proc.return', { data: { date: today, type: 'TO_VENDOR', warehouse: whSite }, lines: [{ product: steel, qty: 100 }], status: 'POSTED' }, 400); // vendor missing
    await mk('proc.return', { data: { date: today, type: 'TO_VENDOR', warehouse: whSite, vendor: v1 }, lines: [{ product: steel, qty: 100 }], status: 'POSTED' });
    await mk('proc.return', { data: { date: today, type: 'SITE_TO_WAREHOUSE', warehouse: whSite, project: prj }, lines: [{ product: cement, qty: 10 }], status: 'POSTED' });
    s = await rep('stock', `?warehouse=${whSite}`);
    expect(s.tables[0].rows.map((r: any) => [r.product, r.qty, r.note])).toEqual([['OPC Cement', 30, 'Below re-order level'], ['TMT Steel', 1900, '']]);
    // un-posting the transfer is fine; un-posting the first GRN is not (its cement was used)
    await patch('proc.grn', g, { status: 'DRAFT' }, 400);
    await http().delete(`/erp/records/proc.grn/${g}`).set(A()).expect(409);
    // invoices and payables
    const pi = (await act('make-proforma', { id: po })).goto.id;
    await patch('proc.proforma', pi, { data: { bank: bankA, paymentMode: 'CHEQUE', paidAmount: 300000 }, status: 'PAID' });
    await act('make-proforma', { id: po }, 400); // fully invoiced
    const pay = await rep('payables');
    expect(pay.tables[0].rows[0]).toMatchObject({ po: 'PO-0001', total: 700600, invoiced: 700600, paid: 300000, unpaid: 400600, uninvoiced: 0 });
  });

  it('fleet: vehicles, logs with default earning, renewals alerts, earnings report; HR payroll with SSF', async () => {
    emp = (await mk('hr.employee', { data: { name: 'Ram Driver', company: coA, basicSalary: 30000, allowance: 5000 } })).id;
    await mk('hr.employee', { data: { name: 'Gone', basicSalary: 1 }, status: 'LEFT' });
    veh = (await mk('fleet.vehicle', { data: { name: 'Tipper 1', regNo: 'Ba 2 Kha 1234', type: 'TIPPER', hourlyRate: 2000, kmRate: 10, operator: emp } })).id;
    await mk('fleet.vehicle', { data: { name: 'No reg' } }, 400);
    const log = await mk('fleet.log', { data: { date: today, vehicle: veh, project: prj, startMeter: 1000, endMeter: 1080, hours: 5, fuelLitres: 20, fuelCost: 3500 } });
    expect(log.data).toMatchObject({ km: 80, earning: 10800 });
    await mk('fleet.log', { data: { date: today, vehicle: veh, startMeter: 10, endMeter: 5 } }, 400);
    await mk('fleet.trip', { data: { date: today, vehicle: veh, from: 'Hetauda', to: 'Site', km: 40, income: 6000, fuelCost: 1500, otherCost: 200 } });
    await mk('fleet.maintenance', { data: { vehicle: veh, date: today, partsCost: 4000, labourCost: 1000, nextDueDate: inDays(10) } });
    const tax = await mk('fleet.tax', { data: { vehicle: veh, kind: 'INSURANCE', from: today, expiry: inDays(12), amount: 25000 } });
    expect(tax.alert).toBe('Expires in 12 day(s)');
    await mk('fleet.txn', { data: { date: today, vehicle: veh, kind: 'EXPENSE', head: 'Parking', amount: 300 } });
    const al = await mk('fleet.allowance', { data: { date: today, employee: emp, vehicle: veh, kind: 'DAILY', qty: 4, rate: 500 } });
    expect(al.data.amount).toBe(2000);
    await mk('fleet.movement', { data: { vehicle: veh, project: prj, from: inDays(-5) } });
    const e = (await rep('fleet-earnings', `?from=${inDays(-1)}&to=${inDays(1)}`)).tables[0].rows[0];
    expect(e).toMatchObject({ vehicle: 'Tipper 1', income: 16800, fuel: 5000, maintenance: 5000, tax: 25000, allowance: 2000, other: 500, expense: 37500, net: -20700, kmpl: 4 });
    expect((await rep('fleet-earnings', `?from=${inDays(5)}`)).tables[0].rows[0].income).toBe(0);
    expect((await rep('fleet-expiry')).tables[0].rows.map((r: any) => r.what)).toEqual(['next service', 'insurance']);
    expect((await rep('fleet-where')).tables[0].rows[0]).toMatchObject({ vehicle: 'Tipper 1', note: '' });
    // payroll
    const pay = await mk('hr.payroll', { data: { month: '2083-08', company: coA, fromDate: inDays(-15), toDate: inDays(15) } });
    expect(pay.data).toMatchObject({ ssfEmployeePct: 11, ssfEmployerPct: 20 });
    await act('payroll-calc', { id: pay.id });
    let P = (await http().get(`/erp/records/hr.payroll/${pay.id}`).set(A()).expect(200)).body;
    expect(P.lines).toHaveLength(1); // the employee who left is not paid
    expect(P.lines[0]).toMatchObject({ basic: 30000, allowance: 5000, otherAllowance: 2000, ssfEmployee: 3300, ssfEmployer: 6000, net: 33700 });
    P = await patch('hr.payroll', pay.id, { lines: [{ ...P.lines[0], tax: 1000, deduction: 700 }], data: { ssfEmployeePct: 10 }, status: 'PAID' });
    expect(P.lines[0]).toMatchObject({ ssfEmployee: 3000, net: 32300 });
    expect(P.data.totalNet).toBe(32300);
    expect((await http().get(`/erp/records/fleet.allowance/${al.id}`).set(A()).expect(200)).body.data.paid).toBe(true); // picked up by the paid payroll
    await act('payroll-calc', { id: pay.id }, 400);
  });

  it('project: schedule, EOT → revised completion, norms → material plan → requisition, progress → S-curve → certificate', async () => {
    await mk('project.activity', { data: { project: prj, name: 'Earthwork', plannedStart: inDays(-60), plannedEnd: inDays(-30), weightPct: 20 } });
    await mk('project.activity', { data: { project: prj, name: 'Concrete', plannedStart: inDays(-30), plannedEnd: inDays(60), weightPct: 80 } });
    await mk('project.activity', { data: { project: prj, name: 'Bad', plannedStart: today, plannedEnd: inDays(-1), weightPct: 1 } }, 400);
    await mk('project.eot', { data: { project: prj, appliedDate: today, daysRequested: 30, newCompletionDate: inDays(200) }, status: 'APPROVED' });
    expect(new Date((await http().get(`/projects/${prj}`).set(A()).expect(200)).body.revisedCompletionDate).toISOString().slice(0, 10)).toBe(inDays(200));
    const ms = await mk('project.milestone', { data: { project: prj, title: 'Sub-base done', targetDate: inDays(-3) } });
    expect(ms.alert).toBe('Target date passed 3 day(s) ago');
    // norms: 1 m3 of PCC 1:2:4 = 6.4 bags (the user's own norm)
    await mk('project.norm', { data: { name: 'PCC 1:2:4', unit: 'm3', boqKeyword: '1:2:4', unskilledLabour: 4 }, lines: [{ product: cement, qty: 6.4 }] });
    await mk('project.norm', { data: { name: 'Empty', unit: 'm3', boqKeyword: 'x' }, lines: [] }, 400);
    const plan = await rep('material-plan', `?project=${prj}`);
    expect(plan.tables[0].rows[0]).toMatchObject({ product: 'OPC Cement', required: 640, issued: 370, inSite: 30, balance: 240, value: 192000 });
    expect(plan.tables[1].rows.map((r: any) => r.norm)).toEqual(['PCC 1:2:4', 'no norm linked']);
    expect(plan.cards[2].value).toBe('0 skilled · 400 unskilled');
    const nr = (await act(plan.actions[0].action, plan.actions[0].body)).goto.id;
    const NR = (await http().get(`/erp/records/proc.requisition/${nr}`).set(A()).expect(200)).body;
    expect(NR.lines).toEqual([{ product: cement, qty: 240, unit: 'bag' }]);
    expect(NR.number).toBe('REQ-0002');
    // progress
    const boq = (await http().get(`/erp/options/boq?projectId=${prj}`).set(A()).expect(200)).body;
    const other = (await http().post('/projects').set(A()).send({ companyId: coA, name: 'Other' }).expect(201)).body.id;
    await http().put(`/projects/${other}/boq`).set(A()).send({ items: [{ description: 'x', quantity: 1, rate: 1 }] }).expect(200);
    const foreign = (await http().get(`/erp/options/boq?projectId=${other}`).set(A()).expect(200)).body[0].id;
    await mk('project.progress', { data: { project: prj, date: today }, lines: [{ boqItem: foreign, qty: 1 }] }, 400);
    const pr = await mk('project.progress', { data: { project: prj, date: today }, lines: [{ boqItem: boq[0].id, qty: 25 }, { boqItem: boq[1].id, qty: 400 }], status: 'SUBMITTED' });
    expect(pr.lines.map((l: any) => l.amount)).toEqual([200000, 200000]);
    expect(pr.total).toBe(400000);
    await mk('project.progress', { data: { project: prj, date: today }, lines: [{ boqItem: boq[0].id, qty: 50 }] }); // draft: not counted
    const sum = await rep('progress', `?project=${prj}`);
    expect(sum.tables[0].rows.map((r: any) => [r.done, r.pct])).toEqual([[25, 25], [400, 100]]);
    expect(sum.cards[1].value).toBe('40%');
    expect(sum.actions).toEqual([]);
    const sc = await rep('scurve', `?project=${prj}`);
    expect(sc.chart.series.map((x: any) => x.name)).toEqual(['Planned', 'Actual']);
    const cur = sc.tables[0].rows.find((r: any) => r.month === today.slice(0, 7));
    expect(cur.actual).toBe(40);
    expect(cur.planned).toBeGreaterThan(20);
    expect(sc.cards[3].value).toBe('100%');
    const pf = await rep('portfolio');
    expect(pf.tables[0].rows.find((r: any) => r.name === 'Road One')).toMatchObject({ progress: 40, done: 400000 });
    // completion → experience certificate in Bolpatra
    await act('make-certificate', { project: prj }, 400);
    await http().patch(`/projects/${prj}`).set(A()).send({ status: 'COMPLETED' }).expect(200);
    expect((await rep('progress', `?project=${prj}`)).actions).toHaveLength(1);
    const msg = (await act('make-certificate', { project: prj })).message;
    expect(msg).toMatch(/2 key-activity quantities/);
    const cert = db.db.certificate.find((x) => x.companyId === coA)!;
    expect(cert).toMatchObject({ projectName: 'Road One', completionStatus: 'completed', verificationStatus: 'unverified' });
    expect(Number(cert.finalAmount)).toBe(400000);
    expect(cert.keyActivities.map((k: any) => k.quantity)).toEqual([25, 400]);
    await act('make-certificate', { project: prj }, 409);
    // petty contractors
    const pc = (await mk('project.petty', { data: { name: 'Shyam Mistri', trade: 'Masonry' } })).id;
    const wo = await mk('project.workorder', { data: { project: prj, pettyContractor: pc, date: today }, lines: [{ description: 'Stone masonry', unit: 'm3', qty: 50, rate: 2000 }] });
    expect(wo.total).toBe(100000);
    const bill = await mk('project.pettybill', { data: { workOrder: wo.id, date: today, retentionPct: 5, tdsPct: 1.5, materialRecovery: 5000 }, lines: [{ description: 'Stone masonry', qty: 20, rate: 2000 }] });
    expect(bill.data.payable).toBe(32400); // 40,000 − 2,000 − 600 − 5,000
    await mk('project.petty-issue', { data: { date: today, project: prj, pettyContractor: pc, warehouse: whSite }, lines: [{ product: cement, qty: 31, rate: 800 }], status: 'POSTED' }, 400); // only 30 in stock
    await mk('project.petty-issue', { data: { date: today, project: prj, pettyContractor: pc, warehouse: whSite }, lines: [{ product: cement, qty: 20, rate: 800 }], status: 'POSTED' });
    expect((await rep('petty-materials')).tables[0].rows[0]).toMatchObject({ contractor: 'Shyam Mistri', qty: 20, value: 16000 });
    expect((await rep('stock', `?warehouse=${whSite}`)).tables[0].rows[0].qty).toBe(10);
  });

  it('bank: loan amortization, LC due dates, fixed assets, finance dashboard, per-bank facilities, CSV', async () => {
    const ln = await mk('bank.loan', { data: { company: coA, bank: bankA, principal: 1_200_000, ratePct: 12, startDate: inDays(-20), tenureMonths: 12 }, lines: [{ date: today, principalPaid: 200000, interestPaid: 12000 }] });
    expect(ln).toMatchObject({ number: 'LN-0001', status: 'ACTIVE', total: 1_200_000 });
    expect(ln.data.outstanding).toBe(1_000_000);
    const otherBank = (await http().post('/banks').set(as('ownerB')).send({ companyId: coB, name: 'B bank' }).expect(201)).body.id;
    await mk('bank.loan', { data: { company: coA, bank: otherBank, principal: 1, ratePct: 1, startDate: today, tenureMonths: 1 } }, 404);
    const am = await rep('amortization', `?loan=${ln.id}`);
    expect(am.tables[0].rows).toHaveLength(12);
    expect(am.cards[0].value).toBe('Rs 1,06,619'); // EMI of 12 lakh at 12% for 12 months = 106,618.55
    expect(am.tables[0].rows[0]).toMatchObject({ interest: 12000, principal: 94618.55, closing: 1105381.45 });
    expect(am.tables[0].rows[11].closing).toBe(0);
    const eq = await mk('bank.loan', { data: { company: coA, bank: bankA, principal: 120000, ratePct: 0, startDate: today, tenureMonths: 12, repayment: 'EQUAL_PRINCIPAL' }, status: 'CLOSED' });
    expect((await rep('amortization', `?loan=${eq.id}`)).tables[0].rows.every((r: any) => r.payment === 10000)).toBe(true);
    const lc = await mk('bank.lc', { data: { company: coA, bank: bankA, lcType: 'USANCE', amount: 500000, marginPct: 10, openDate: inDays(-10), expiryDate: inDays(80), shipmentDate: inDays(-5), usanceDays: 25, beneficiary: v1, po } });
    expect(lc.data).toMatchObject({ marginAmount: 50000, dueDate: inDays(20) });
    expect(lc.alert).toBe('Payment due in 20 day(s)');
    await mk('bank.lc', { data: { company: coA, bank: bankA, lcType: 'SIGHT', amount: 1, openDate: today, expiryDate: inDays(-1) } }, 400);
    await mk('bank.asset', { data: { company: coA, name: 'Office land', assetType: 'LAND', cost: 5_000_000, currentValue: 9_000_000, mortgagedTo: bankA }, status: 'MORTGAGED' });
    await http().post('/bank-guarantees').set(A()).send({ companyId: coA, bankId: bankA, type: 'PERFORMANCE', amount: 400000, guaranteeNo: 'PG-1', expiryDate: inDays(15) }).expect(201);
    const fin = await rep('finance');
    expect(fin.cards.map((x: any) => x.value)).toEqual(['Rs 4,00,000', 'Rs 10,00,000', 'Rs 5,00,000', 'Rs 4,00,600', 'Rs 90,00,000', 3]);
    expect(fin.tables[0].rows.map((r: any) => r.what)).toEqual(['Loan LN-0001 instalment', 'Guarantee PG-1 (Nabil Bank)', 'LC LC-0001 payment']);
    expect(fin.tables[1].rows[0]).toMatchObject({ company: 'Alpha Builders', guarantees: 400000, loans: 1000000, lc: 500000, assets: 9000000 });
    expect((await rep('bank-loan')).tables[0].rows.find((r: any) => r.bank === 'Nabil Bank')).toMatchObject({ limit: 1000000, guarantees: 400000, free: 600000, loans: 1000000, loanCount: 1, lc: 500000, exposure: 1900000 });
    const sets = (await http().get('/erp/csv').set(A()).expect(200)).body.map((x: any) => x.key);
    expect(sets).toEqual(expect.arrayContaining(['core.banks', 'core.guarantees', 'core.projects', 'proc.po', 'bank.loan']));
    const csv = (await http().get('/erp/csv/proc.po').set(A()).expect(200)).body;
    expect(csv.columns.slice(0, 4)).toEqual(['Number', 'Status', 'Date', 'Vendor']);
    expect(csv.rows[0].slice(0, 4)).toEqual(['PO-0001', 'RECEIVED', today, 'Shree Suppliers']);
    expect((await http().get('/erp/csv/core.guarantees').set(A()).expect(200)).body.rows).toHaveLength(1);
  });

  it('tenant isolation, roles and module switches', async () => {
    const B = as('ownerB');
    expect((await http().get('/erp/records/proc.product').set(B).expect(200)).body).toEqual([]);
    await http().get(`/erp/records/proc.po/${po}`).set(B).expect(404);
    await http().patch(`/erp/records/proc.po/${po}`).set(B).send({ data: { subject: 'x' } }).expect(404);
    await http().delete(`/erp/records/proc.po/${po}`).set(B).expect(404);
    await http().post('/erp/actions/make-grn').set(B).send({ id: po }).expect(404);
    await http().get(`/erp/reports/compare?rfq=${rfq}`).set(B).expect(404);
    await http().get(`/erp/reports/material-plan?project=${prj}`).set(B).expect(404);
    expect((await http().get('/erp/reports/stock').set(B).expect(200)).body.tables[0].rows).toEqual([]);
    expect((await http().get('/erp/options/proc.vendor').set(B).expect(200)).body.map((x: any) => x.label)).toEqual(['Beta vendor']);
    expect((await http().get('/erp/csv/proc.po').set(B).expect(200)).body.rows).toEqual([]);
    await mk('proc.po', { data: { date: today, vendor: v1 }, lines: [{ product: cement, qty: 1, rate: 1 }] }, 404, 'ownerB'); // A's vendor
    await http().get('/erp/records/proc.product').expect(401);
    // roles
    const brand = await mk('proc.brand', { data: { name: 'Shivam' } }, 201, 'accA');
    await http().delete(`/erp/records/proc.brand/${brand.id}`).set(as('accA')).expect(403);
    await http().delete(`/erp/records/proc.brand/${brand.id}`).set(A()).expect(200);
    // modules
    await http().put('/access/workspace-modules').set(A()).send({ modules: { fleet: false, procurement: false } }).expect(200);
    await http().get('/erp/records/fleet.vehicle').set(A()).expect(403);
    await http().get('/erp/menu/fleet.vehicles').set(A()).expect(403);
    await http().get('/erp/reports/fleet-earnings').set(A()).expect(403);
    await http().get('/erp/records/proc.po').set(A()).expect(403);
    await http().get('/erp/records/proc.warehouse').set(A()).expect(200); // still reachable through Project → Site Warehouse
    await http().get('/erp/reports/stock').set(A()).expect(200);
    expect((await http().get('/erp/csv').set(A()).expect(200)).body.map((x: any) => x.key)).not.toContain('fleet.vehicle');
    await http().put('/access/workspace-modules').set(A()).send({ modules: { fleet: true, procurement: true } }).expect(200);
  });
});
