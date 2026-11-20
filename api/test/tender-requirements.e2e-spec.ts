// Tender requirements read from the bidding document (Task 13). Real app, in-memory DB.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Tender requirements (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'A', name: 'A' }, { id: 'B', name: 'B' });
    db.db.user.push(
      { id: 'ownerA', email: 'o@a.com', fullName: 'O', role: 'OWNER', tenantId: 'A', isActive: true, modules: [], passwordHash: 'x' },
      { id: 'ownerB', email: 'o@b.com', fullName: 'O', role: 'OWNER', tenantId: 'B', isActive: true, modules: [], passwordHash: 'x' },
    );
    db.db.tender.push({ id: 'T1', tenantId: 'A', ifbNumber: 'IFB/1', projectTitle: 'Bridge', reqProjectTypes: [] });
    for (const id of ['ownerA', 'ownerB']) tok[id] = jwt.sign({ sub: id }, { secret: 'test-secret-only' });
  });
  afterAll(() => app.close());

  const rows = [
    { kind: 'TURNOVER', label: 'Average annual construction turnover', data: { amountNPR: 85500000, bestYears: 3, lookbackYears: 10 }, sourceText: 'NRs 85.50 million', confidence: 0.9, confirmed: true },
    { kind: 'KEY_ACTIVITY', label: 'Reinforcement Works', data: { quantity: 79, unit: 'Metric Tons', period: 'year' }, sourceText: '79.00 Metric Tons per year', confidence: 0.8 },
  ];

  it('saves the reviewed rows, keeping unconfirmed ones flagged', async () => {
    const saved = (await http().put('/tenders/T1/requirements').set(as('ownerA')).send({ rows }).expect(200)).body;
    expect(saved.map((r: any) => [r.kind, r.needsVerification])).toEqual([['TURNOVER', false], ['KEY_ACTIVITY', true]]);
    expect(saved[0].confirmedBy).toBe('ownerA');
    expect((await http().get('/tenders/T1/requirements').set(as('ownerA')).expect(200)).body).toHaveLength(2);
    // saving again replaces (no duplicates)
    expect((await http().put('/tenders/T1/requirements').set(as('ownerA')).send({ rows }).expect(200)).body).toHaveLength(2);
  });

  it('validates rows', async () => {
    const bad = async (r: any, re: RegExp) =>
      expect((await http().put('/tenders/T1/requirements').set(as('ownerA')).send({ rows: [r] }).expect(400)).body.message).toMatch(re);
    await bad({ ...rows[0], kind: 'NOPE' }, /unknown kind/);
    await bad({ ...rows[0], label: '' }, /label/);
    await bad({ ...rows[0], data: [1] }, /data must be an object/);
    await bad({ ...rows[0], confidence: 2 }, /confidence/);
    await http().put('/tenders/T1/requirements').set(as('ownerA')).send({}).expect(400);
  });

  it('confirms, corrects and deletes one row; other workspaces cannot see or touch it', async () => {
    const [, ka] = (await http().get('/tenders/T1/requirements').set(as('ownerA')).expect(200)).body;
    const c = (await http().patch(`/tenders/T1/requirements/${ka.id}`).set(as('ownerA')).send({ confirmed: true, label: 'Reinforcement works (MT/year)' }).expect(200)).body;
    expect(c).toMatchObject({ needsVerification: false, confirmedBy: 'ownerA', label: 'Reinforcement works (MT/year)' });
    await http().get('/tenders/T1/requirements').set(as('ownerB')).expect(404);
    await http().put('/tenders/T1/requirements').set(as('ownerB')).send({ rows }).expect(404);
    await http().patch(`/tenders/T1/requirements/${ka.id}`).set(as('ownerB')).send({ confirmed: false }).expect(404);
    await http().delete(`/tenders/T1/requirements/${ka.id}`).set(as('ownerA')).expect(200);
    expect((await http().get('/tenders/T1/requirements').set(as('ownerA')).expect(200)).body).toHaveLength(1);
  });
});
