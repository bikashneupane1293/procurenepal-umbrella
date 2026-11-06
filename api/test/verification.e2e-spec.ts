// Final verification of Phase 6.4A (2026-11-06): persistence of explanations,
// tenant isolation, authorization, and regression of Company / Certificate features.
// Real NestJS app (controllers, ValidationPipe, JWT) + in-memory DB with Decimal columns.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Phase 6.4A verification (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });

  // ids created in tenant A
  let coA: string;
  let coA2: string;
  let certA: string;
  let tenderA: string;
  // ids created in tenant B
  let coB: string;
  let certB: string;
  let tenderB: string;

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    db.db.tenant.push({ id: 'A', name: 'Tenant A' }, { id: 'B', name: 'Tenant B' });
    const users: [string, string, string][] = [
      ['ownerA', 'OWNER', 'A'], ['directorA', 'DIRECTOR', 'A'], ['accountantA', 'ACCOUNTANT', 'A'],
      ['viewerA', 'VIEWER', 'A'], ['ownerB', 'OWNER', 'B'],
    ];
    const jwt = mod.get(JwtService);
    for (const [id, role, tenantId] of users) {
      db.db.user.push({ id, email: `${id}@x.com`, role, tenantId, isActive: true });
      tok[id] = jwt.sign({ sub: id }, { secret: 'test-secret-only' });
    }
    db.db.user.push({ id: 'inactive', email: 'i@x.com', role: 'OWNER', tenantId: 'A', isActive: false });
    tok.inactive = jwt.sign({ sub: 'inactive' }, { secret: 'test-secret-only' });
    tok.forged = jwt.sign({ sub: 'ownerA' }, { secret: 'wrong-secret' });
  });
  afterAll(() => app.close());

  // ------------------------------------------------ authentication
  it('rejects missing, forged and inactive-user tokens', async () => {
    await http().get('/companies').expect(401);
    await http().get('/companies').set(as('forged')).expect(401);
    await http().get('/companies').set(as('inactive')).expect(401);
  });

  // ------------------------------------------------ existing Company + Certificate features (regression)
  it('company create / list / get / duplicate slug still work', async () => {
    coA = (await http().post('/companies').set(as('ownerA')).send({ name: 'Alpha Builders', slug: 'alpha', licenseExpiry: '2028-01-01' }).expect(201)).body.id;
    coA2 = (await http().post('/companies').set(as('ownerA')).send({ name: 'Alpha Two', slug: 'alpha-two', licenseExpiry: '2028-01-01' }).expect(201)).body.id;
    coB = (await http().post('/companies').set(as('ownerB')).send({ name: 'Beta Nirman', slug: 'beta', licenseExpiry: '2028-01-01' }).expect(201)).body.id;
    await http().post('/companies').set(as('ownerA')).send({ name: 'Dup', slug: 'alpha' }).expect(409);
    await http().post('/companies').set(as('ownerB')).send({ name: 'Same slug other tenant', slug: 'alpha' }).expect(201);
    await http().post('/companies').set(as('ownerA')).send({ slug: 'no-name' }).expect(400);
    const list = await http().get('/companies').set(as('ownerA')).expect(200);
    expect(list.body.map((c: any) => c.name).sort()).toEqual(['Alpha Builders', 'Alpha Two']);
    const one = await http().get(`/companies/${coA}`).set(as('ownerA')).expect(200);
    expect(one.body.certificates).toEqual([]);
  });

  it('certificate create (with key activities), list, get, validation and delete still work', async () => {
    const c = await http().post(`/companies/${coA}/certificates`).set(as('ownerA')).send({
      projectName: 'Alpha Road', contractAmount: 400_000_000, fiscalYear: '2081/82', projectType: 'ROAD',
      completionStatus: 'completed', verificationStatus: 'verified', jvShare: 60, jvName: 'Alpha–Gamma JV',
      keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2080/81', quantity: 1500 }],
    }).expect(201);
    certA = c.body.id;
    expect(c.body.activities).toEqual(['Asphalt concrete']);
    expect(c.body.certificateId).toMatch(/^CERT-/);
    expect(c.body.isOpenBid).toBe(true);
    certB = (await http().post(`/companies/${coB}/certificates`).set(as('ownerB')).send({
      projectName: 'Beta Road', contractAmount: 1, fiscalYear: '2081/82', projectType: 'ROAD',
    }).expect(201)).body.id;
    await http().post(`/companies/${coA}/certificates`).set(as('ownerA')).send({ projectName: 'x', contractAmount: 1, fiscalYear: '2081/82', projectType: 'HOSPITAL' }).expect(400);
    await http().post(`/companies/${coA}/certificates`).set(as('ownerA')).send({ projectName: 'x', fiscalYear: '2081/82', projectType: 'ROAD' }).expect(400);
    await http().post(`/companies/${coA}/certificates`).set(as('ownerA')).send({ projectName: 'x', contractAmount: -5, fiscalYear: '2081/82', projectType: 'ROAD' }).expect(400);
    await http().post(`/companies/${coA}/certificates`).set(as('ownerA')).send({ projectName: 'x', contractAmount: 1, fiscalYear: '2081/82', projectType: 'ROAD', outstandingAmount: -1 }).expect(400);
    const extra = await http().post(`/companies/${coA}/certificates`).set(as('ownerA')).send({ projectName: 'Temp', contractAmount: 1, fiscalYear: '2081/82', projectType: 'ROAD' }).expect(201);
    expect((await http().get('/certificates').set(as('ownerA')).expect(200)).body).toHaveLength(2);
    expect((await http().get(`/certificates/${certA}`).set(as('ownerA')).expect(200)).body.company.name).toBe('Alpha Builders');
    await http().delete(`/certificates/${extra.body.id}`).set(as('ownerA')).expect(200);
    expect((await http().get(`/companies/${coA}/certificates`).set(as('ownerA')).expect(200)).body).toHaveLength(1);
  });

  it('certificate PATCH keeps key activities and names in sync and can clear fields', async () => {
    const u = await http().patch(`/certificates/${certA}`).set(as('ownerA')).send({
      keyActivities: [{ name: 'Gabion wall', unit: 'm3', fiscalYear: '2080/81', quantity: 10 }], jvName: null,
    }).expect(200);
    expect(u.body.activities).toEqual(['Gabion wall']);
    expect(u.body.jvName).toBeNull();
    // restore for later checks
    await http().patch(`/certificates/${certA}`).set(as('ownerA')).send({
      keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2080/81', quantity: 1500 }], jvName: 'Alpha–Gamma JV',
    }).expect(200);
    await http().patch(`/certificates/${certA}`).set(as('ownerA')).send({ companyId: coA2 }).expect(400); // cannot move between companies
  });

  // ------------------------------------------------ tenders + persisted explanations
  it('evaluation result is persisted exactly as returned (checks, warnings, summary, rule set)', async () => {
    await http().put(`/companies/${coA}/turnovers`).set(as('ownerA')).send({ items: [{ fiscalYear: '2081/82', amount: 300_000_000 }] }).expect(200);
    tenderA = (await http().post('/tenders').set(as('ownerA')).send({
      ifbNumber: 'A-001', projectTitle: 'Alpha tender', publicationDate: '2026-11-01', deadlineDate: '2026-12-01',
      projectType: 'ROAD', boqAmount: 400_000_000, contractPeriodMonths: 24,
      keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1200 }],
    }).expect(201)).body.id;
    tenderB = (await http().post('/tenders').set(as('ownerB')).send({ ifbNumber: 'B-001', projectTitle: 'Beta', deadlineDate: '2026-12-01' }).expect(201)).body.id;

    const ev = (await http().post(`/tenders/${tenderA}/evaluate/${coA}`).set(as('ownerA')).expect(201)).body.evaluation;
    expect(ev.result).toBe('INDIVIDUAL_ELIGIBLE');
    const t = ev.checks.find((c: any) => c.code === 'TURNOVER');
    expect(t).toMatchObject({ status: 'PASS', required: 300_000_000, actual: 300_000_000 });
    expect(t.reason).toBe('Turnover of the 1 available year Rs 30,00,00,000 meets the required Rs 30,00,00,000 (100%).');

    const saved = (await http().get(`/tenders/${tenderA}/qualifications`).set(as('ownerA')).expect(200)).body;
    expect(saved).toHaveLength(1);
    expect(saved[0].checks).toEqual(ev.checks);
    expect(saved[0].warnings).toEqual(ev.warnings);
    expect(saved[0].explanation).toBe(ev.summary);
    expect(saved[0].result).toBe(ev.result);
    expect(saved[0].ruleSetId).toBe('PPMO-2083-ACT');
    expect(Number(saved[0].turnoverAact)).toBe(300_000_000);
    expect(Number(saved[0].turnoverRequired)).toBe(300_000_000);
    expect(saved[0].keyActivityDetails.map((k: any) => k.code)).toEqual(['KEY_ACTIVITY']);
  });

  it('re-evaluating updates the saved row (no duplicates) and reflects new data', async () => {
    await http().patch(`/certificates/${certA}`).set(as('ownerA')).send({ verificationStatus: 'unverified' }).expect(200);
    const ev = (await http().post(`/tenders/${tenderA}/evaluate/${coA}`).set(as('ownerA')).expect(201)).body.evaluation;
    expect(ev.certificatesPendingDocumentCheck).toBe(1);
    expect(ev.checks.find((c: any) => c.code === 'SIMILAR_CONTRACT').usesUnverified).toBe(true);
    const saved = (await http().get(`/tenders/${tenderA}/qualifications`).set(as('ownerA')).expect(200)).body;
    expect(saved).toHaveLength(1);
    expect(saved[0].warnings.join(' ')).toMatch(/document check/);
    await http().patch(`/certificates/${certA}`).set(as('ownerA')).send({ verificationStatus: 'verified' }).expect(200);
  });

  it('missing data: tender without estimate and company without certificates', async () => {
    const ev = (await http().post(`/tenders/${tenderA}/evaluate/${coA2}`).set(as('ownerA')).expect(201)).body.evaluation;
    expect(ev.result).toBe('NOT_ELIGIBLE');
    expect(ev.checks.find((c: any) => c.code === 'TURNOVER').reason).toMatch(/^No turnover found/);
    const empty = (await http().post('/tenders').set(as('ownerA')).send({ ifbNumber: 'A-EMPTY', projectTitle: 'No req', deadlineDate: '2026-12-01' }).expect(201)).body.id;
    const e2 = (await http().post(`/tenders/${empty}/evaluate/${coA}`).set(as('ownerA')).expect(201)).body.evaluation;
    expect(e2.summary).toMatch(/No turnover, similar contract or key activity requirement/);
    expect(e2.checks.filter((c: any) => c.status === 'NOT_REQUIRED').map((c: any) => c.code)).toEqual(['TURNOVER', 'BID_CAPACITY', 'SIMILAR_CONTRACT']);
  });

  // ------------------------------------------------ tenant isolation
  it('tenant B cannot read, change, evaluate or delete tenant A data (404, never 200)', async () => {
    const B = as('ownerB');
    await http().get(`/companies/${coA}`).set(B).expect(404);
    await http().patch(`/companies/${coA}`).set(B).send({ name: 'x' }).expect(404);
    await http().delete(`/companies/${coA}`).set(B).expect(404);
    await http().get(`/companies/${coA}/certificates`).set(B).expect(200).expect([]);
    await http().post(`/companies/${coA}/certificates`).set(B).send({ projectName: 'x', contractAmount: 1, fiscalYear: '2081/82', projectType: 'ROAD' }).expect(404);
    await http().get(`/certificates/${certA}`).set(B).expect(404);
    await http().patch(`/certificates/${certA}`).set(B).send({ projectName: 'hijack' }).expect(404);
    await http().delete(`/certificates/${certA}`).set(B).expect(404);
    await http().get(`/companies/${coA}/turnovers`).set(B).expect(404);
    await http().put(`/companies/${coA}/turnovers`).set(B).send({ items: [] }).expect(404);
    await http().get(`/tenders/${tenderA}`).set(B).expect(404);
    await http().patch(`/tenders/${tenderA}`).set(B).send({ projectTitle: 'x' }).expect(404);
    await http().delete(`/tenders/${tenderA}`).set(B).expect(404);
    await http().get(`/tenders/${tenderA}/qualifications`).set(B).expect(404);
    await http().post(`/tenders/${tenderA}/evaluate-all`).set(B).expect(404);
    // own tender, other tenant's company
    await http().post(`/tenders/${tenderB}/evaluate/${coA}`).set(B).expect(404);
    await http().post(`/tenders/${tenderB}/evaluate-jv`).set(B).send({ partners: [{ companyId: coB, share: 60 }, { companyId: coA, share: 40 }] }).expect(404);
    await http().get(`/tenders/${tenderB}/jv-partners/${coA}`).set(B).expect(404);
    await http().post('/qualification/evaluate').set(B).send({ companyId: coA }).expect(404);
    await http().post('/qualification/evaluate').set(B).send({ companyId: coB, tenderId: tenderA }).expect(404);
    // and the other direction: tenant A cannot touch tenant B's certificate
    await http().get(`/certificates/${certB}`).set(as('ownerA')).expect(404);
    await http().patch(`/certificates/${certB}`).set(as('ownerA')).send({ projectName: 'x' }).expect(404);
    await http().delete(`/certificates/${certB}`).set(as('ownerA')).expect(404);
    // tenant A data unchanged
    expect((await http().get(`/certificates/${certA}`).set(as('ownerA')).expect(200)).body.projectName).toBe('Alpha Road');
  });

  it('partner finder and evaluate-all only ever use the caller\'s own companies', async () => {
    const p = (await http().get(`/tenders/${tenderA}/jv-partners/${coA}`).set(as('ownerA')).expect(200)).body;
    expect(p.suggestions.map((s: any) => s.partnerName)).toEqual(['Alpha Two']);
    const all = (await http().post(`/tenders/${tenderA}/evaluate-all`).set(as('ownerA')).expect(201)).body;
    expect(all.results.map((r: any) => r.companyName).sort()).toEqual(['Alpha Builders', 'Alpha Two']);
    expect(db.db.qualificationResult.filter((r) => r.tenantId === 'A').every((r) => r.tenderId !== tenderB)).toBe(true);
    expect(db.db.qualificationResult.filter((r) => r.tenantId === 'B')).toHaveLength(0);
  });

  // ------------------------------------------------ authorization (roles)
  it('roles: delete tender = Owner/Director only; delete company = Owner only; others may read and evaluate', async () => {
    const t1 = (await http().post('/tenders').set(as('accountantA')).send({ ifbNumber: 'A-DEL1', projectTitle: 'x', deadlineDate: '2026-12-01' }).expect(201)).body.id;
    await http().delete(`/tenders/${t1}`).set(as('accountantA')).expect(403);
    await http().delete(`/tenders/${t1}`).set(as('viewerA')).expect(403);
    await http().delete(`/tenders/${t1}`).set(as('directorA')).expect(200);
    await http().post(`/tenders/${tenderA}/evaluate/${coA}`).set(as('accountantA')).expect(201);
    await http().delete(`/companies/${coA2}`).set(as('directorA')).expect(403);
    await http().delete(`/companies/${coA2}`).set(as('accountantA')).expect(403);
    const del = await http().delete(`/companies/${coA2}`).set(as('ownerA')).expect(200);
    expect(del.body.qualificationResultsDeleted).toBe(1);
  });

  it('JV evaluation validates input', async () => {
    const A = as('ownerA');
    await http().post(`/tenders/${tenderA}/evaluate-jv`).set(A).send({ partners: [{ companyId: coA, share: 100 }, { companyId: coA, share: 0 }] }).expect(400);
    await http().post(`/tenders/${tenderA}/evaluate-jv`).set(A).send({ partners: [] }).expect(400);
    await http().post(`/tenders/${tenderA}/evaluate-jv`).set(A).send({ partners: [{ companyId: coA, share: 50 }, { companyId: 'nope', share: 50 }] }).expect(404);
  });
});
