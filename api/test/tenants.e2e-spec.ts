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
});
