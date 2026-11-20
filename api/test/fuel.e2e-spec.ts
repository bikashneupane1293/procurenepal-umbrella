// Daily Fuel Log (Vehicle & Fleet) + a person limited to one page ("fuel entry only"). Real app, in-memory DB.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakePrisma } from './fake-prisma';
import { addNptDays, nptToday } from '../src/common/nepal-time';

process.env.JWT_ACCESS_SECRET = 'test-secret-only';
const day = (k: number) => addNptDays(nptToday(), k);

describe('Daily Fuel Log (e2e)', () => {
  let app: INestApplication;
  let db: FakePrisma;
  const tok: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (w: string) => ({ Authorization: `Bearer ${tok[w]}` });
  const mk = async (entity: string, data: any, code = 201, who = 'ownerA') => (await http().post(`/erp/records/${entity}`).set(as(who)).send({ data }).expect(code)).body;
  let truck: string;

  beforeAll(async () => {
    db = new FakePrisma();
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const jwt = mod.get(JwtService);
    db.db.tenant.push({ id: 'A', name: 'A' }, { id: 'B', name: 'B' });
    for (const [id, role, t] of [['ownerA', 'OWNER', 'A'], ['driver', 'VIEWER', 'A'], ['ownerB', 'OWNER', 'B']]) {
      db.db.user.push({ id, email: `${id}@x.com`, fullName: id, role, tenantId: t, isActive: true, modules: [] });
      tok[id] = jwt.sign({ sub: id }, { secret: 'test-secret-only' });
    }
    truck = (await mk('fleet.vehicle', { name: 'Tipper 1', regNo: 'Ba 2 Kha 1', meterType: 'KM', tankCapacity: 200, expectedFuel: 3, fuelTolerancePct: 15 })).id;
  });
  afterAll(() => app.close());

  it('menu, entry with automatic amount, and checks saved on each fill', async () => {
    const menu = (await http().get('/erp/menu/fleet.fuel').set(as('ownerA')).expect(200)).body;
    expect(menu.tabs.map((t: any) => t.title)).toEqual(['Fuel log', 'Fuel discrepancy check']);
    const a = await mk('fleet.fuel', { date: day(-3), vehicle: truck, meter: 10000, litres: 100, rate: 170, billNo: 'B1' });
    expect(a.data).toMatchObject({ amount: 17000, fullTank: true, check: 'OK', consumption: '' });
    const b = await mk('fleet.fuel', { date: day(-1), vehicle: truck, meter: 10200, litres: 100, rate: 170, billNo: 'B2' });
    expect(b.data.consumption).toBe('2 km / litre');
    expect(b.data.check).toMatch(/Only 2 km per litre — expected 3/);
    const c = await mk('fleet.fuel', { date: day(0), vehicle: truck, meter: 10150, litres: 250, rate: 170 });
    expect(c.data.check).toMatch(/more than the tank holds.*lower than at the previous fill/);
    await mk('fleet.fuel', { date: day(0), vehicle: truck, meter: 10300, litres: 0 }, 400);
  });

  it('discrepancy report and fuel counted in vehicle earnings', async () => {
    const r = (await http().get('/erp/reports/fleet-fuel').set(as('ownerA')).expect(200)).body;
    expect(r.cards[0].value).toBe('450 l');
    expect(r.tables[0].rows[0]).toMatchObject({ vehicle: 'Tipper 1', fills: 3, litres: 450, cost: 76500, _tone: 'bad' });
    expect(r.tables[1].rows.map((x: any) => x.billNo)).toEqual(['', 'B2']);
    const ranged = (await http().get(`/erp/reports/fleet-fuel?from=${day(-3)}&to=${day(-2)}`).set(as('ownerA')).expect(200)).body;
    expect(ranged.tables[0].rows[0].fills).toBe(1);
    const earn = (await http().get('/erp/reports/fleet-earnings').set(as('ownerA')).expect(200)).body;
    expect(earn.tables[0].rows[0]).toMatchObject({ fuel: 76500, litres: 450 });
    // other workspace sees nothing
    expect((await http().get('/erp/reports/fleet-fuel').set(as('ownerB')).expect(200)).body.tables[0].rows).toEqual([]);
  });

  it('a person limited to the fuel log page: can enter fuel, nothing else', async () => {
    await http().patch('/users/driver').set(as('ownerA')).send({ modules: ['item:fleet.fuel'] }).expect(200);
    await http().patch('/users/driver').set(as('ownerA')).send({ modules: ['item:nonsense'] }).expect(400);
    const me = (await http().get('/access/me').set(as('driver')).expect(200)).body;
    expect(me.userItems).toEqual(['fleet.fuel']);
    expect(me.modules).toContain('fleet');
    expect(me.modules).not.toContain('bolpatra');
    await http().get('/erp/menu/fleet.fuel').set(as('driver')).expect(200);
    // vehicle drop-down works, the vehicle register itself does not
    expect((await http().get('/erp/options/fleet.vehicle').set(as('driver')).expect(200)).body[0].label).toBe('Tipper 1');
    await mk('fleet.fuel', { date: day(0), vehicle: truck, meter: 10600, litres: 90, rate: 170 }, 201, 'driver');
    await http().get('/erp/menu/fleet.logs').set(as('driver')).expect(403);
    await http().get('/erp/records/fleet.vehicle').set(as('driver')).expect(403);
    await mk('fleet.log', { date: day(0), vehicle: truck, hours: 2 }, 403, 'driver');
    await http().get('/erp/reports/fleet-earnings').set(as('driver')).expect(403);
    await http().get('/tenders').set(as('driver')).expect(403);
    // limited view (≤ 3 pages, not a Site Engineer, no BOQ): no reports, no rates, no amounts, no analysis
    expect(me.limitedView).toBe(true);
    const menu = (await http().get('/erp/menu/fleet.fuel').set(as('driver')).expect(200)).body;
    expect(menu.tabs.map((t: any) => t.title)).toEqual(['Fuel log']);
    expect(menu.tabs[0].def.fields.map((f: any) => f.k)).not.toEqual(expect.arrayContaining(['rate']));
    expect(menu.tabs[0].def.fields.map((f: any) => f.k).filter((k: string) => ['rate', 'amount', 'check', 'consumption'].includes(k))).toEqual([]);
    await http().get('/erp/reports/fleet-fuel').set(as('driver')).expect(403);
    const mine = (await http().get('/erp/records/fleet.fuel').set(as('driver')).expect(200)).body;
    expect(mine.every((r: any) => r.data.rate === undefined && r.data.amount === undefined && r.data.check === undefined)).toBe(true);
    expect((await http().get('/erp/options/fleet.vehicle').set(as('driver')).expect(200)).body[0].extra.hourlyRate).toBeUndefined();
    // a fill without rate takes the last known rate; the driver's reply shows no money
    const saved = (await http().post('/erp/records/fleet.fuel').set(as('driver')).send({ data: { date: day(0), vehicle: truck, meter: 10900, litres: 50 } }).expect(201)).body;
    expect(saved.data).toEqual(expect.not.objectContaining({ amount: expect.anything() }));
    const stored = db.db.erpRecord.find((r) => r.id === saved.id)!;
    expect(stored.data).toMatchObject({ rate: 170, amount: 8500 });
    expect((await http().get('/alerts').set(as('driver')).expect(200)).body).toEqual([]);
    expect((await http().get('/erp/csv').set(as('driver')).expect(200)).body).toEqual([]);
    // a Site Engineer with the same single page keeps rates and reports
    db.db.user.find((u) => u.id === 'driver')!.role = 'SITE_ENGINEER';
    expect((await http().get('/access/me').set(as('driver')).expect(200)).body.limitedView).toBe(false);
    expect((await http().get('/erp/menu/fleet.fuel').set(as('driver')).expect(200)).body.tabs).toHaveLength(2);
    db.db.user.find((u) => u.id === 'driver')!.role = 'VIEWER';
    // 4 pages → not limited
    await http().patch('/users/driver').set(as('ownerA')).send({ modules: ['item:fleet.fuel', 'item:fleet.logs', 'item:fleet.trips', 'item:fleet.vehicles'] }).expect(200);
    expect((await http().get('/access/me').set(as('driver')).expect(200)).body.limitedView).toBe(false);
    // owner removes the limit → back to every active module
    await http().patch('/users/driver').set(as('ownerA')).send({ modules: [] }).expect(200);
    expect((await http().get('/access/me').set(as('driver')).expect(200)).body.userItems).toBeNull();
  });
});
