// API tests for Phase 6.4A / 6.5 — real NestJS app (controllers, ValidationPipe,
// JWT guard) with an in-memory database. Run: npm run test:e2e
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Qualification API (e2e, in-memory DB)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  let owner: string;
  let accountant: string;
  let otherTenant: string;
  const T1 = 'tenant-1';
  const T2 = 'tenant-2';

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    db.db.tenant.push({ id: T1, name: 'Cuidado', isActive: true }, { id: T2, name: 'Other', isActive: true });
    db.db.user.push(
      { id: 'u-owner', email: 'admin@griha.com', role: 'OWNER', tenantId: T1, isActive: true },
      { id: 'u-acc', email: 'acc@cuidado.com', role: 'ACCOUNTANT', tenantId: T1, isActive: true },
      { id: 'u-other', email: 'x@other.com', role: 'OWNER', tenantId: T2, isActive: true },
    );
    const jwt = mod.get(JwtService);
    const sign = (sub: string) => jwt.sign({ sub }, { secret: 'test-secret-only' });
    owner = sign('u-owner');
    accountant = sign('u-acc');
    otherTenant = sign('u-other');
  });

  afterAll(async () => app.close());

  let leadId: string;
  let partnerId: string;
  let tenderId: string;

  it('rejects requests without a token', async () => {
    await http().get('/tenders').expect(401);
  });

  it('creates companies, certificates (with outstanding amount) and audited turnover', async () => {
    const lead = await http().post('/companies').set(auth(owner))
      .send({ name: 'Cuidado Builders', slug: 'cuidado-builders', licenseClass: 'A', licenseExpiry: '2028-01-01' }).expect(201);
    leadId = lead.body.id;
    const partner = await http().post('/companies').set(auth(owner))
      .send({ name: 'Partner Nirman', slug: 'partner-nirman', licenseExpiry: '2028-01-01' }).expect(201);
    partnerId = partner.body.id;

    await http().post(`/companies/${leadId}/certificates`).set(auth(owner)).send({
      projectName: 'Ring Road Section 3', contractAmount: 400_000_000, fiscalYear: '2081/82', projectType: 'ROAD',
      completionStatus: 'completed', verificationStatus: 'verified',
      keyActivities: [{ name: 'Asphalt concrete', unit: 'm3', fiscalYear: '2080/81', quantity: 800 }],
    }).expect(201);
    const running = await http().post(`/companies/${leadId}/certificates`).set(auth(owner)).send({
      projectName: 'Running Bridge', contractAmount: 100_000_000, fiscalYear: '2082/83', projectType: 'BRIDGE',
      completionStatus: 'in_progress', outstandingAmount: 60_000_000, completionDate: '2027-11-01',
    }).expect(201);
    expect(running.body.isOpenBid).toBe(true);
    expect(Number(running.body.outstandingAmount)).toBe(60_000_000); // Decimal → string in JSON, like real Prisma

    await http().post(`/companies/${partnerId}/certificates`).set(auth(owner)).send({
      projectName: 'District Road', contractAmount: 50_000_000, fiscalYear: '2081/82', projectType: 'ROAD',
      completionStatus: 'completed',
      keyActivities: [{ name: 'Asphalt Concrete', unit: 'cum', fiscalYear: '2080/81', quantity: 500 }],
    }).expect(201);

    const t = await http().put(`/companies/${leadId}/turnovers`).set(auth(owner))
      .send({ items: [{ fiscalYear: '2081/82', amount: 450_000_000 }, { fiscalYear: '2080/81', amount: 440_000_000 }] })
      .expect(200);
    expect(t.body.map((x: any) => x.fiscalYear)).toEqual(['2081/82', '2080/81']);
    await http().put(`/companies/${partnerId}/turnovers`).set(auth(owner))
      .send({ items: [{ fiscalYear: '2081/82', amount: 250_000_000 }] }).expect(200);
  });

  it('validates turnover input', async () => {
    await http().put(`/companies/${leadId}/turnovers`).set(auth(owner))
      .send({ items: [{ fiscalYear: '81/82', amount: 1 }] }).expect(400);
    await http().put(`/companies/${leadId}/turnovers`).set(auth(owner))
      .send({ items: [{ fiscalYear: '2081/82', amount: 1 }, { fiscalYear: '2081/82', amount: 2 }] }).expect(400);
  });

  it('creates a tender with key activity requirements and rejects bad criteria', async () => {
    await http().post('/tenders').set(auth(owner)).send({
      ifbNumber: 'BAD-1', projectTitle: 'x', deadlineDate: '2026-12-01', criteria: { jvMinEachPercent: 150 },
    }).expect(400);
    await http().post('/tenders').set(auth(owner)).send({
      ifbNumber: 'BAD-2', projectTitle: 'x', deadlineDate: '2026-12-01', hackerField: 1,
    }).expect(400);

    const res = await http().post('/tenders').set(auth(owner)).send({
      ifbNumber: 'DOR/NCB/2083-84/07',
      projectTitle: 'Upgrading of Feeder Road',
      procuringEntity: 'Department of Roads',
      publicationDate: '2026-11-01',
      deadlineDate: '2026-12-01',
      projectType: 'ROAD',
      boqAmount: 900_000_000,
      contractPeriodMonths: 24,
      keyActivityReqs: [{ name: 'Asphalt concrete', unit: 'm3', quantity: 1200 }],
    }).expect(201);
    tenderId = res.body.id;
    expect(res.body.keyActivityReqs).toHaveLength(1);
    await http().post('/tenders').set(auth(owner))
      .send({ ifbNumber: 'DOR/NCB/2083-84/07', projectTitle: 'dup', deadlineDate: '2026-12-01' }).expect(409);
  });

  it('evaluates a single company with reasons and saves the result', async () => {
    const res = await http().post(`/tenders/${tenderId}/evaluate/${leadId}`).set(auth(owner)).expect(201);
    const ev = res.body.evaluation;
    expect(ev.result).toBe('JV_REQUIRED');
    expect(ev.suggestedJvRole).toBe('LEAD');
    expect(ev.ruleSet.id).toBe('PPMO-2083-ACT');
    const codes = ev.checks.map((c: any) => c.code);
    expect(codes).toEqual(['LICENSE', 'RUNNING_CONTRACTS', 'TURNOVER', 'BID_CAPACITY', 'SIMILAR_CONTRACT', 'KEY_ACTIVITY']);
    for (const c of ev.checks) expect(typeof c.reason).toBe('string');
    expect(ev.checks.find((c: any) => c.code === 'TURNOVER').required).toBe(675_000_000);

    const saved = await http().get(`/tenders/${tenderId}/qualifications`).set(auth(owner)).expect(200);
    expect(saved.body).toHaveLength(1);
    expect(saved.body[0].companyName).toBe('Cuidado Builders');
    expect(saved.body[0].ruleSetId).toBe('PPMO-2083-ACT');
    expect(saved.body[0].checks).toHaveLength(6);
  });

  it('evaluates every company (company-wide bid decision)', async () => {
    const res = await http().post(`/tenders/${tenderId}/evaluate-all`).set(auth(owner)).expect(201);
    expect(res.body.evaluated).toBe(2);
    expect(res.body.counts.JV_REQUIRED + res.body.counts.NOT_ELIGIBLE + res.body.counts.INDIVIDUAL_ELIGIBLE).toBe(2);
  });

  it('evaluates a JV and suggests partners', async () => {
    const res = await http().post(`/tenders/${tenderId}/evaluate-jv`).set(auth(owner)).send({
      partners: [{ companyId: leadId, share: 60, isLead: true }, { companyId: partnerId, share: 40 }],
    }).expect(201);
    expect(res.body.result).toBe('JV_ELIGIBLE');
    expect(res.body.checks.find((c: any) => c.code === 'KEY_ACTIVITY').actual).toBe(1300);

    await http().post(`/tenders/${tenderId}/evaluate-jv`).set(auth(owner))
      .send({ partners: [{ companyId: leadId, share: 60 }] }).expect(400); // needs 2+
    await http().post(`/tenders/${tenderId}/evaluate-jv`).set(auth(owner))
      .send({ partners: [{ companyId: leadId, share: 50 }, { companyId: leadId, share: 50 }] }).expect(400);

    const p = await http().get(`/tenders/${tenderId}/jv-partners/${leadId}`).set(auth(owner)).expect(200);
    expect(p.body.suggestions[0].partnerName).toBe('Partner Nirman');
    expect(p.body.suggestions[0].result).toBe('JV_ELIGIBLE');
  });

  it('quick check endpoint still works with the old request format', async () => {
    const res = await http().post('/qualification/evaluate').set(auth(owner)).send({
      companyId: leadId, requirements: { requiredTurnover: 100_000_000, requiredActivity: 'Asphalt concrete', minimumActivityProduction: 1 },
    }).expect(201);
    expect(res.body.result).toBe('INDIVIDUAL_ELIGIBLE');
    const viaTender = await http().post('/qualification/evaluate').set(auth(owner)).send({ companyId: leadId, tenderId }).expect(201);
    expect(viaTender.body.result).toBe('JV_REQUIRED');
    const rules = await http().get('/qualification/rules').set(auth(owner)).expect(200);
    expect(rules.body.ruleSets.map((r: any) => r.id)).toEqual(['PPMO-LEGACY', 'PPMO-2083-INTERIM', 'PPMO-2083-ACT']);
  });

  it('edits a tender, a company and a certificate (PATCH)', async () => {
    const t = await http().patch(`/tenders/${tenderId}`).set(auth(owner))
      .send({ reqTurnover: 500_000_000, criteria: { turnoverMultiplier: 1.0 } }).expect(200);
    expect(Number(t.body.reqTurnover)).toBe(500_000_000);
    expect(t.body.criteria).toEqual({ turnoverMultiplier: 1.0 });
    const ev = await http().post(`/tenders/${tenderId}/evaluate/${leadId}`).set(auth(owner)).expect(201);
    expect(ev.body.evaluation.checks.find((c: any) => c.code === 'TURNOVER').required).toBe(500_000_000);

    const c = await http().patch(`/companies/${partnerId}`).set(auth(owner)).send({ address: 'Kathmandu' }).expect(200);
    expect(c.body.address).toBe('Kathmandu');
    await http().patch(`/companies/${partnerId}`).set(auth(owner)).send({ slug: 'cuidado-builders' }).expect(409);

    const certs = await http().get(`/companies/${leadId}/certificates`).set(auth(owner)).expect(200);
    const run = certs.body.find((x: any) => x.projectName === 'Running Bridge');
    const upd = await http().patch(`/certificates/${run.id}`).set(auth(owner)).send({ isOpenBid: false, outstandingAmount: 1 }).expect(200);
    expect(upd.body.isOpenBid).toBe(false);
    await http().patch(`/certificates/${run.id}`).set(auth(owner)).send({ jvShare: 150 }).expect(400);
  });

  it('keeps tenants isolated', async () => {
    await http().get(`/tenders/${tenderId}`).set(auth(otherTenant)).expect(404);
    await http().post(`/tenders/${tenderId}/evaluate/${leadId}`).set(auth(otherTenant)).expect(404);
    await http().get(`/companies/${leadId}/turnovers`).set(auth(otherTenant)).expect(404);
    await http().patch(`/companies/${leadId}`).set(auth(otherTenant)).send({ name: 'hijack' }).expect(404);
    const list = await http().get('/tenders').set(auth(otherTenant)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('only Owner/Director can delete a tender; delete removes saved results', async () => {
    await http().delete(`/tenders/${tenderId}`).set(auth(accountant)).expect(403);
    const res = await http().delete(`/tenders/${tenderId}`).set(auth(owner)).expect(200);
    expect(res.body.qualificationResultsDeleted).toBe(2);
    expect(db.db.qualificationResult).toHaveLength(0);
  });

  it('deleting a company still works and removes its turnover rows (Owner only)', async () => {
    await http().delete(`/companies/${partnerId}`).set(auth(accountant)).expect(403);
    await http().delete(`/companies/${partnerId}`).set(auth(owner)).expect(200);
    expect(db.db.annualTurnover.filter((t) => t.companyId === partnerId)).toHaveLength(0);
  });
});
