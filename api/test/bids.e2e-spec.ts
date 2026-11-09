// Task 1 — Bid Information Management + Bolpatra Reports (real NestJS app, in-memory DB).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { tenderStatusFromBids, defaultChecklist } from '../src/bid/bid.constants';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Bid status → tender status rule', () => {
  it('follows the most advanced bid', () => {
    expect(tenderStatusFromBids([])).toBe('active');
    expect(tenderStatusFromBids(['PREPARING'])).toBe('active');
    expect(tenderStatusFromBids(['PREPARING', 'SUBMITTED'])).toBe('submitted');
    expect(tenderStatusFromBids(['LOST', 'INTENTION_TO_AWARD'])).toBe('submitted');
    expect(tenderStatusFromBids(['LOST', 'AWARDED'])).toBe('won');
    expect(tenderStatusFromBids(['CONTRACT_SIGNED'])).toBe('won');
    expect(tenderStatusFromBids(['LOST', 'WITHDRAWN'])).toBe('lost');
    expect(tenderStatusFromBids(['WITHDRAWN'])).toBe('active');
    expect(tenderStatusFromBids(['CANCELLED', 'CANCELLED'])).toBe('cancelled');
  });
  it('checklist adds the JV agreement only for JV bids', () => {
    expect(defaultChecklist(false).some((c) => c.key === 'jv_agreement')).toBe(false);
    expect(defaultChecklist(true).some((c) => c.key === 'jv_agreement')).toBe(true);
    expect(defaultChecklist(true).every((c) => c.done === false)).toBe(true);
  });
});

