// Admin Panel (Task 5d/5c/8) — platform-wide endpoints, real NestJS app, in-memory DB.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Admin Panel: tenants (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  let jwt: JwtService;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const sign = (sub: string) => jwt.sign({ sub }, { secret: 'test-secret-only' });

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'X', name: 'X' });
    db.db.user.push(
      { id: 'ownerX', email: 'owner@x.com', fullName: 'Owner X', role: 'OWNER', tenantId: 'X', isActive: true, modules: [], passwordHash: 'x' },
      { id: 'super1', email: 'admin@griha.com', fullName: 'Platform Admin', role: 'SUPER_ADMIN', tenantId: 'X', isActive: true, modules: [], passwordHash: 'x' },
    );
    tok.ownerX = sign('ownerX');
    tok.super1 = sign('super1');
  });
  afterAll(() => app.close());

  it('platform admin endpoints are Super Admin only', async () => {
    await http().get('/admin/tenants').set(as('ownerX')).expect(403);
    await http().post('/admin/tenants').set(as('ownerX')).send({ tenantName: 'Nope', ownerName: 'Nope', ownerEmail: 'nope@nope.com' }).expect(403);
    await http().get('/admin/tenants').set(as('super1')).expect(200);
  });

  it('rejects an incomplete or invalid create-organization request', async () => {
    await http().post('/admin/tenants').set(as('super1')).send({ tenantName: 'Acme Builders' }).expect(400); // missing owner fields
    await http().post('/admin/tenants').set(as('super1')).send({ tenantName: 'Acme Builders', ownerName: 'Bikash', ownerEmail: 'not-an-email' }).expect(400);
    await http().post('/admin/tenants').set(as('super1')).send({ tenantName: 'Acme Builders', ownerName: 'Bikash', ownerEmail: 'owner@x.com' }).expect(409); // owner@x.com already exists
  });

  let newTenantId: string;
  let newOwnerId: string;
  it('creates a new organization: tenant + PENDING owner + initial plan, in one go', async () => {
    const res = (await http()
      .post('/admin/tenants')
      .set(as('super1'))
      .send({ tenantName: 'Acme Builders Pvt. Ltd.', ownerName: 'Ram Shrestha', ownerEmail: 'ram@acme.example', ownerPhone: '9800000000', plan: 'STARTER' })
      .expect(201)).body;

    expect(res.tenant).toMatchObject({ name: 'Acme Builders Pvt. Ltd.', slug: 'acme-builders-pvt-ltd' });
    expect(res.subscription).toMatchObject({ plan: 'STARTER', status: 'ACTIVE' });
    expect(res.owner).toMatchObject({ email: 'ram@acme.example', fullName: 'Ram Shrestha' });
    expect(res.ownerActivationLink).toMatch(/^\/activate\?token=/);
    newTenantId = res.tenant.id;
    newOwnerId = res.owner.id;

    const stored = db.db.user.find((u) => u.id === newOwnerId)!;
    expect(stored).toMatchObject({ role: 'OWNER', status: 'PENDING', isVerified: false, tenantId: newTenantId });
    expect(stored.activationToken).toBeTruthy();

    // The owner's workspace is already gated by the STARTER plan from the moment it's created —
    // unlike a self-registered or pre-Task-8 tenant, which starts unrestricted (see access.e2e-spec.ts).
    tok.ram = sign(newOwnerId);
    const me = (await http().get('/access/me').set(as('ram')).expect(200)).body;
    expect(me.plan).toBe('STARTER');
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement', 'hr']);
  });

  it('de-duplicates the slug when another organization already has it', async () => {
    const res = (await http()
      .post('/admin/tenants')
      .set(as('super1'))
      .send({ tenantName: 'Acme Builders Pvt. Ltd.', ownerName: 'Someone Else', ownerEmail: 'someone@acme.example' })
      .expect(201)).body;
    expect(res.tenant.slug).toBe('acme-builders-pvt-ltd-2');
  });

  it('new organization shows up in the platform tenant list with its plan and owner', async () => {
    const list = (await http().get('/admin/tenants').set(as('super1')).expect(200)).body;
    const row = list.find((t: any) => t.id === newTenantId);
    expect(row).toMatchObject({ name: 'Acme Builders Pvt. Ltd.', ownerEmail: 'ram@acme.example', plan: 'STARTER' });
  });

  it('plans: lists every module and each plan\'s default modules (Super Admin only)', async () => {
    await http().get('/admin/plans').set(as('ownerX')).expect(403);
    const p = (await http().get('/admin/plans').set(as('super1')).expect(200)).body;
    expect(p.modules.map((m: any) => m.key)).toEqual(['companies', 'bolpatra', 'procurement', 'fleet', 'hr', 'project', 'bank']);
    expect(p.presets.STARTER).toEqual(['bolpatra', 'procurement', 'hr']);
  });

  it('Super Admin edits one workspace\'s modules (overrides its plan), Owner cannot exceed them, then resets to the plan default', async () => {
    await http().put(`/admin/tenants/${newTenantId}/modules`).set(as('ownerX')).send({ modules: ['bank'] }).expect(403);
    await http().put(`/admin/tenants/${newTenantId}/modules`).set(as('super1')).send({ modules: ['companies'] }).expect(400); // core is never "granted"
    await http().put(`/admin/tenants/${newTenantId}/modules`).set(as('super1')).send({ modules: ['spaceship'] }).expect(400);
    await http().put(`/admin/tenants/${newTenantId}/modules`).set(as('super1')).send({}).expect(400);

    const r = (await http().put(`/admin/tenants/${newTenantId}/modules`).set(as('super1')).send({ modules: ['bolpatra', 'fleet'] }).expect(200)).body;
    expect(r).toMatchObject({ plan: 'STARTER', custom: true, unlockedModules: ['bolpatra', 'fleet'] });
    let me = (await http().get('/access/me').set(as('ram')).expect(200)).body;
    expect(me.modules).toEqual(['companies', 'bolpatra', 'fleet']);
    expect(me.planCustom).toBe(true);
    // the workspace Owner cannot switch on something Super Admin didn't grant
    await http().put('/access/workspace-modules').set(as('ram')).send({ modules: { hr: true } }).expect(400);
    expect((await http().get(`/admin/tenants/${newTenantId}`).set(as('super1')).expect(200)).body.modules.custom).toBe(true);

    const back = (await http().put(`/admin/tenants/${newTenantId}/modules`).set(as('super1')).send({ usePlanDefault: true }).expect(200)).body;
    expect(back).toMatchObject({ plan: 'STARTER', custom: false, unlockedModules: ['bolpatra', 'procurement', 'hr'] });
    me = (await http().get('/access/me').set(as('ram')).expect(200)).body;
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement', 'hr']);
  });

  it('Set plan and Create organization can both carry Super Admin\'s exact module choice', async () => {
    await http().post(`/admin/tenants/${newTenantId}/plan`).set(as('super1')).send({ plan: 'ENTERPRISE', modules: ['bolpatra', 'bank'] }).expect(201);
    expect((await http().get('/access/me').set(as('ram')).expect(200)).body.modules).toEqual(['companies', 'bolpatra', 'bank']);
    await http().post(`/admin/tenants/${newTenantId}/plan`).set(as('super1')).send({ plan: 'ENTERPRISE', modules: ['nope'] }).expect(400);

    const c = (await http().post('/admin/tenants').set(as('super1'))
      .send({ tenantName: 'Custom Co', ownerName: 'Sita Rai', ownerEmail: 'sita@custom.example', plan: 'FREE', modules: ['bolpatra', 'project'] })
      .expect(201)).body;
    tok.sita = sign(c.owner.id);
    const me = (await http().get('/access/me').set(as('sita')).expect(200)).body;
    expect(me).toMatchObject({ plan: 'FREE', planCustom: true, modules: ['companies', 'bolpatra', 'project'] });
    await http().post('/admin/tenants').set(as('super1'))
      .send({ tenantName: 'Bad Co', ownerName: 'Bad Co', ownerEmail: 'bad@co.example', modules: ['companies'] }).expect(400);
  });
});
