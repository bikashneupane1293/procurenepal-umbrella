// Staff join / leave (Task 12): Org ID, personal ID, invites, join requests, Google sign-in,
// removal → personal free workspace, re-hire. Real NestJS app, in-memory DB, fake Google verifier.
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GoogleVerifier } from '../src/auth/google-verifier';
import { ORG_CODE_RE, USER_CODE_RE } from '../src/common/codes';
import { FakePrisma } from './fake-prisma';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';

/** credential "g|<sub>|<email>|<verified 1/0>|<name>" */
class FakeGoogle {
  clientId() { return 'test-client-id'; }
  async verify(c: string) {
    const [p, sub, email, v, name] = c.trim().split('|');
    if (p !== 'g') throw new UnauthorizedException('bad token');
    return { sub, email: email.toLowerCase(), emailVerified: v === '1', name };
  }
}
const cred = (sub: string, email: string, name = 'Person', verified = true) => `g|${sub}|${email}|${verified ? 1 : 0}|${name}`.padEnd(24, ' ');

describe('Staff: Org ID, invites, Google sign-in, remove → free (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  let jwt: JwtService;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tok[who]}` });
  const sign = (sub: string) => jwt.sign({ sub }, { secret: 'test-secret-only' });
  const userBy = (email: string) => db.db.user.find((u) => u.email === email)!;
  let orgA = '';

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db)
      .overrideProvider(GoogleVerifier).useValue(new FakeGoogle())
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'A', name: 'Himalaya Builders', slug: 'himalaya' }, { id: 'B', name: 'Everest Co', slug: 'everest' });
    db.db.user.push(
      { id: 'ownerA', email: 'owner@a.com', fullName: 'Owner A', role: 'OWNER', tenantId: 'A', isActive: true, modules: [], passwordHash: 'x', status: 'ACTIVE' },
      { id: 'accA', email: 'acc@a.com', fullName: 'Acc A', role: 'ACCOUNTANT', tenantId: 'A', isActive: true, modules: [], passwordHash: 'x', status: 'ACTIVE' },
      { id: 'ownerB', email: 'owner@b.com', fullName: 'Owner B', role: 'OWNER', tenantId: 'B', isActive: true, modules: [], passwordHash: 'x', status: 'ACTIVE' },
    );
    for (const id of ['ownerA', 'accA', 'ownerB']) tok[id] = sign(id);
  });
  afterAll(() => app.close());

  it('auth/config tells the sign-in page whether Google and email are set up', async () => {
    expect((await http().get('/auth/config').expect(200)).body).toEqual({ googleClientId: 'test-client-id', emailEnabled: false });
  });

  it('every organization gets a stable Org ID; only the Owner can change it', async () => {
    const o = (await http().get('/staff/org').set(as('ownerA')).expect(200)).body;
    expect(o.orgCode).toMatch(ORG_CODE_RE);
    expect(o.signupLink).toContain(`/join?org=${o.orgCode}`);
    expect((await http().get('/staff/org').set(as('accA')).expect(200)).body.orgCode).toBe(o.orgCode); // staff can see it to pass it on
    await http().post('/staff/org/regenerate').set(as('accA')).expect(403);
    const n = (await http().post('/staff/org/regenerate').set(as('ownerA')).expect(200)).body;
    expect(n.orgCode).toMatch(ORG_CODE_RE);
    expect(n.orgCode).not.toBe(o.orgCode);
    orgA = n.orgCode;
    // the old ID stops working (sign-in still succeeds; the join reports the problem)
    const r = (await http().post('/auth/google').send({ credential: cred('s-x', 'x@new.example'), orgCode: o.orgCode }).expect(200)).body;
    expect(r.join).toMatchObject({ result: 'ERROR' });
    expect(r.join.message).toMatch(/No organization has the Org ID/);
  });

  it('every person gets a personal ID', async () => {
    const me = (await http().get('/staff/me').set(as('accA')).expect(200)).body;
    expect(me.userCode).toMatch(USER_CODE_RE);
    expect(me).toMatchObject({ organization: 'Himalaya Builders', personal: false, invites: [], requests: [] });
  });

  it('Owner adds staff by email or personal ID, with clear errors', async () => {
    const r = (await http().post('/staff/invites').set(as('ownerA')).send({ target: 'Sita@New.example', role: 'SITE_ENGINEER' }).expect(201)).body;
    expect(r).toMatchObject({ existingAccount: false, emailed: false });
    expect(r.invite).toMatchObject({ kind: 'INVITE', email: 'sita@new.example', role: 'SITE_ENGINEER', status: 'PENDING' });
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'sita@new.example' }).expect(409); // already invited
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'acc@a.com' }).expect(409); // already here
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'nonsense' }).expect(400);
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'U-ZZZZZZ' }).expect(404);
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'x@y.com', role: 'SUPER_ADMIN' }).expect(400);
    await http().post('/staff/invites').set(as('accA')).send({ target: 'x@y.com' }).expect(403);
    const codeB = (await http().get('/staff/me').set(as('ownerB')).expect(200)).body.userCode;
    const r2 = (await http().post('/staff/invites').set(as('ownerA')).send({ target: codeB.toLowerCase(), role: 'DIRECTOR' }).expect(201)).body;
    expect(r2.existingAccount).toBe(true);
    const list = (await http().get('/staff/invites').set(as('ownerA')).expect(200)).body;
    expect(list.map((i: any) => i.email).sort()).toEqual(['owner@b.com', 'sita@new.example']);
  });

  it('new person invited by email signs up with Google + Org ID → joins at once with the invited role', async () => {
    const r = (await http().post('/auth/google').send({ credential: cred('s-sita', 'sita@new.example', 'Sita Rai'), orgCode: orgA.toLowerCase() }).expect(200)).body;
    expect(r).toMatchObject({ created: true, join: { result: 'JOINED', organization: 'Himalaya Builders' } });
    expect(r.user).toMatchObject({ email: 'sita@new.example', role: 'SITE_ENGINEER', tenantId: 'A' });
    tok.sita = r.access_token;
    expect((await http().get('/staff/me').set(as('sita')).expect(200)).body).toMatchObject({ organization: 'Himalaya Builders', personal: false, googleLinked: true });
  });

  it('new person NOT invited signs up with Google + Org ID → own free workspace + join request → Owner approves', async () => {
    const r = (await http().post('/auth/google').send({ credential: cred('s-ram', 'ram@new.example', 'Ram Thapa'), orgCode: orgA }).expect(200)).body;
    expect(r.join).toMatchObject({ result: 'REQUESTED', organization: 'Himalaya Builders' });
    tok.ram = r.access_token;
    const me = (await http().get('/staff/me').set(as('ram')).expect(200)).body;
    expect(me).toMatchObject({ personal: true, organization: 'Ram Thapa (personal)' });
    expect(me.requests).toHaveLength(1);
    expect(me.requests[0]).toMatchObject({ organization: 'Himalaya Builders', kind: 'REQUEST' });
    const acc = (await http().get('/access/me').set(as('ram')).expect(200)).body;
    expect(acc).toMatchObject({ plan: 'FREE', modules: ['companies', 'bolpatra'] }); // free user
    const req = (await http().get('/staff/invites').set(as('ownerA')).expect(200)).body.find((i: any) => i.kind === 'REQUEST');
    await http().post(`/staff/requests/${req.id}/approve`).set(as('accA')).send({ role: 'ACCOUNTANT' }).expect(403);
    await http().post(`/staff/requests/${req.id}/approve`).set(as('ownerA')).send({ role: 'ACCOUNTANT' }).expect(200);
    expect(userBy('ram@new.example')).toMatchObject({ tenantId: 'A', role: 'ACCOUNTANT' });
  });

  it('Google sign-in rejects unverified emails; Google with no Org ID makes a free user', async () => {
    await http().post('/auth/google').send({ credential: cred('s-u', 'u@new.example', 'U', false) }).expect(401);
    const r = (await http().post('/auth/google').send({ credential: cred('s-hari', 'hari@new.example', 'Hari') }).expect(200)).body;
    expect(r.join).toBeNull();
    tok.hari = r.access_token;
    expect((await http().get('/staff/me').set(as('hari')).expect(200)).body.personal).toBe(true);
    // the same Google account signs in again (no duplicate user)
    await http().post('/auth/google').send({ credential: cred('s-hari', 'hari@new.example', 'Hari') }).expect(200);
    expect(db.db.user.filter((u) => u.email === 'hari@new.example').length).toBe(1);
    // a different Google account claiming the same email is refused
    await http().post('/auth/google').send({ credential: cred('s-other', 'hari@new.example', 'Hari') }).expect(401);
  });

  it('password sign-up with Org ID always waits for the Owner, even if that email was invited (email not proven)', async () => {
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'gita@new.example', role: 'HR_MANAGER' }).expect(201);
    const body = { orgCode: orgA, fullName: 'Gita KC', email: 'gita@new.example', password: 'Cuidado2083' };
    await http().post('/auth/join').send({ ...body, orgCode: 'PN-ZZZZZZ' }).expect(404);
    await http().post('/auth/join').send({ ...body, password: 'short' }).expect(400);
    const r = (await http().post('/auth/join').send(body).expect(201)).body;
    expect(r.join.result).toBe('REQUESTED');
    expect(userBy('gita@new.example').tenantId).not.toBe('A');
    await http().post('/auth/join').send(body).expect(409); // email taken
    // signed in, she can still accept the invitation herself (her own consent), or the Owner approves
    tok.gita = r.access_token;
    expect((await http().get('/staff/me').set(as('gita')).expect(200)).body.invites).toHaveLength(1);
  });

  it('an existing person accepts an invitation — but the only Owner of a company cannot leave it', async () => {
    const inv = (await http().get('/staff/me').set(as('ownerB')).expect(200)).body.invites[0];
    expect(inv).toMatchObject({ organization: 'Himalaya Builders', role: 'DIRECTOR' });
    const r = await http().post(`/staff/invites/${inv.id}/accept`).set(as('ownerB')).expect(400);
    expect(r.body.message).toMatch(/only Owner of Everest Co/);
    db.db.user.push({ id: 'owner2B', email: 'owner2@b.com', fullName: 'Owner 2 B', role: 'OWNER', tenantId: 'B', isActive: true, modules: [], passwordHash: 'x', status: 'ACTIVE' });
    tok.owner2B = sign('owner2B');
    const ok = (await http().post(`/staff/invites/${inv.id}/accept`).set(as('ownerB')).expect(200)).body;
    expect(ok.user).toMatchObject({ tenantId: 'A', role: 'DIRECTOR' });
    await http().post(`/staff/invites/${inv.id}/accept`).set(as('ownerB')).expect(404); // not open any more
  });

  let sitaPersonal = '';
  it('Owner removes a person → they become a free user in their own workspace and keep their login', async () => {
    const sita = userBy('sita@new.example');
    await http().post(`/staff/remove/${sita.id}`).set(as('accA')).expect(403);
    await http().post('/staff/remove/ownerA').set(as('ownerA')).expect(400); // not yourself
    await http().post(`/staff/remove/${sita.id}`).set(as('ownerA')).expect(200);
    const me = (await http().get('/staff/me').set(as('sita')).expect(200)).body; // same token still works
    expect(me).toMatchObject({ personal: true, organization: 'Sita Rai (personal)', role: 'OWNER' });
    expect((await http().get('/access/me').set(as('sita')).expect(200)).body.modules).toEqual(['companies', 'bolpatra']);
    expect((await http().get('/users').set(as('ownerA')).expect(200)).body.map((u: any) => u.email)).not.toContain('sita@new.example');
    sitaPersonal = userBy('sita@new.example').tenantId;
  });

  it('another company hires her by email; leaving again reuses the same personal workspace', async () => {
    await http().post('/staff/invites').set(as('owner2B')).send({ target: 'sita@new.example', role: 'STORE_MANAGER' }).expect(201);
    const inv = (await http().get('/staff/me').set(as('sita')).expect(200)).body.invites[0];
    expect(inv.organization).toBe('Everest Co');
    expect((await http().post(`/staff/invites/${inv.id}/accept`).set(as('sita')).expect(200)).body.user).toMatchObject({ tenantId: 'B', role: 'STORE_MANAGER' });
    await http().post(`/staff/remove/${userBy('sita@new.example').id}`).set(as('owner2B')).expect(200);
    expect(userBy('sita@new.example').tenantId).toBe(sitaPersonal);
    expect(db.db.tenant.filter((t) => t.personalOwnerId === userBy('sita@new.example').id)).toHaveLength(1);
  });

  it('a person can decline; a signed-in free user can ask to join by Org ID', async () => {
    await http().post('/staff/invites').set(as('ownerA')).send({ target: 'hari@new.example' }).expect(201);
    const inv = (await http().get('/staff/me').set(as('hari')).expect(200)).body.invites[0];
    await http().post(`/staff/invites/${inv.id}/decline`).set(as('hari')).expect(200);
    expect(userBy('hari@new.example').tenantId).not.toBe('A');
    const j = (await http().post('/staff/join').set(as('hari')).send({ orgCode: orgA }).expect(200)).body;
    expect(j).toMatchObject({ result: 'REQUESTED', organization: 'Himalaya Builders' });
    expect((await http().post('/staff/join').set(as('hari')).send({ orgCode: orgA }).expect(200)).body.result).toBe('REQUESTED'); // no duplicate
    expect(db.db.staffInvite.filter((i) => i.kind === 'REQUEST' && i.email === 'hari@new.example' && i.status === 'PENDING')).toHaveLength(1);
    await http().post('/staff/join').set(as('hari')).send({ orgCode: 'PN-ZZZZZZ' }).expect(404);
  });

  it('a teammate added with an activation link can skip it by signing in with Google', async () => {
    const u = (await http().post('/users').set(as('ownerA')).send({ email: 'nabin@new.example', fullName: 'Nabin', role: 'VIEWER' }).expect(201)).body;
    expect(u).toMatchObject({ status: 'PENDING', emailed: false });
    expect(u.activationLink).toMatch(/^\/activate\?token=/);
    expect(u.activationToken).toBeUndefined();
    const r = (await http().post('/auth/google').send({ credential: cred('s-nabin', 'nabin@new.example', 'Nabin') }).expect(200)).body;
    expect(r.user).toMatchObject({ tenantId: 'A', role: 'VIEWER' });
    expect(userBy('nabin@new.example')).toMatchObject({ status: 'ACTIVE', isVerified: true, activationToken: null });
  });
});