describe('Bids + Reports API (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  let coA: string, coA2: string, coB: string, t1: string, t2: string, tB: string, bid1: string;

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
    coA = (await http().post('/companies').set(A).send({ name: 'Alpha Builders', slug: 'alpha', licenseExpiry: '2026-12-01' }).expect(201)).body.id;
    coA2 = (await http().post('/companies').set(A).send({ name: 'Alpha Two', slug: 'alpha-two' }).expect(201)).body.id;
    coB = (await http().post('/companies').set(as('ownerB')).send({ name: 'Beta', slug: 'beta' }).expect(201)).body.id;
    await http().post(`/companies/${coA}/certificates`).set(A).send({ projectName: 'Road', contractAmount: 1, fiscalYear: '2081/82', projectType: 'ROAD' }).expect(201);
    t1 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-1', projectTitle: 'Road One', deadlineDate: '2026-11-20', boqAmount: 100_000_000, bidSecurityAmount: 2_500_000, bidValidityDays: 90 }).expect(201)).body.id;
    t2 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-2', projectTitle: 'Road Two', deadlineDate: '2026-11-15' }).expect(201)).body.id;
    tB = (await http().post('/tenders').set(as('ownerB')).send({ ifbNumber: 'B-1', projectTitle: 'Beta', deadlineDate: '2026-12-01' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('creates a bid with tender defaults (bid security, validity) and the standard checklist', async () => {
    const r = (await http().post('/bids').set(as('ownerA')).send({ tenderId: t1, companyId: coA }).expect(201)).body;
    bid1 = r.id;
    expect(r).toMatchObject({ status: 'PREPARING', decision: 'UNDECIDED', bidderType: 'SINGLE' });
    expect(Number(r.bidSecurityAmount)).toBe(2_500_000);
    expect(new Date(r.bidValidityExpiry).toISOString().slice(0, 10)).toBe('2027-02-18'); // 20 Nov + 90 days
    expect(r.checklist.length).toBe(13);
    expect(r.tender.ifbNumber).toBe('T-1');
    expect(r.company.name).toBe('Alpha Builders');
    expect(r.statusHistory).toHaveLength(1);
    await http().post('/bids').set(as('ownerA')).send({ tenderId: t1, companyId: coA }).expect(409);
  });

  it('validates input and rules', async () => {
    const A = as('ownerA');
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, status: 'WON' }).expect(400);
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidAmount: -1 }).expect(400);
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, decision: 'NO_BID', status: 'SUBMITTED' }).expect(400);
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidSecurityIssueDate: '2026-11-10', bidSecurityExpiry: '2026-11-01' }).expect(400);
    // JV rules
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidderType: 'JV', jvPartners: [{ companyId: coA, share: 60 }] }).expect(400);
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidderType: 'JV', jvPartners: [{ companyId: coA, share: 60 }, { companyId: coA2, share: 30 }] }).expect(400);
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidderType: 'JV', jvPartners: [{ companyId: coA2, share: 60 }, { companyId: coB, share: 40 }] }).expect(400);
    await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidderType: 'JV', jvPartners: [{ companyId: coA, share: 60 }, { companyId: coB, share: 40 }] }).expect(404); // other workspace
  });

  it('JV bid stores partners with names and adds the JV-agreement checklist item', async () => {
    const r = (await http().post('/bids').set(as('ownerA')).send({
      tenderId: t2, companyId: coA, bidderType: 'JV', decision: 'BID',
      jvPartners: [{ companyId: coA, share: 60, isLead: true }, { companyId: coA2, share: 40 }],
    }).expect(201)).body;
    expect(r.jvPartners).toEqual([
      { companyId: coA, name: 'Alpha Builders', share: 60, isLead: true },
      { companyId: coA2, name: 'Alpha Two', share: 40, isLead: false },
    ]);
    expect(r.checklist.some((c: any) => c.key === 'jv_agreement')).toBe(true);
  });

  it('status changes are logged and move the tender status automatically', async () => {
    const A = as('ownerA');
    const tenderStatus = async () => (await http().get(`/tenders/${t1}`).set(A).expect(200)).body.status;
    expect(await tenderStatus()).toBe('active');
    const s = (await http().patch(`/bids/${bid1}`).set(A).send({ status: 'SUBMITTED', bidAmount: 95_000_000, submittedAt: '2026-11-19' }).expect(200)).body;
    expect(s.decision).toBe('BID'); // a submitted bid is a "bid" decision
    expect(s.statusHistory.map((h: any) => h.status)).toEqual(['PREPARING', 'SUBMITTED']);
    expect(await tenderStatus()).toBe('submitted');
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'AWARDED', awardDate: '2026-12-20', contractSignDate: '2026-12-10' }).expect(400); // sign before award
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'AWARDED', awardDate: '2026-12-20', contractAmount: 95_000_000, performanceSecurityAmount: 4_750_000, performanceSecurityExpiry: '2026-11-30' }).expect(200);
    expect(await tenderStatus()).toBe('won');
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'LOST' }).expect(200);
    expect(await tenderStatus()).toBe('lost');
    await http().patch(`/bids/${bid1}`).set(A).send({ tenderId: t2 }).expect(400); // cannot move
    // a status chosen by hand is not overwritten when bids say "active"
    await http().patch(`/tenders/${t2}`).set(A).send({ status: 'cancelled' }).expect(200);
    const b2 = (await http().get(`/bids?tenderId=${t2}`).set(A).expect(200)).body[0];
    await http().patch(`/bids/${b2.id}`).set(A).send({ notes: 'x' }).expect(200);
    expect((await http().get(`/tenders/${t2}`).set(A).expect(200)).body.status).toBe('cancelled');
  });

  it('checklist ticks are saved; detail shows the saved qualification result', async () => {
    const A = as('ownerA');
    const cur = (await http().get(`/bids/${bid1}`).set(A).expect(200)).body;
    const ticked = cur.checklist.map((c: any, i: number) => ({ ...c, done: i < 3 }));
    const r = (await http().patch(`/bids/${bid1}`).set(A).send({ checklist: ticked }).expect(200)).body;
    expect(r.checklist.filter((c: any) => c.done)).toHaveLength(3);
    expect((await http().get(`/bids/${bid1}`).set(A).expect(200)).body.qualification).toBeNull();
    await http().post(`/tenders/${t1}/evaluate/${coA}`).set(A).expect(201);
    const d = (await http().get(`/bids/${bid1}`).set(A).expect(200)).body;
    expect(d.qualification.result).toBeDefined();
  });

  it('reports summarise bids, win rate, expiries, deadlines and per-company figures', async () => {
    const A = as('ownerA');
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'CONTRACT_SIGNED', contractSignDate: '2026-12-25', bidSecurityExpiry: '2026-11-25', bidSecurityBank: 'Nabil Bank' }).expect(200);
    const r = (await http().get('/bolpatra/reports?days=60').set(A).expect(200)).body;
    expect(r.windowDays).toBe(60);
    expect(r.bids).toMatchObject({ total: 2, won: 1, lost: 0, winRate: 100 });
    expect(r.bids.wonValue).toBe(95_000_000);
    expect(r.bids.byStatus.CONTRACT_SIGNED).toBe(1);
    expect(r.tenders.byStatus).toMatchObject({ won: 1, cancelled: 1 });
    expect(r.expiring.performanceSecurities[0]).toMatchObject({ ifbNumber: 'T-1', amount: 4_750_000 });
    expect(r.expiring.bidSecurities[0]).toMatchObject({ ifbNumber: 'T-1', bank: 'Nabil Bank' });
    expect(r.expiring.licences.map((l: any) => l.company)).toEqual(['Alpha Builders']);
    expect(r.expiring.missingLicence).toEqual(['Alpha Two']);
    expect(r.documents).toMatchObject({ pendingCertificates: 1, totalCertificates: 1 });
    const alpha = r.perCompany.find((c: any) => c.company === 'Alpha Builders');
    expect(alpha).toMatchObject({ bids: 2, won: 1, winRate: 100, tendersChecked: 1, pendingDocumentChecks: 1 });
    const two = r.perCompany.find((c: any) => c.company === 'Alpha Two');
    expect(two.bids).toBe(1); // as JV partner
    expect(r.months).toHaveLength(12);
    await http().get('/bolpatra/reports?days=abc').set(A).expect(200); // falls back to 30
    // moving straight to a post-submission status fills submittedAt (so the 12-month chart counts it)
    const t3 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-3', projectTitle: 'Road Three', deadlineDate: '2026-11-20' }).expect(201)).body.id;
    const b3 = (await http().post('/bids').set(A).send({ tenderId: t3, companyId: coA2 }).expect(201)).body;
    expect(b3.submittedAt).toBeFalsy();
    const o3 = (await http().patch(`/bids/${b3.id}`).set(A).send({ status: 'OPENED' }).expect(200)).body;
    expect(o3.submittedAt).toBeTruthy();
    await http().delete(`/tenders/${t3}`).set(A).expect(200);
  });

  it('tenant isolation, roles, module guard, cascades', async () => {
    const B = as('ownerB');
    await http().get(`/bids/${bid1}`).set(B).expect(404);
    await http().patch(`/bids/${bid1}`).set(B).send({ notes: 'x' }).expect(404);
    await http().delete(`/bids/${bid1}`).set(B).expect(404);
    await http().post('/bids').set(B).send({ tenderId: t1, companyId: coB }).expect(404);
    await http().post('/bids').set(B).send({ tenderId: tB, companyId: coA }).expect(404);
    expect((await http().get('/bids').set(B).expect(200)).body).toEqual([]);
    expect((await http().get('/bolpatra/reports').set(B).expect(200)).body.bids.total).toBe(0);
    // roles
    await http().delete(`/bids/${bid1}`).set(as('accA')).expect(403);
    // module switched off → 403
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { bolpatra: false } }).expect(200);
    await http().get('/bids').set(as('ownerA')).expect(403);
    await http().get('/bolpatra/reports').set(as('ownerA')).expect(403);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { bolpatra: true } }).expect(200);
    // delete bid (Director) → tender recalculated
    const b2 = (await http().get(`/bids?tenderId=${t2}`).set(as('ownerA')).expect(200)).body[0];
    await http().delete(`/bids/${b2.id}`).set(as('dirA')).expect(200);
    // deleting a tender deletes its bids
    await http().delete(`/tenders/${t1}`).set(as('ownerA')).expect(200);
    expect(db.db.bid.filter((b) => b.tenderId === t1)).toHaveLength(0);
  });
});
