// Task 3 — Project Information (from won bids) + BOQ (real NestJS app, in-memory DB).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { addMonths, lineAmount, projectAlerts } from '../src/project/project.constants';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';
const day = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : null);

describe('Project rules', () => {
  it('adds months and line amounts', () => {
    expect(day(addMonths(new Date('2026-01-31'), 1))).toBe('2026-02-28');
    expect(day(addMonths(new Date('2026-12-10'), 18))).toBe('2028-06-10');
    expect(lineAmount(100, 250.5)).toBe(25050);
    expect(lineAmount(1.005, 3)).toBe(3.02);
    expect(lineAmount(null, 3)).toBeNull();
  });
  it('raises time, BOQ and guarantee alerts', () => {
    const today = new Date('2026-11-12');
    const codes = (p: any, total = 0, count = 0, g: any[] = []) => projectAlerts(p, total, count, g, today).map((a) => a.code);
    expect(codes({ status: 'ONGOING', intendedCompletionDate: '2026-10-01' }, 10, 1)).toEqual(['OVERDUE']);
    expect(codes({ status: 'ONGOING', intendedCompletionDate: '2026-10-01', revisedCompletionDate: '2027-06-01' }, 10, 1)).toEqual([]);
    expect(codes({ status: 'COMPLETED', intendedCompletionDate: '2026-10-01' }, 10, 1)).toEqual([]);
    expect(codes({ status: 'ONGOING', intendedCompletionDate: '2026-11-30' }, 10, 1)).toEqual(['DUE_SOON']);
    expect(codes({ status: 'ONGOING', contractAmount: 1000 }, 900, 3)).toEqual(['BOQ_MISMATCH']);
    expect(codes({ status: 'ONGOING', contractAmount: 1000 }, 1000.5, 3)).toEqual([]);
    expect(codes({ status: 'ONGOING' })).toEqual(['NO_BOQ']);
    expect(codes({ status: 'ONGOING', intendedCompletionDate: '2028-01-01' }, 1, 1, [{ type: 'PERFORMANCE', status: 'ACTIVE', expiryDate: '2027-06-01' }])).toEqual(['GUARANTEE_SHORT']);
    expect(codes({ status: 'ONGOING' }, 1, 1, [{ type: 'ADVANCE_PAYMENT', status: 'ACTIVE', expiryDate: '2026-11-20' }])).toEqual(['GUARANTEE_EXPIRING']);
  });
});

