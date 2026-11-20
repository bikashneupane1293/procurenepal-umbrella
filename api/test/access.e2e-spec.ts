// User Setup + module activation (ERP menus) — real NestJS app, in-memory DB.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { addNptDays, nptToday } from '../src/common/nepal-time';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

describe('Access: modules + User Setup (e2e)', () => {
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
    db.db.tenant.push({ id: 'A', name: 'A' }, { id: 'B', name: 'B' });
    db.db.user.push(
      { id: 'ownerA', email: 'owner@a.com', fullName: 'Owner A', role: 'OWNER', tenantId: 'A', isActive: true, modules: [], passwordHash: 'x' },
      { id: 'directorA', email: 'dir@a.com', fullName: 'Dir A', role: 'DIRECTOR', tenantId: 'A', isActive: true, modules: [], passwordHash: 'x' },
      { id: 'viewerA', email: 'view@a.com', fullName: 'Viewer A', role: 'VIEWER', tenantId: 'A', isActive: true, modules: [], passwordHash: 'x' },
      { id: 'ownerB', email: 'owner@b.com', fullName: 'Owner B', role: 'OWNER', tenantId: 'B', isActive: true, modules: [], passwordHash: 'x' },
    );
    for (const id of ['ownerA', 'directorA', 'viewerA', 'ownerB']) tok[id] = sign(id);
  });
  afterAll(() => app.close());

  it('access/me: every module is active by default (no setup needed)', async () => {
    const me = (await http().get('/access/me').set(as('ownerA')).expect(200)).body;
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement', 'fleet', 'hr', 'project', 'bank']);
    expect(me.canManage).toBe(true);
    expect(me.registry.find((m: any) => m.key === 'companies').core).toBe(true);
    expect((await http().get('/access/me').set(as('viewerA')).expect(200)).body.canManage).toBe(false);
  });

  it('workspace modules: Owner switches off/on; core cannot be switched off; others cannot change', async () => {
    await http().put('/access/workspace-modules').set(as('directorA')).send({ modules: { fleet: false } }).expect(403);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { companies: false } }).expect(400);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { spaceship: true } }).expect(400);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { fleet: 'no' } }).expect(400);
    const r = (await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { bolpatra: false, fleet: false } }).expect(200)).body;
    expect(r).toMatchObject({ companies: true, bolpatra: false, fleet: false, bank: true });
    // server blocks the switched-off module, even for the Owner
    const blocked = await http().get('/tenders').set(as('ownerA')).expect(403);
    expect(blocked.body.message).toMatch(/Bolpatra eGP System module is not active/);
    await http().get('/certificates').set(as('ownerA')).expect(403);
    await http().post('/qualification/evaluate').set(as('ownerA')).send({ companyId: 'x' }).expect(403);
    await http().get('/companies').set(as('ownerA')).expect(200); // core
    // other workspace unaffected
    await http().get('/tenders').set(as('ownerB')).expect(200);
    await http().put('/access/workspace-modules').set(as('ownerA')).send({ modules: { bolpatra: true } }).expect(200);
    await http().get('/tenders').set(as('ownerA')).expect(200);
    expect((await http().get('/access/me').set(as('ownerA')).expect(200)).body.modules).not.toContain('fleet');
  });

  let accId: string;
  it('User Setup: Owner adds a user limited to Bolpatra; password and role rules are enforced', async () => {
    const base = { email: 'Acc@A.com', fullName: 'Accountant A', role: 'ACCOUNTANT', password: 'Cuidado2083', modules: ['bolpatra'] };
    await http().post('/users').set(as('directorA')).send(base).expect(403);
    await http().post('/users').set(as('ownerA')).send({ ...base, password: 'short1' }).expect(400);
    await http().post('/users').set(as('ownerA')).send({ ...base, password: 'onlyletters' }).expect(400);
    await http().post('/users').set(as('ownerA')).send({ ...base, role: 'SUPER_ADMIN' }).expect(400);
    await http().post('/users').set(as('ownerA')).send({ ...base, modules: ['spaceship'] }).expect(400);
    await http().post('/users').set(as('ownerA')).send({ ...base, isActive: false }).expect(400); // unknown field
    const u = (await http().post('/users').set(as('ownerA')).send(base).expect(201)).body;
    accId = u.id;
    expect(u).toMatchObject({ email: 'acc@a.com', role: 'ACCOUNTANT', modules: ['bolpatra'], isActive: true });
    expect(u.passwordHash).toBeUndefined();
    expect(db.db.user.find((x) => x.id === u.id)!.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt hash stored
    await http().post('/users').set(as('ownerA')).send({ ...base, email: 'acc@a.com' }).expect(409);
    tok.acc = sign(u.id);
  });

  it('user-level limits: allowed modules only; core always; server enforces', async () => {
    const me = (await http().get('/access/me').set(as('acc')).expect(200)).body;
    expect(me.modules).toEqual(['companies', 'bolpatra']);
    await http().get('/tenders').set(as('acc')).expect(200);
    await http().patch(`/users/${accId}`).set(as('ownerA')).send({ modules: ['procurement'] }).expect(200);
    expect((await http().get('/access/me').set(as('acc')).expect(200)).body.modules).toEqual(['companies', 'procurement']);
    await http().get('/tenders').set(as('acc')).expect(403);
    await http().get('/companies').set(as('acc')).expect(200);
    await http().patch(`/users/${accId}`).set(as('ownerA')).send({ modules: [] }).expect(200); // empty = all active
    expect((await http().get('/access/me').set(as('acc')).expect(200)).body.modules).toEqual(['companies', 'bolpatra', 'procurement', 'hr', 'project', 'bank']);
  });

  it('users list: Owner/Director yes, others no; never shows passwords; only own workspace', async () => {
    const list = (await http().get('/users').set(as('directorA')).expect(200)).body;
    expect(list.map((u: any) => u.email).sort()).toEqual(['acc@a.com', 'dir@a.com', 'owner@a.com', 'view@a.com']);
    expect(list.every((u: any) => u.passwordHash === undefined)).toBe(true);
    await http().get('/users').set(as('viewerA')).expect(403);
    await http().get('/users').set(as('acc')).expect(403);
    expect((await http().get('/users').set(as('ownerB')).expect(200)).body.map((u: any) => u.email)).toEqual(['owner@b.com']);
  });

  it('edit rules: deactivate blocks access; cannot remove the last Owner or deactivate yourself; other workspace → 404', async () => {
    await http().patch(`/users/${accId}`).set(as('ownerB')).send({ fullName: 'hijack' }).expect(404);
    await http().patch(`/users/${accId}`).set(as('directorA')).send({ fullName: 'x' }).expect(403);
    await http().patch('/users/ownerA').set(as('ownerA')).send({ role: 'DIRECTOR' }).expect(400);
    await http().patch('/users/ownerA').set(as('ownerA')).send({ isActive: false }).expect(400);
    await http().patch(`/users/${accId}`).set(as('ownerA')).send({ password: 'weak' }).expect(400);
    const u = (await http().patch(`/users/${accId}`).set(as('ownerA')).send({ isActive: false, role: 'STORE_MANAGER', password: 'NewPass2083' }).expect(200)).body;
    expect(u).toMatchObject({ isActive: false, role: 'STORE_MANAGER' });
    await http().get('/access/me').set(as('acc')).expect(401); // JWT strategy rejects inactive users
    // a second Owner allows the first to step down
    await http().patch('/users/directorA').set(as('ownerA')).send({ role: 'OWNER' }).expect(200);
    await http().patch('/users/ownerA').set(as('ownerA')).send({ role: 'DIRECTOR' }).expect(200);
  });

  it('plan → module gating (Task 8): no plan recorded = unrestricted, same as before; a recorded plan gates modules', async () => {
    // A brand-new workspace with no Subscription row at all — same state as every tenant that
    // existed before Task 8, and every self-registered tenant (registration creates no
    // Subscription row either).
    db.db.tenant.push({ id: 'C', name: 'C' });
    db.db.user.push({ id: 'ownerC', email: 'owner@c.com', fullName: 'Owner C', role: 'OWNER', tenantId: 'C', isActive: true, modules: [], passwordHash: 'x' });
    tok.ownerC = sign('ownerC');

    let me = (await http().get('/access/me').set(as('ownerC')).expect(200)).body;
    expect(me.plan).toBeNull();
    expect(me.planModules).toBeNull();
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement', 'fleet', 'hr', 'project', 'bank']);
    // Unrestricted means the Owner can still freely switch any module while no plan is recorded.
    await http().put('/access/workspace-modules').set(as('ownerC')).send({ modules: { bank: true } }).expect(200);

    // Super Admin records STARTER for this workspace (bolpatra, procurement, hr only per the
    // first-proposal PLAN_MODULES mapping — see module-registry.ts).
    db.db.subscription.push({ id: 'sub-c-1', tenantId: 'C', plan: 'STARTER', status: 'ACTIVE', createdAt: new Date() });

    me = (await http().get('/access/me').set(as('ownerC')).expect(200)).body;
    expect(me.plan).toBe('STARTER');
    expect(me.planModules).toEqual(['bolpatra', 'procurement', 'hr']);
    // fleet/project/bank are now OFF, even though no saved flag ever changed.
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement', 'hr']);

    // Trying to switch on a module the plan doesn't include is rejected before it ever reaches
    // the database, with a message telling the Owner to ask for an upgrade.
    const res = await http().put('/access/workspace-modules').set(as('ownerC')).send({ modules: { fleet: true } }).expect(400);
    expect(res.body.message).toMatch(/not included in your workspace's STARTER plan/);

    // A later (higher) plan immediately unlocks more modules — no flag needs to change.
    db.db.subscription.push({ id: 'sub-c-2', tenantId: 'C', plan: 'ENTERPRISE', status: 'ACTIVE', createdAt: new Date(Date.now() + 1000) });
    me = (await http().get('/access/me').set(as('ownerC')).expect(200)).body;
    expect(me.plan).toBe('ENTERPRISE');
    expect(me.modules).toEqual(['companies', 'bolpatra', 'procurement', 'fleet', 'hr', 'project', 'bank']);
  });

  it('plan expiry (Nepal Time): expiring soon → 7-day grace → FREE modules; CANCELED is immediate; renewal restores', async () => {
    db.db.tenant.push({ id: 'E', name: 'E' });
    db.db.user.push({ id: 'ownerE', email: 'owner@e.com', fullName: 'Owner E', role: 'OWNER', tenantId: 'E', isActive: true, modules: [], passwordHash: 'x' });
    tok.ownerE = sign('ownerE');
    let n = 0;
    // a later createdAt each time, so the newest row is "the plan"
    const setPlan = (plan: string, expiresInDays: number | null, status = 'ACTIVE') =>
      db.db.subscription.push({
        id: `e${++n}`, tenantId: 'E', plan, status, createdAt: new Date(Date.now() + n * 1000),
        expiresAt: expiresInDays == null ? null : new Date(addNptDays(nptToday(), expiresInDays) + 'T00:00:00Z'),
      });
    const me = async () => (await http().get('/access/me').set(as('ownerE')).expect(200)).body;
    const STARTER = ['companies', 'bolpatra', 'procurement', 'hr'];
    const FREE = ['companies', 'bolpatra'];

    setPlan('STARTER', 30);
    let m = await me();
    expect(m.planState).toMatchObject({ plan: 'STARTER', state: 'ACTIVE', daysLeft: 30, expiresOn: addNptDays(nptToday(), 30) });
    expect(m.modules).toEqual(STARTER);

    setPlan('STARTER', 0); // expires today → still valid through 23:59 Nepal Time
    expect((await me()).planState).toMatchObject({ state: 'EXPIRING_SOON', daysLeft: 0 });

    setPlan('STARTER', 5);
    expect((await me()).planState).toMatchObject({ state: 'EXPIRING_SOON', daysLeft: 5 });

    setPlan('STARTER', -3); // 3 days past expiry → grace, still full STARTER access
    m = await me();
    expect(m.planState).toMatchObject({ state: 'GRACE', daysLeft: 4, graceEndsOn: addNptDays(nptToday(), 4) });
    expect(m.modules).toEqual(STARTER);

    setPlan('STARTER', -7); // last day of grace
    expect((await me()).planState).toMatchObject({ state: 'GRACE', daysLeft: 0 });

    setPlan('STARTER', -8); // grace over → FREE modules only
    m = await me();
    expect(m.planState).toMatchObject({ plan: 'STARTER', effectivePlan: 'FREE', state: 'EXPIRED' });
    expect(m.modules).toEqual(FREE);
    const r = await http().put('/access/workspace-modules').set(as('ownerE')).send({ modules: { procurement: true } }).expect(400);
    expect(r.body.message).toMatch(/STARTER plan has expired/);
    await http().get('/tenders').set(as('ownerE')).expect(200); // FREE still includes Bolpatra

    // Super Admin's per-workspace choice is ignored while expired, but kept for renewal
    db.db.tenantFeatureFlag.push({ id: 'ent-e', tenantId: 'E', flagKey: 'entitle:bank', enabled: true });
    expect((await me()).modules).toEqual(FREE);
    setPlan('STARTER', 365); // renewed
    m = await me();
    expect(m.planState.state).toBe('ACTIVE');
    expect(m.modules).toEqual(['companies', 'bank']); // the kept per-workspace choice is back

    setPlan('PROFESSIONAL', 200, 'CANCELED'); // cancelled → FREE immediately, whatever the date
    m = await me();
    expect(m.planState).toMatchObject({ state: 'EXPIRED', effectivePlan: 'FREE' });
    expect(m.modules).toEqual(FREE);

    setPlan('STARTER', null); // no end date → never expires
    expect((await me()).planState).toMatchObject({ state: 'ACTIVE', expiresOn: null, daysLeft: null });
  });
});
