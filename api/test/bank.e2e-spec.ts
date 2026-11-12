// Task 2 — Banks + Bank Guarantee Management, linked to Bolpatra bids (real NestJS app, in-memory DB).
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { alertsFor, estimateCommission } from '../src/bank/bank.constants';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';
const D = (s: string) => new Date(s);
const day = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const inDays = (k: number) => new Date(Date.now() + k * 86_400_000).toISOString().slice(0, 10);

describe('Bank rules', () => {
  it('estimates commission per quarter, per year or flat', () => {
    expect(estimateCommission(1_000_000, 0.5, 'QUARTER', D('2026-01-01'), D('2026-04-11'))).toBe(10_000); // 100 days = 2 quarters
    expect(estimateCommission(1_000_000, 0.5, 'QUARTER', D('2026-01-01'), D('2026-03-15'))).toBe(5_000);
    expect(estimateCommission(1_000_000, 1, 'YEAR', D('2026-01-01'), D('2027-02-05'))).toBe(20_000);
    expect(estimateCommission(1_000_000, 0.25, 'FLAT', null, null)).toBe(2_500);
    expect(estimateCommission(1_000_000, 0.5, 'QUARTER', null, null)).toBeNull();
    expect(estimateCommission(1_000_000, null, 'QUARTER', D('2026-01-01'), D('2026-02-01'))).toBeNull();
  });
  it('raises plain-language alerts', () => {
    const today = D('2026-11-12');
    const codes = (g: any, bid: any = null) => alertsFor(g, bid, today, 30).map((a) => a.code);
    expect(codes({ status: 'ACTIVE', guaranteeNo: 'x', expiryDate: '2026-11-01' })).toEqual(['EXPIRED_OPEN']);
    expect(codes({ status: 'ACTIVE', guaranteeNo: 'x', expiryDate: '2026-12-01' })).toEqual(['EXPIRING']);
    expect(codes({ status: 'RELEASED', expiryDate: '2026-11-01' })).toEqual([]);
    expect(codes({ status: 'ACTIVE', expiryDate: '2027-06-01' })).toEqual(['NO_NUMBER']);
    const bid = { status: 'SUBMITTED', bidValidityExpiry: '2027-02-18' };
    expect(codes({ type: 'BID_SECURITY', status: 'ACTIVE', guaranteeNo: 'x', expiryDate: '2027-03-01' }, bid)).toEqual(['SHORT_VALIDITY']);
    expect(codes({ type: 'BID_SECURITY', status: 'ACTIVE', guaranteeNo: 'x', expiryDate: '2027-03-20' }, bid)).toEqual([]);
    expect(codes({ type: 'BID_SECURITY', status: 'ACTIVE', guaranteeNo: 'x', expiryDate: '2027-03-20' }, { ...bid, status: 'LOST' })).toEqual(['RELEASE_DUE']);
    expect(codes({ type: 'PERFORMANCE', status: 'REQUESTED', expiryDate: '2028-01-01' }, { status: 'LOST' })).toEqual(['RELEASE_DUE']);
  });
});