describe('Projects + BOQ API (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  let coA: string, coA2: string, coB: string, t1: string, t2: string, bid1: string, bid2: string, p1: string, p2: string, p3: string;

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'A', name: 'A' }, { id: 'B', name: 'B' });
    for (const [id, role, t] of [['ownerA', 'OWNER', 'A'], ['accA', 'ACCOUNTANT', 'A'], ['dirA', 'DIRECTOR', 'A'], ['ownerB', 'OWNER', 'B']]) {
      db.db.user.push({ id, email: `${id}@x.com`, role, tenantId: t, isActive: true, modules: [] });
      tok[id] = jwt.sign({ sub: id }, { secret: 'test-secret-only' });
    }
    const A = as('ownerA');
    coA = (await http().post('/companies').set(A).send({ name: 'Alpha Builders', slug: 'alpha' }).expect(201)).body.id;
    coA2 = (await http().post('/companies').set(A).send({ name: 'Alpha Two', slug: 'alpha-two' }).expect(201)).body.id;
    coB = (await http().post('/companies').set(as('ownerB')).send({ name: 'Beta', slug: 'beta' }).expect(201)).body.id;
    t1 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-1', projectTitle: 'Road One', procuringEntity: 'DoR Division Office', projectType: 'ROAD', contractPeriodMonths: 18, deadlineDate: '2026-11-20' }).expect(201)).body.id;
    t2 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-2', projectTitle: 'Bridge Two', deadlineDate: '2026-11-25' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('a contract-signed bid becomes a project automatically, with its guarantees', async () => {
    const A = as('ownerA');
    bid1 = (await http().post('/bids').set(A).send({ tenderId: t1, companyId: coA }).expect(201)).body.id;
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'AWARDED', bidAmount: 95_000_000, bidSecurityType: 'BANK_GUARANTEE', bidSecurityBank: 'Nabil', bidSecurityRef: 'BG-1', bidSecurityAmount: 2_500_000 }).expect(200);
    expect((await http().get('/projects').set(A).expect(200)).body).toHaveLength(0); // awarded only — not automatic
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'CONTRACT_SIGNED', awardDate: '2026-12-01', contractSignDate: '2026-12-10', contractAmount: 94_000_000, performanceSecurityAmount: 4_700_000, performanceSecurityExpiry: '2027-12-31' }).expect(200);
    const l = (await http().get('/projects').set(A).expect(200)).body;
    expect(l).toHaveLength(1);
    const p = l[0];
    p1 = p.id;
    expect(p).toMatchObject({ code: 'P-001', name: 'Road One', client: 'DoR Division Office', contractNo: 'T-1', projectType: 'ROAD', status: 'MOBILIZING', source: 'BID', bidId: bid1, tenderId: t1, contractPeriodMonths: 18 });
    expect(Number(p.contractAmount)).toBe(94_000_000);
    expect(day(p.startDate)).toBe('2026-12-10');
    expect(day(p.intendedCompletionDate)).toBe('2028-06-10');
    expect(p.openGuarantees).toBe(2); // bid security + performance
    expect(p.alerts.map((a: any) => a.code)).toEqual(expect.arrayContaining(['NO_BOQ', 'GUARANTEE_SHORT']));
    const d = (await http().get(`/projects/${p1}`).set(A).expect(200)).body;
    expect(d.guarantees.map((g: any) => g.type).sort()).toEqual(['BID_SECURITY', 'PERFORMANCE']);
    expect((await http().get(`/bids/${bid1}`).set(A).expect(200)).body.project).toMatchObject({ id: p1, code: 'P-001' });
    expect((await http().get(`/bank-guarantees?projectId=${p1}`).set(A).expect(200)).body).toHaveLength(2);
    await http().patch(`/bids/${bid1}`).set(A).send({ notes: 'again' }).expect(200);
    expect(db.db.project).toHaveLength(1);
  });

  it('an awarded bid becomes a project on request; won bids without a project are listed', async () => {
    const A = as('ownerA');
    bid2 = (await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA2, bidderType: 'JV', jvPartners: [{ companyId: coA2, share: 60, isLead: true }, { companyId: coA, share: 40 }] }).expect(201)).body.id;
    await http().post(`/projects/from-bid/${bid2}`).set(A).expect(400); // still preparing
    await http().patch(`/bids/${bid2}`).set(A).send({ status: 'AWARDED', bidAmount: 50_000_000 }).expect(200);
    expect((await http().get('/projects/won-bids').set(A).expect(200)).body.map((b: any) => b.id)).toEqual([bid2]);
    const p = (await http().post(`/projects/from-bid/${bid2}`).set(A).expect(201)).body;
    p2 = p.id;
    expect(p).toMatchObject({ code: 'P-002', name: 'Bridge Two', bidderType: 'JV' });
    expect(p.jvPartners).toHaveLength(2);
    expect(Number(p.contractAmount)).toBe(50_000_000);
    await http().post(`/projects/from-bid/${bid2}`).set(A).expect(409);
    expect((await http().get('/projects/won-bids').set(A).expect(200)).body).toEqual([]);
  });

  it('manual projects: code, completion from months, validation', async () => {
    const A = as('ownerA');
    const p = (await http().post('/projects').set(A).send({ companyId: coA, name: 'Private building', client: 'Mr. Client', startDate: '2026-01-15', contractPeriodMonths: 12, contractAmount: 1000 }).expect(201)).body;
    p3 = p.id;
    expect(p).toMatchObject({ code: 'P-003', status: 'ONGOING', source: 'MANUAL' });
    expect(day(p.intendedCompletionDate)).toBe('2027-01-15');
    await http().post('/projects').set(A).send({ companyId: coA, name: 'X', code: 'P-001' }).expect(409);
    await http().post('/projects').set(A).send({ companyId: coA, name: 'X', startDate: '2026-05-01', intendedCompletionDate: '2026-04-01' }).expect(400);
    await http().post('/projects').set(A).send({ companyId: coA, name: 'X', intendedCompletionDate: '2026-05-01', revisedCompletionDate: '2026-04-01' }).expect(400);
    await http().post('/projects').set(A).send({ companyId: coB, name: 'X' }).expect(404);
    await http().post('/projects').set(A).send({ companyId: coA, name: '  ' }).expect(400);
    await http().post('/projects').set(A).send({ companyId: coA, name: 'X', status: 'NOPE' }).expect(400);
    const own = (await http().post('/projects').set(A).send({ companyId: coA, name: 'Own code', code: 'BLD-07' }).expect(201)).body;
    expect(own.code).toBe('BLD-07');
    await http().delete(`/projects/${own.id}`).set(A).expect(200);
  });

  it('BOQ: replace, append, headings, amount check, totals and mismatch alert', async () => {
    const A = as('ownerA');
    const r = (await http().put(`/projects/${p3}/boq`).set(A).send({ items: [
      { itemNo: '1', description: 'Earthwork', isHeading: true },
      { itemNo: '1.1', description: 'Excavation in ordinary soil', unit: 'm3', quantity: 2, rate: 250.5 },
      { itemNo: '1.2', description: 'Backfilling', unit: 'm3', quantity: 10, rate: 30, amount: 500 },
      { description: 'Provisional sum heading only' },
    ] }).expect(200)).body;
    expect(r.count).toBe(2);
    expect(r.total).toBe(801);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/item 1.2/);
    expect(r.items.map((i: any) => i.isHeading)).toEqual([true, false, false, true]);
    expect(r.items[2].amount).toBe('300');
    // append
    const a = (await http().put(`/projects/${p3}/boq`).set(A).send({ mode: 'append', items: [{ itemNo: '2.1', description: 'PCC', unit: 'm3', quantity: 1, rate: 199 }] }).expect(200)).body;
    expect(a.count).toBe(3);
    expect(a.total).toBe(1000);
    expect(a.items.at(-1).sortOrder).toBe(5);
    const p = (await http().get(`/projects/${p3}`).set(A).expect(200)).body;
    expect(p).toMatchObject({ boqCount: 3, boqTotal: 1000 });
    expect(p.alerts.map((x: any) => x.code)).not.toContain('BOQ_MISMATCH');
    await http().put(`/projects/${p1}/boq`).set(A).send({ items: [{ description: 'Only item', quantity: 1, rate: 100 }] }).expect(200);
    expect((await http().get(`/projects/${p1}`).set(A).expect(200)).body.alerts.map((x: any) => x.code)).toContain('BOQ_MISMATCH');
    // replace wipes
    const rep = (await http().put(`/projects/${p1}/boq`).set(A).send({ items: [] }).expect(200)).body;
    expect(rep.count).toBe(0);
    // validation
    await http().put(`/projects/${p3}/boq`).set(A).send({ items: [{ description: '', quantity: 1 }] }).expect(400);
    await http().put(`/projects/${p3}/boq`).set(A).send({ items: [{ description: 'x', quantity: -1 }] }).expect(400);
    await http().put(`/projects/${p3}/boq`).set(A).send({ items: Array.from({ length: 5001 }, () => ({ description: 'x' })) }).expect(400);
    expect((await http().get(`/projects/${p3}/boq`).set(A).expect(200)).body.count).toBe(3); // unchanged after failures
  });

  it('updates: status history, completion date, locked company/tender for bid projects', async () => {
    const A = as('ownerA');
    let p = (await http().patch(`/projects/${p1}`).set(A).send({ status: 'ONGOING', location: 'Hetauda', projectManager: 'Er. Sita' }).expect(200)).body;
    expect(p.statusHistory.map((h: any) => h.status)).toEqual(['MOBILIZING', 'ONGOING']);
    p = (await http().patch(`/projects/${p1}`).set(A).send({ revisedCompletionDate: '2028-12-31' }).expect(200)).body;
    expect(day(p.revisedCompletionDate)).toBe('2028-12-31');
    await http().patch(`/projects/${p1}`).set(A).send({ companyId: coA2 }).expect(400);
    await http().patch(`/projects/${p1}`).set(A).send({ code: 'P-002' }).expect(409);
    p = (await http().patch(`/projects/${p3}`).set(A).send({ contractPeriodMonths: 6 }).expect(200)).body;
    expect(day(p.intendedCompletionDate)).toBe('2026-07-15');
    expect(p.alerts.map((x: any) => x.code)).toContain('OVERDUE');
    p = (await http().patch(`/projects/${p3}`).set(A).send({ status: 'COMPLETED' }).expect(200)).body;
    expect(p.actualCompletionDate).toBeTruthy();
    expect(p.alerts.map((x: any) => x.code)).not.toContain('OVERDUE');
  });

  it('guarantees can be linked to a project directly', async () => {
    const A = as('ownerA');
    const g = (await http().post('/bank-guarantees').set(A).send({ companyId: coA, projectId: p3, type: 'ADVANCE_PAYMENT', bankName: 'Global IME', amount: 100 }).expect(201)).body;
    expect(g).toMatchObject({ projectId: p3, beneficiary: 'Mr. Client' });
    expect(g.project.code).toBe('P-003');
    await http().post('/bank-guarantees').set(A).send({ companyId: coA2, projectId: p3, type: 'OTHER', bankName: 'X', amount: 1 }).expect(400);
    await http().post('/bank-guarantees').set(as('ownerB')).send({ companyId: coB, projectId: p3, type: 'OTHER', bankName: 'X', amount: 1 }).expect(404);
    // a guarantee entered on a bid that has a project goes to that project
    const pg = (await http().post('/bank-guarantees').set(A).send({ companyId: coA, bidId: bid1, type: 'RETENTION', bankName: 'Nabil', amount: 10 }).expect(201)).body;
    expect(pg.projectId).toBe(p1);
  });

  it('tenant isolation, roles, module guard, deletes', async () => {
    const B = as('ownerB');
    expect((await http().get('/projects').set(B).expect(200)).body).toEqual([]);
    await http().get(`/projects/${p1}`).set(B).expect(404);
    await http().get(`/projects/${p2}`).set(B).expect(404);
    await http().get(`/projects/${p1}/boq`).set(B).expect(404);
    await http().put(`/projects/${p1}/boq`).set(B).send({ items: [] }).expect(404);
    await http().patch(`/projects/${p1}`).set(B).send({ notes: 'x' }).expect(404);
    await http().post(`/projects/from-bid/${bid1}`).set(B).expect(404);
    expect((await http().get('/projects/won-bids').set(B).expect(200)).body).toEqual([]);
    await http().delete(`/projects/${p3}`).set(as('accA')).expect(403);
    // module off → screens blocked, but a contract-signed bid still creates its project
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { project: false } }).expect(200);
    await http().get('/projects').set(as('ownerA')).expect(403);
    const t3 = (await http().post('/tenders').set(as('ownerA')).send({ ifbNumber: 'T-3', projectTitle: 'Road Three', deadlineDate: '2026-12-20' }).expect(201)).body.id;
    await http().post('/bids').set(as('ownerA')).send({ tenderId: t3, companyId: coA, status: 'CONTRACT_SIGNED', contractSignDate: '2026-12-25' }).expect(201);
    expect(db.db.project.some((p) => p.tenderId === t3)).toBe(true);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { project: true } }).expect(200);
    // deleting a project removes its BOQ and unlinks its guarantees
    await http().delete(`/projects/${p3}`).set(as('dirA')).expect(200);
    expect(db.db.boqItem.filter((b) => b.projectId === p3)).toHaveLength(0);
    expect(db.db.bankGuarantee.some((g) => g.projectId === p3)).toBe(false);
    // deleting the tender keeps the project (unlinked)
    await http().delete(`/tenders/${t1}`).set(as('ownerA')).expect(200);
    expect(db.db.project.find((p) => p.id === p1)).toMatchObject({ tenderId: null, bidId: null });
  });
});
