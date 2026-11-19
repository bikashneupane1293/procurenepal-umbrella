// Pricing & promotions (Task 10) — real NestJS app, in-memory DB.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Pricing & promotions (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  let jwt: JwtService;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const sign = (sub: string) => jwt.sign({ sub }, { secret: 'test-secret-only' });

  const plan = (monthlyNPR: number, yearlyNPR: number, modules: string[], extra: any = {}) => ({ label: 'x', tagline: '', monthlyNPR, yearlyNPR, modules, active: true, ...extra });
  const catalog = () => ({
    plans: {
      FREE: plan(0, 0, ['bolpatra']),
      STARTER: plan(2000, 20000, ['bolpatra', 'procurement'], { label: 'Starter', tagline: 'For small contractors' }),
      PROFESSIONAL: plan(5000, 50000, ['bolpatra', 'procurement', 'fleet', 'hr', 'project']),
      ENTERPRISE: plan(9000, 90000, ['bolpatra', 'procurement', 'fleet', 'hr', 'project', 'bank'], { active: false }),
    },
    promotions: [
      { code: 'dashain20', label: 'Dashain 20% off', type: 'PERCENT', value: 20, plans: [], periods: [], active: true },
      { code: 'YEARLY5000', label: 'NPR 5,000 off yearly Professional', type: 'FIXED', value: 5000, plans: ['PROFESSIONAL'], periods: ['YEARLY'], active: true },
      { code: 'ONCE', label: 'Single-use 10%', type: 'PERCENT', value: 10, plans: [], periods: [], maxUses: 1, active: true },
      { code: 'EXPIRED', label: 'Old', type: 'PERCENT', value: 10, plans: [], periods: [], validFrom: '2019-01-01', validTo: '2020-01-01', active: true },
      { code: 'OFF', label: 'Paused', type: 'PERCENT', value: 10, plans: [], periods: [], active: false },
    ],
  });

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'P', name: 'P' }, { id: 'Q', name: 'Q' });
    db.db.user.push(
      { id: 'super1', email: 'admin@griha.com', fullName: 'Admin', role: 'SUPER_ADMIN', tenantId: 'P', isActive: true, modules: [], passwordHash: 'x' },
      { id: 'ownerQ', email: 'owner@q.com', fullName: 'Owner Q', role: 'OWNER', tenantId: 'Q', isActive: true, modules: [], passwordHash: 'x' },
    );
    db.db.subscription.push({ id: 'sq1', tenantId: 'Q', plan: 'STARTER', status: 'ACTIVE', createdAt: new Date('2026-01-01') });
    tok.super1 = sign('super1');
    tok.ownerQ = sign('ownerQ');
  });
  afterAll(() => app.close());

  it('public price list works without signing in; built-in defaults until Super Admin saves', async () => {
    const p = (await http().get('/pricing').expect(200)).body;
    expect(p.configured).toBe(false);
    expect(p.plans.map((x: any) => x.plan)).toEqual(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']);
    expect(p.plans.find((x: any) => x.plan === 'STARTER')).toMatchObject({ monthlyNPR: 0, modules: ['bolpatra', 'procurement', 'hr'] });
    expect(p.promotions).toBeUndefined(); // codes are never listed publicly
  });

  it('admin pricing is Super Admin only', async () => {
    await http().get('/admin/pricing').expect(401);
    await http().get('/admin/pricing').set(as('ownerQ')).expect(403);
    await http().put('/admin/pricing').set(as('ownerQ')).send(catalog()).expect(403);
    expect((await http().get('/admin/pricing').set(as('super1')).expect(200)).body.stored).toBe(false);
  });

  it('rejects an invalid catalog with a plain reason', async () => {
    const bad = async (mutate: (c: any) => void, re: RegExp) => {
      const c = catalog(); mutate(c);
      const r = await http().put('/admin/pricing').set(as('super1')).send(c).expect(400);
      expect(r.body.message).toMatch(re);
    };
    await bad((c) => (c.promotions[0].value = 150), /more than 100/);
    await bad((c) => (c.promotions[1].code = 'DASHAIN20'), /used twice/);
    await bad((c) => (c.promotions[0].code = 'x'), /3–30 letters/);
    await bad((c) => (c.plans.STARTER.modules = ['companies']), /unknown or core module/);
    await bad((c) => (c.plans.STARTER.monthlyNPR = -5), /0 or more/);
    await bad((c) => { c.promotions[3].validFrom = '2021-01-01'; c.promotions[3].validTo = '2020-01-01'; }, /before start date/);
    await bad((c) => (c.promotions[2].maxUses = 0), /max uses/);
    await bad((c) => delete c.plans.FREE, /Missing plan FREE/);
  });

  it('saves the catalog: public list updates, inactive plans are hidden, codes are upper-cased', async () => {
    const saved = (await http().put('/admin/pricing').set(as('super1')).send(catalog()).expect(200)).body;
    expect(saved.catalog.promotions[0].code).toBe('DASHAIN20');
    const p = (await http().get('/pricing').expect(200)).body;
    expect(p.configured).toBe(true);
    expect(p.plans.map((x: any) => x.plan)).toEqual(['FREE', 'STARTER', 'PROFESSIONAL']); // ENTERPRISE inactive
    expect(p.plans[1]).toMatchObject({ label: 'Starter', tagline: 'For small contractors', monthlyNPR: 2000, yearlyNPR: 20000 });
  });

  it('quotes apply every promo rule', async () => {
    const q = async (plan: string, period: string, code?: string) =>
      (await http().get('/pricing/quote').query({ plan, period, ...(code ? { code } : {}) }).expect(200)).body;
    expect(await q('STARTER', 'MONTHLY')).toMatchObject({ listPriceNPR: 2000, discountNPR: 0, finalNPR: 2000, promo: null });
    expect(await q('STARTER', 'MONTHLY', 'dashain20')).toMatchObject({ discountNPR: 400, finalNPR: 1600, promo: { code: 'DASHAIN20' } });
    expect(await q('PROFESSIONAL', 'YEARLY', 'YEARLY5000')).toMatchObject({ listPriceNPR: 50000, finalNPR: 45000 });
    expect((await q('STARTER', 'YEARLY', 'YEARLY5000')).promoError).toMatch(/does not apply to the STARTER plan/);
    expect((await q('PROFESSIONAL', 'MONTHLY', 'YEARLY5000')).promoError).toMatch(/only applies to yearly/);
    expect((await q('STARTER', 'MONTHLY', 'EXPIRED')).promoError).toMatch(/ended on 2020-01-01/);
    expect((await q('STARTER', 'MONTHLY', 'OFF')).promoError).toMatch(/switched off/);
    expect((await q('STARTER', 'MONTHLY', 'NOPE')).promoError).toMatch(/does not exist/);
    expect((await q('FREE', 'MONTHLY', 'DASHAIN20')).promoError).toMatch(/no price set/);
    expect((await q('STARTER', 'MONTHLY', 'EXPIRED')).finalNPR).toBe(2000); // a bad code never changes the price
    await http().get('/pricing/quote').query({ plan: 'GOLD', period: 'MONTHLY' }).expect(400);
  });

  it('editing a plan\'s default modules changes access for workspaces on that plan (no per-workspace choice)', async () => {
    const me = (await http().get('/access/me').set(as('ownerQ')).expect(200)).body;
    expect(me.plan).toBe('STARTER');
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement']); // HR removed from STARTER in the catalog
    expect((await http().get('/admin/plans').set(as('super1')).expect(200)).body.presets.STARTER).toEqual(['bolpatra', 'procurement']);
  });

  it('Set plan prices from the catalog, applies a promo, enforces max uses, and lets a typed amount win', async () => {
    const r = (await http().post('/admin/tenants/Q/plan').set(as('super1'))
      .send({ plan: 'STARTER', billingPeriod: 'MONTHLY', promoCode: 'once' }).expect(201)).body;
    expect(r).toMatchObject({ plan: 'STARTER', billingPeriod: 'MONTHLY', promoCode: 'ONCE' });
    expect(Number(r.listPriceNPR)).toBe(2000);
    expect(Number(r.discountNPR)).toBe(200);
    expect(Number(r.amountNPR)).toBe(1800);

    const used = await http().post('/admin/tenants/Q/plan').set(as('super1')).send({ plan: 'STARTER', billingPeriod: 'MONTHLY', promoCode: 'ONCE' }).expect(400);
    expect(used.body.message).toMatch(/used up \(1 of 1\)/);
    await http().post('/admin/tenants/Q/plan').set(as('super1')).send({ plan: 'STARTER', billingPeriod: 'MONTHLY', promoCode: 'NOPE' }).expect(400);
    await http().post('/admin/tenants/Q/plan').set(as('super1')).send({ plan: 'STARTER', billingPeriod: 'WEEKLY' }).expect(400);

    const deal = (await http().post('/admin/tenants/Q/plan').set(as('super1'))
      .send({ plan: 'STARTER', billingPeriod: 'YEARLY', amountNPR: 15000 }).expect(201)).body;
    expect(Number(deal.amountNPR)).toBe(15000);
    expect(Number(deal.listPriceNPR)).toBe(20000);

    // old-style Set plan (no period / promo) still works exactly as before
    const plain = (await http().post('/admin/tenants/Q/plan').set(as('super1')).send({ plan: 'PROFESSIONAL' }).expect(201)).body;
    expect(plain.billingPeriod ?? null).toBeNull();

    expect((await http().get('/admin/pricing').set(as('super1')).expect(200)).body.usage).toEqual({ ONCE: 1 });
  });
});
