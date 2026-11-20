// Task 15 — Today alerts, 7:00 AM email, activity log, public demo, standard modules per role.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/mail/mail.service';
import { WhatsAppService } from '../src/mail/whatsapp.service';
import { DigestService } from '../src/alerts/digest.service';
import { FakePrisma } from './fake-prisma';
import { addNptDays, nptToday } from '../src/common/nepal-time';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';
const day = (k: number) => addNptDays(nptToday(), k);
const noon = (k: number) => new Date(day(k) + 'T06:15:00.000Z');

class FakeWa {
  sent: any[] = [];
  enabled() { return true; }
  async sendAlerts(to: string, text: string) { this.sent.push({ to, text }); return true; }
}

class FakeMail {
  sent: any[] = [];
  enabled() { return true; }
  url(p: string) { return 'https://app.procurenepal.com' + p; }
  async send(m: any) { this.sent.push(m); return true; }
}

describe('Today alerts, morning email, activity log, demo (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const mail = new FakeMail();
  const wa = new FakeWa();
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  let digest: DigestService;

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(MailService).useValue(mail).overrideProvider(WhatsAppService).useValue(wa).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    digest = mod.get(DigestService);
    const jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'A', name: 'Alpha Builders', isActive: true }, { id: 'B', name: 'Beta', isActive: true });
    for (const [id, role, t] of [['ownerA', 'OWNER', 'A'], ['dirA', 'DIRECTOR', 'A'], ['engA', 'SITE_ENGINEER', 'A'], ['super', 'SUPER_ADMIN', 'A'], ['ownerB', 'OWNER', 'B']]) {
      db.db.user.push({ id, email: `${id}@x.com`, fullName: id, role, tenantId: t, isActive: true, status: 'ACTIVE', modules: id === 'engA' ? ['project', 'fleet'] : [] });
      tok[id] = jwt.sign({ sub: id }, { secret: 'test-secret-only' });
    }
    db.db.company.push({ id: 'C', tenantId: 'A', name: 'Alpha', slug: 'alpha' });
    db.db.tender.push(
      { id: 'T1', tenantId: 'A', ifbNumber: 'IFB/1', projectTitle: 'Road', deadlineDate: noon(1), status: 'active', reqProjectTypes: [] },
      { id: 'T2', tenantId: 'A', ifbNumber: 'IFB/2', projectTitle: 'Bridge', deadlineDate: noon(5), status: 'active', reqProjectTypes: [] },
      { id: 'T3', tenantId: 'A', ifbNumber: 'IFB/3', projectTitle: 'Far away', deadlineDate: noon(30), status: 'active', reqProjectTypes: [] },
      { id: 'T4', tenantId: 'A', ifbNumber: 'IFB/4', projectTitle: 'Cancelled', deadlineDate: noon(2), status: 'cancelled', reqProjectTypes: [] },
    );
    db.db.bankGuarantee.push({ id: 'G1', tenantId: 'A', companyId: 'C', bankName: 'Nabil', type: 'BID_SECURITY', amount: 4000000, expiryDate: noon(3), status: 'ACTIVE' });
  });
  afterAll(() => app.close());

  it('Today alerts: nearest and urgent first, only modules the person can open', async () => {
    const v = (await http().post('/erp/records/fleet.vehicle').set(as('ownerA')).send({ data: { name: 'Tipper 1', regNo: 'X1' } }).expect(201)).body.id;
    await http().post('/erp/records/fleet.tax').set(as('ownerA')).send({ data: { vehicle: v, kind: 'INSURANCE', expiry: day(20) } }).expect(201);
    const list = (await http().get('/alerts').set(as('ownerA')).expect(200)).body;
    expect(list.map((a: any) => [a.tone, a.title])).toEqual([
      ['bad', 'Bid deadline tomorrow'], ['bad', 'Bank guarantee expires in 3 days'], ['warn', 'Bid deadline in 5 days'], ['warn', 'Insurance expires in 20 days'],
    ]);
    expect(list[0]).toMatchObject({ detail: 'IFB/1 — Road', link: '/tenders/T1', date: day(1), days: 1 });
    // site engineer (project + fleet) does not see tenders or guarantees
    expect((await http().get('/alerts').set(as('engA')).expect(200)).body.map((a: any) => a.module)).toEqual(['fleet']);
    expect((await http().get('/alerts').set(as('ownerB')).expect(200)).body).toEqual([]);
  });

  it('morning email goes to Owners and Directors once, with the list', async () => {
    const r = await digest.run(nptToday());
    expect(r).toMatchObject({ workspaces: 1, emails: 2, alerts: 4 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['dirA@x.com', 'ownerA@x.com']);
    expect(mail.sent[0].subject).toBe('ProcureNepal — 4 item(s) need attention today (2 urgent)');
    expect(mail.sent[0].lines[1]).toMatch(/^🔴 Bid deadline tomorrow — IFB\/1 — Road/);
    // the scheduler sends once a day only, after 7:00 NPT
    mail.sent = [];
    const at = (h: number) => new Date(`${nptToday()}T00:00:00.000Z`).getTime() - 345 * 60000 + h * 3600000; // h:00 NPT today
    await digest.tick(new Date(at(6)));
    expect(mail.sent).toHaveLength(0);
    await digest.tick(new Date(at(7.2)));
    await digest.tick(new Date(at(9)));
    expect(mail.sent).toHaveLength(2);
    await http().post('/admin/digest/run').set(as('ownerA')).expect(403);
  });

  it('each person chooses email / WhatsApp for the morning alerts', async () => {
    expect((await http().get('/me/preferences').set(as('engA')).expect(200)).body).toMatchObject({ morningEmail: false, morningWhatsapp: false, whatsapp: '' });
    expect((await http().get('/me/preferences').set(as('ownerA')).expect(200)).body.morningEmail).toBe(true);
    await http().put('/me/preferences').set(as('engA')).send({ morningWhatsapp: true }).expect(400);
    await http().put('/me/preferences').set(as('engA')).send({ whatsapp: '12' }).expect(400);
    const p = (await http().put('/me/preferences').set(as('engA')).send({ morningEmail: true, whatsapp: '98-4123-4567', morningWhatsapp: true }).expect(200)).body;
    expect(p).toMatchObject({ morningEmail: true, whatsapp: '9779841234567', morningWhatsapp: true });
    await http().put('/me/preferences').set(as('dirA')).send({ morningEmail: false }).expect(200);
    mail.sent = []; wa.sent = [];
    const r = await digest.run(nptToday());
    expect(r).toMatchObject({ workspaces: 1, emails: 2, whatsapps: 1 });
    expect(mail.sent.map((m) => m.to).sort()).toEqual(['engA@x.com', 'ownerA@x.com']);
    // the engineer gets only his modules' alerts (fleet), the owner all of them
    expect(mail.sent.find((m) => m.to === 'engA@x.com').subject).toBe('ProcureNepal — 1 item(s) need attention today');
    expect(wa.sent).toEqual([{ to: '9779841234567', text: expect.stringMatching(/^Alpha Builders, .*: 1 item\(s\) — Insurance expires in 20 days: Tipper 1\.$/) }]);
    // back as before for the next tests
    await http().put('/me/preferences').set(as('engA')).send({ morningEmail: false, morningWhatsapp: false }).expect(200);
    await http().put('/me/preferences').set(as('dirA')).send({ morningEmail: true }).expect(200);
  });

  it('activity log: who changed what, Owners/Directors only, per workspace', async () => {
    await http().post('/companies').set(as('dirA')).send({ name: 'Gamma Nirman', slug: 'gamma' }).expect(201);
    const log = (await http().get('/activity').set(as('ownerA')).expect(200)).body;
    expect(log[0]).toMatchObject({ who: 'dirA', action: 'added', what: 'company', detail: 'Gamma Nirman' });
    expect(log.map((x: any) => x.what)).toEqual(expect.arrayContaining(['vehicle', 'renewal']));
    await http().get('/activity').set(as('engA')).expect(403);
    expect((await http().get('/activity').set(as('ownerB')).expect(200)).body).toEqual([]);
  });

  it('standard modules per role when the Owner does not choose', async () => {
    const u = (await http().post('/users').set(as('ownerA')).send({ email: 'store@x.com', fullName: 'Store', role: 'STORE_MANAGER', password: 'abc12345' }).expect(201)).body;
    expect(db.db.user.find((x) => x.id === u.id)!.modules).toEqual(['procurement']);
    const v = (await http().post('/users').set(as('ownerA')).send({ email: 'v@x.com', fullName: 'V', role: 'ACCOUNTANT', password: 'abc12345', modules: ['bank'] }).expect(201)).body;
    expect(db.db.user.find((x) => x.id === v.id)!.modules).toEqual(['bank']);
  });

  it('public demo: sample data, read-only, rebuilt on reset', async () => {
    const s = (await http().post('/demo/session').expect(200)).body;
    expect(s).toMatchObject({ demo: true, user: { role: 'DIRECTOR' } });
    const D = { Authorization: `Bearer ${s.access_token}` };
    expect((await http().get('/tenders').set(D).expect(200)).body).toHaveLength(3);
    const fuel = (await http().get('/erp/records/fleet.fuel').set(D).expect(200)).body;
    expect(fuel).toHaveLength(6);
    expect(fuel.some((f: any) => /litres per hour/.test(f.data.check))).toBe(true); // the excavator's flagged fill
    expect((await http().get('/alerts').set(D).expect(200)).body.length).toBeGreaterThanOrEqual(4);
    const msg = (await http().post('/companies').set(D).send({ name: 'X', slug: 'x' }).expect(403)).body.message;
    expect(msg).toMatch(/demo — changes are switched off/);
    await http().post('/auth/logout').set(D).expect((r) => expect(r.status).toBeLessThan(400));
    // the demo is not emailed
    mail.sent = [];
    await digest.run(nptToday());
    expect(mail.sent.every((m) => !String(m.to).includes('demo'))).toBe(true);
    // reset: a fresh workspace, the old one wiped
    const oldTenant = s.user.tenantId;
    await http().post('/admin/demo/reset').set(as('super')).expect(200);
    expect(db.db.tenant.find((t) => t.id === oldTenant)).toBeUndefined();
    expect(db.db.erpRecord.filter((r) => r.tenantId === oldTenant)).toHaveLength(0);
    const s2 = (await http().post('/demo/session').expect(200)).body;
    expect(s2.user.tenantId).not.toBe(oldTenant);
    await http().get('/erp/records/fleet.fuel').set(D).expect(401); // old demo session is gone with its workspace
  });
});