describe('Banks + Bank Guarantees API (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  let coA: string, coA2: string, coB: string, t1: string, t2: string, bid1: string, nabil: string, bgBid: string, bgAdv: string;

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
    t1 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-1', projectTitle: 'Road One', procuringEntity: 'DoR Division Office', deadlineDate: '2026-11-20', bidSecurityAmount: 2_500_000, bidValidityDays: 90 }).expect(201)).body.id;
    t2 = (await http().post('/tenders').set(A).send({ ifbNumber: 'T-2', projectTitle: 'Road Two', deadlineDate: '2026-12-15' }).expect(201)).body.id;
  });
  afterAll(() => app.close());

  it('banks: create, duplicate check, tenant check, limit use', async () => {
    const A = as('ownerA');
    const b = (await http().post('/banks').set(A).send({ companyId: coA, name: 'Nabil Bank Limited', branch: 'Kathmandu', bgLimit: 10_000_000, defaultMarginPct: 10, defaultCommissionPct: 0.5, commissionBasis: 'QUARTER' }).expect(201)).body;
    nabil = b.id;
    expect(b).toMatchObject({ name: 'Nabil Bank Limited', used: 0, available: 10_000_000, usedPct: 0, openGuarantees: 0 });
    expect(b.company.name).toBe('Alpha Builders');
    await http().post('/banks').set(A).send({ companyId: coA, name: ' nabil bank limited ', branch: 'kathmandu' }).expect(409);
    await http().post('/banks').set(A).send({ companyId: coA, name: 'Nabil Bank Limited', branch: 'Pokhara' }).expect(201); // other branch is fine
    await http().post('/banks').set(A).send({ companyId: coB, name: 'X' }).expect(404);
    await http().post('/banks').set(A).send({ companyId: coA, name: 'X', email: 'not-an-email' }).expect(400);
    await http().post('/banks').set(A).send({ companyId: coA2, name: 'Himalayan Bank' }).expect(201);
    expect((await http().get(`/banks?companyId=${coA}`).set(A).expect(200)).body).toHaveLength(2);
  });

  it('a bank-guarantee bid security on a bid creates the guarantee automatically', async () => {
    const A = as('ownerA');
    bid1 = (await http().post('/bids').set(A).send({ tenderId: t1, companyId: coA }).expect(201)).body.id;
    expect((await http().get(`/bank-guarantees?bidId=${bid1}`).set(A).expect(200)).body).toHaveLength(0); // no security details yet
    await http().patch(`/bids/${bid1}`).set(A).send({
      status: 'SUBMITTED', bidSecurityType: 'BANK_GUARANTEE', bidSecurityBank: 'Nabil Bank Limited', bidSecurityRef: 'BG/KTM/1',
      bidSecurityIssueDate: '2026-11-18', bidSecurityExpiry: '2027-03-20',
    }).expect(200);
    const l = (await http().get(`/bank-guarantees?bidId=${bid1}`).set(A).expect(200)).body;
    expect(l).toHaveLength(1);
    const g = l[0];
    bgBid = g.id;
    expect(g).toMatchObject({ type: 'BID_SECURITY', status: 'ACTIVE', source: 'BID', bankId: nabil, guaranteeNo: 'BG/KTM/1', beneficiary: 'DoR Division Office', tenderId: t1 });
    expect(Number(g.amount)).toBe(2_500_000);
    expect(Number(g.marginAmount)).toBe(250_000); // 10% bank default
    expect(Number(g.commissionAmount)).toBe(25_000); // 0.5% × 2 quarters (122 days)
    expect(g.alerts).toEqual([]);
    // the bid shows the guarantee
    expect((await http().get(`/bids/${bid1}`).set(A).expect(200)).body.guarantees.map((x: any) => x.id)).toEqual([bgBid]);
    // saving the bid again does not duplicate; changed expiry flows through
    await http().patch(`/bids/${bid1}`).set(A).send({ notes: 'again' }).expect(200);
    await http().patch(`/bids/${bid1}`).set(A).send({ bidSecurityExpiry: '2027-04-20' }).expect(200);
    const g2 = (await http().get(`/bank-guarantees/${bgBid}`).set(A).expect(200)).body;
    expect(day(g2.expiryDate)).toBe('2027-04-20');
    expect(g2.history.map((h: any) => h.action)).toEqual(['CREATED_FROM_BID', 'SYNCED_FROM_BID']);
    expect(db.db.bankGuarantee).toHaveLength(1);
  });

  it('editing the guarantee updates the bid; history names the change; short validity warns', async () => {
    const A = as('ownerA');
    const g = (await http().patch(`/bank-guarantees/${bgBid}`).set(A).send({ expiryDate: '2027-05-01' }).expect(200)).body;
    expect(g.history.at(-1).action).toBe('EXTENDED');
    expect(day((await http().get(`/bids/${bid1}`).set(A).expect(200)).body.bidSecurityExpiry)).toBe('2027-05-01');
    // bid validity ends 2027-02-18; +30 days = 2027-03-20
    const s = (await http().patch(`/bank-guarantees/${bgBid}`).set(A).send({ expiryDate: '2027-03-01' }).expect(200)).body;
    expect(s.alerts.map((a: any) => a.code)).toEqual(['SHORT_VALIDITY']);
    await http().patch(`/bank-guarantees/${bgBid}`).set(A).send({ expiryDate: '2027-05-01' }).expect(200);
    await http().patch(`/bank-guarantees/${bgBid}`).set(A).send({ issueDate: '2027-06-01' }).expect(400);
    await http().patch(`/bank-guarantees/${bgBid}`).set(A).send({ claimExpiryDate: '2027-04-01' }).expect(400);
  });

  it('manual guarantees: validation, typed bank later added to the list, expiry alert', async () => {
    const A = as('ownerA');
    await http().post('/bank-guarantees').set(A).send({ companyId: coA, type: 'ADVANCE_PAYMENT', amount: 5_000_000 }).expect(400); // no bank
    await http().post('/bank-guarantees').set(A).send({ companyId: coA, type: 'NOPE', bankName: 'X', amount: 1 }).expect(400);
    const him = (await http().get(`/banks?companyId=${coA2}`).set(A).expect(200)).body[0].id;
    await http().post('/bank-guarantees').set(A).send({ companyId: coA, bankId: him, type: 'OTHER', amount: 1000 }).expect(400); // bank of another company
    await http().post('/bank-guarantees').set(A).send({ companyId: coA, bankName: 'Nabil Bank Limited', guaranteeNo: 'BG/KTM/1', type: 'OTHER', amount: 1000 }).expect(409);
    await http().post('/bank-guarantees').set(A).send({ companyId: coA, bankName: 'X', type: 'OTHER', amount: 1000, bidId: bid1 }).expect(201); // OTHER type on the same bid is allowed
    await http().post('/bank-guarantees').set(A).send({ companyId: coA, bankName: 'X', type: 'BID_SECURITY', amount: 1000, bidId: bid1 }).expect(409);
    await http().post('/bank-guarantees').set(A).send({ companyId: coA2, bankName: 'X', type: 'OTHER', amount: 1000, bidId: bid1 }).expect(400); // not the bidder
    const adv = (await http().post('/bank-guarantees').set(A).send({ companyId: coA, bankName: 'Global IME Bank', type: 'ADVANCE_PAYMENT', amount: 5_000_000, tenderId: t1, issueDate: inDays(-20), expiryDate: inDays(10) }).expect(201)).body;
    bgAdv = adv.id;
    expect(adv).toMatchObject({ status: 'REQUESTED', bankId: null, beneficiary: 'DoR Division Office' });
    expect(adv.alerts.map((a: any) => a.code)).toEqual(['EXPIRING']);
    const gi = (await http().post('/banks').set(A).send({ companyId: coA, name: 'Global IME Bank', defaultMarginPct: 20 }).expect(201)).body;
    expect(gi.openGuarantees).toBe(1); // attached in the background
    expect((await http().get(`/bank-guarantees/${bgAdv}`).set(A).expect(200)).body.bankId).toBe(gi.id);
    // choosing the bank later fills margin from its default
    const m = (await http().patch(`/bank-guarantees/${bgAdv}`).set(A).send({ bankId: gi.id, amount: 6_000_000 }).expect(200)).body;
    expect(Number(m.amount)).toBe(6_000_000);
    expect(m.history.at(-1).action).toBe('AMOUNT_AMENDED');
  });

  it('a won bid creates the performance guarantee; the bid security becomes release-due', async () => {
    const A = as('ownerA');
    await http().patch(`/bids/${bid1}`).set(A).send({ status: 'CONTRACT_SIGNED', awardDate: '2026-12-20', contractSignDate: '2026-12-28', performanceSecurityAmount: 4_750_000, performanceSecurityExpiry: '2028-01-01' }).expect(200);
    const l = (await http().get(`/bank-guarantees?bidId=${bid1}&type=PERFORMANCE`).set(A).expect(200)).body;
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ status: 'REQUESTED', bankName: 'Nabil Bank Limited', bankId: nabil, source: 'BID' });
    expect(Number(l[0].amount)).toBe(4_750_000);
    const bs = (await http().get(`/bank-guarantees/${bgBid}`).set(A).expect(200)).body;
    expect(bs.alerts.map((a: any) => a.code)).toEqual(['RELEASE_DUE']);
  });

  it('summary: totals, release due, expiring, limit use per bank, over-limit', async () => {
    const A = as('ownerA');
    let s = (await http().get('/bank-guarantees/summary?days=30').set(A).expect(200)).body;
    expect(s.open.count).toBe(4); // bid security, OTHER, advance, performance
    expect(s.open.amount).toBe(2_500_000 + 1000 + 6_000_000 + 4_750_000);
    expect(s.byType.PERFORMANCE).toEqual({ count: 1, amount: 4_750_000 });
    expect(s.releaseDue.map((g: any) => g.id)).toEqual([bgBid]);
    expect(s.expiring.map((g: any) => g.id)).toEqual([bgAdv]);
    const n = s.perBank.find((b: any) => b.bankId === nabil);
    expect(n).toMatchObject({ used: 7_250_000, available: 2_750_000, usedPct: 72.5, count: 2 });
    expect(s.perBank.find((b: any) => b.bank === 'X')).toMatchObject({ bankId: null, used: 1000 });
    expect(s.overLimit).toEqual([]);
    await http().patch(`/banks/${nabil}`).set(A).send({ bgLimit: 5_000_000 }).expect(200);
    s = (await http().get('/bank-guarantees/summary').set(A).expect(200)).body;
    expect(s.overLimit).toEqual(['Nabil Bank Limited']);
  });

  it('releasing closes the guarantee; later bid saves leave it alone', async () => {
    const A = as('ownerA');
    const r = (await http().patch(`/bank-guarantees/${bgBid}`).set(A).send({ status: 'RELEASED', releaseRef: 'DoR letter 123' }).expect(200)).body;
    expect(r.status).toBe('RELEASED');
    expect(r.releaseDate).toBeTruthy();
    expect(r.alerts).toEqual([]);
    expect(r.history.at(-1).action).toBe('STATUS_RELEASED');
    await http().patch(`/bids/${bid1}`).set(A).send({ bidSecurityExpiry: '2027-09-09' }).expect(200);
    expect(day((await http().get(`/bank-guarantees/${bgBid}`).set(A).expect(200)).body.expiryDate)).toBe('2027-05-01');
    expect((await http().get('/bank-guarantees?status=OPEN').set(A).expect(200)).body.map((g: any) => g.status)).not.toContain('RELEASED');
  });

  it('back-fill from bids saved before the Bank System, and linking a hand-entered guarantee', async () => {
    const A = as('ownerA');
    // an older bid already in the database (saved before Task 2)
    db.db.bid.push({ id: 'old-bid', tenantId: 'A', tenderId: t2, companyId: coA2, status: 'SUBMITTED', decision: 'BID', bidderType: 'SINGLE',
      bidSecurityType: 'BANK_GUARANTEE', bidSecurityBank: 'Himalayan Bank', bidSecurityRef: 'HB/9', bidSecurityAmount: 300000, createdAt: new Date(), updatedAt: new Date() });
    expect((await http().post('/bank-guarantees/sync-from-bids').set(A).expect(201)).body).toMatchObject({ created: 1 });
    expect((await http().post('/bank-guarantees/sync-from-bids').set(A).expect(201)).body).toMatchObject({ created: 0, updated: 0 });
    const g = (await http().get('/bank-guarantees?bidId=old-bid').set(A).expect(200)).body[0];
    expect(g.bankId).toBeTruthy(); // matched "Himalayan Bank" in Alpha Two's bank list
    // hand-entered first, then the bid → linked, not duplicated
    const man = (await http().post('/bank-guarantees').set(A).send({ companyId: coA, bankName: 'Prabhu Bank', guaranteeNo: 'PB/5', type: 'BID_SECURITY', amount: 100000 }).expect(201)).body;
    const b2 = (await http().post('/bids').set(A).send({ tenderId: t2, companyId: coA, bidSecurityType: 'BANK_GUARANTEE', bidSecurityBank: 'prabhu bank', bidSecurityRef: 'PB/5', bidSecurityAmount: 100000 }).expect(201)).body;
    const linked = (await http().get(`/bank-guarantees/${man.id}`).set(A).expect(200)).body;
    expect(linked).toMatchObject({ bidId: b2.id, tenderId: t2 });
    expect(db.db.bankGuarantee.filter((x) => x.guaranteeNo === 'PB/5')).toHaveLength(1);
  });

  it('tenant isolation, roles, module guard, delete rules', async () => {
    const B = as('ownerB');
    expect((await http().get('/bank-guarantees').set(B).expect(200)).body).toEqual([]);
    expect((await http().get('/banks').set(B).expect(200)).body).toEqual([]);
    await http().get(`/bank-guarantees/${bgBid}`).set(B).expect(404);
    await http().patch(`/bank-guarantees/${bgBid}`).set(B).send({ notes: 'x' }).expect(404);
    await http().patch(`/banks/${nabil}`).set(B).send({ notes: 'x' }).expect(404);
    await http().post('/bank-guarantees').set(B).send({ companyId: coA, bankName: 'X', type: 'OTHER', amount: 1 }).expect(404);
    await http().post('/bank-guarantees').set(B).send({ companyId: coB, bankName: 'X', type: 'OTHER', amount: 1, bidId: bid1 }).expect(404);
    expect((await http().get('/bank-guarantees/summary').set(B).expect(200)).body.open.count).toBe(0);
    // roles
    await http().delete(`/bank-guarantees/${bgAdv}`).set(as('accA')).expect(403);
    await http().delete(`/banks/${nabil}`).set(as('accA')).expect(403);
    await http().delete(`/banks/${nabil}`).set(as('dirA')).expect(409); // still has an open guarantee
    await http().delete(`/bank-guarantees/${bgAdv}`).set(as('dirA')).expect(200);
    // module off → Bank screens blocked, but bids keep working and still record guarantees
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { bank: false } }).expect(200);
    await http().get('/banks').set(as('ownerA')).expect(403);
    await http().get('/bank-guarantees').set(as('ownerA')).expect(403);
    const t3 = (await http().post('/tenders').set(as('ownerA')).send({ ifbNumber: 'T-3', projectTitle: 'Road Three', deadlineDate: '2026-12-20' }).expect(201)).body.id;
    const b3 = (await http().post('/bids').set(as('ownerA')).send({ tenderId: t3, companyId: coA2, bidSecurityType: 'BANK_GUARANTEE', bidSecurityBank: 'Q', bidSecurityRef: 'Q1', bidSecurityAmount: 5 }).expect(201)).body;
    expect(db.db.bankGuarantee.some((g) => g.bidId === b3.id)).toBe(true);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { bank: true } }).expect(200);
    // deleting a tender keeps its guarantees (they are bank instruments) but unlinks them
    const before = db.db.bankGuarantee.length;
    await http().delete(`/tenders/${t1}`).set(as('ownerA')).expect(200);
    expect(db.db.bankGuarantee).toHaveLength(before);
    expect(db.db.bankGuarantee.find((g) => g.id === bgBid)).toMatchObject({ bidId: null, tenderId: null });
    // deleting a bank with only closed guarantees keeps them, with the bank name text
    const perf = db.db.bankGuarantee.find((g) => g.type === 'PERFORMANCE')!;
    await http().patch(`/bank-guarantees/${perf.id}`).set(as('ownerA')).send({ status: 'CANCELLED' }).expect(200);
    await http().delete(`/banks/${nabil}`).set(as('ownerA')).expect(200);
    expect(db.db.bankGuarantee.find((g) => g.id === bgBid)).toMatchObject({ bankId: null, bankName: 'Nabil Bank Limited' });
  });
});
