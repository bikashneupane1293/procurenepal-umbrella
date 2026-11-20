// Public "Try the demo" workspace (Task 15): sample company, tenders, guarantee, vehicles and fuel
// entries, rebuilt once a day. Visitors get a read-only session (DemoReadOnlyInterceptor).
// © Cuidado Technology Pvt. Ltd.
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ErpService } from '../erp/erp.service';
import { entityDef } from '../erp/erp.registry';
import { AuthService } from '../auth/auth.service';
import { addNptDays, nptToday } from '../common/nepal-time';

const KEY = 'demo';
const at = (ymd: string) => new Date(ymd + 'T06:15:00.000Z'); // 12:00 NPT that day

@Injectable()
export class DemoService {
  private log = new Logger('Demo');
  private cache: { id: string | null; until: number } = { id: null, until: 0 };
  constructor(private prisma: PrismaService, private erp: ErpService, private auth: AuthService) {}

  private async setting(): Promise<{ tenantId: string; userId: string; date: string } | null> {
    const s: any = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    return s?.value ?? null;
  }

  /** The demo workspace's id (cached for a minute — checked on every write request). */
  async tenantId(): Promise<string | null> {
    if (Date.now() < this.cache.until) return this.cache.id;
    const s = await this.setting();
    this.cache = { id: s?.tenantId ?? null, until: Date.now() + 60_000 };
    return this.cache.id;
  }

  async session() {
    let s = await this.setting();
    if (!s || !(await this.prisma.user.findUnique({ where: { id: s.userId } }))) s = await this.reset();
    const t = await this.auth.issueFor(s.userId);
    return { ...t, demo: true };
  }

  async resetIfStale(today = nptToday()) {
    const s = await this.setting();
    if (s && s.date === today) return;
    if (!s) return; // nobody has opened the demo yet — build it on first use
    await this.reset();
  }

  /** Delete everything of one (demo) workspace — children first, then the workspace itself. */
  private async wipe(tenantId: string) {
    const order = ['tenderRequirement', 'erpRecord', 'bankGuarantee', 'boqItem', 'bid', 'project', 'bank', 'qualificationResult', 'tender',
      'certificate', 'annualTurnover', 'company', 'loginSession', 'auditLog', 'staffInvite', 'tenantFeatureFlag', 'subscription', 'user'];
    for (const m of order) await (this.prisma as any)[m].deleteMany({ where: { tenantId } });
    await this.prisma.tenant.delete({ where: { id: tenantId } });
  }

  async reset() {
    const old = await this.setting();
    const today = nptToday();
    const d = (k: number) => addNptDays(today, k);
    const stamp = Date.now().toString(36);
    const tenant: any = await this.prisma.tenant.create({ data: { name: 'Demo Construction Pvt. Ltd.', slug: `demo-${stamp}` } as any });
    const user: any = await this.prisma.user.create({ data: {
      tenantId: tenant.id, email: `demo-${stamp}@demo.procurenepal.com`, fullName: 'Demo visitor', role: 'DIRECTOR' as any,
      passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10), isActive: true, isVerified: true, status: 'ACTIVE', modules: [],
    } as any });
    const t = tenant.id;
    const me = { tenantId: t, userId: user.id, role: 'OWNER' };

    const co: any = await this.prisma.company.create({ data: { tenantId: t, name: 'Himal Nirman Sewa Pvt. Ltd.', slug: 'himal-nirman' } as any });
    const tenders = [
      { ifb: 'DoR/NCB/W-12/2083-84', title: 'Upgrading of Hetauda–Bhimphedi Road (Ch. 4+000–9+500)', pe: 'Division Road Office, Hetauda', k: 2 },
      { ifb: 'IDOPAN/NCB/BRIDGE/22-083/84', title: 'Construction of Pheme Khola Bridge along Phidim–Phalot', pe: 'Infrastructure Development Office, Panchthar', k: 6 },
      { ifb: 'BMM/NCB/WORKS/07-2083', title: 'Bagmati Municipality Ward Office Building', pe: 'Bagmati Municipality, Sarlahi', k: 19 },
    ];
    for (const x of tenders) {
      await this.prisma.tender.create({ data: { tenantId: t, ifbNumber: x.ifb, projectTitle: x.title, procuringEntity: x.pe, deadlineDate: at(d(x.k)), status: 'active' } as any });
    }
    const bank: any = await this.prisma.bank.create({ data: { tenantId: t, companyId: co.id, name: 'Nabil Bank', branch: 'Hetauda' } as any });
    await this.prisma.bankGuarantee.create({ data: { tenantId: t, companyId: co.id, bankId: bank.id, bankName: 'Nabil Bank', type: 'BID_SECURITY', guaranteeNo: 'NBL/BG/2083/114', amount: 4000000, issueDate: at(d(-50)), expiryDate: at(d(9)), status: 'ACTIVE' } as any });

    const mk = async (entity: string, data: any) => this.erp.createRaw(me as any, entityDef(entity)!, { data });
    const tipper = await mk('fleet.vehicle', { name: 'Tipper 1', regNo: 'Ba 3 Kha 4521', type: 'TIPPER', meterType: 'KM', tankCapacity: 200, expectedFuel: 3, fuelTolerancePct: 15, hourlyRate: 2500, kmRate: 60 });
    const exc = await mk('fleet.vehicle', { name: 'Excavator JCB 1', regNo: 'Ba 1 Ja 210', type: 'EXCAVATOR', meterType: 'HOURS', tankCapacity: 150, expectedFuel: 12, fuelTolerancePct: 10, hourlyRate: 4500 });
    const fills: [any, number, number, number, string][] = [
      [tipper, -9, 41200, 120, 'HSD/1021'], [tipper, -6, 41560, 118, 'HSD/1034'], [tipper, -2, 41790, 112, 'HSD/1058'],
      [exc, -8, 2310, 140, 'HSD/1025'], [exc, -4, 2321, 128, 'HSD/1047'], [exc, -1, 2330, 125, 'HSD/1066'],
    ];
    for (const [v, k, meter, litres, bill] of fills) await mk('fleet.fuel', { date: d(k), vehicle: v.id, meter, litres, rate: 171, fullTank: true, station: 'Hetauda Fuel Centre', billNo: bill });
    await mk('fleet.tax', { vehicle: tipper.id, kind: 'INSURANCE', provider: 'Shikhar Insurance', policyNo: 'SIC/MV/88231', from: d(-356), expiry: d(9), amount: 38500 });
    await mk('fleet.maintenance', { vehicle: exc.id, date: d(-80), type: 'SERVICE', meter: 2100, description: '250-hour service', partsCost: 18000, labourCost: 4000, nextDueDate: d(4), nextDueMeter: 2350 });

    await this.prisma.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: { tenantId: t, userId: user.id, date: today } as any }, update: { value: { tenantId: t, userId: user.id, date: today } as any } });
    this.cache = { id: t, until: Date.now() + 60_000 };
    if (old?.tenantId) {
      try { await this.wipe(old.tenantId); }
      catch (e: any) {
        this.log.warn(`old demo workspace not deleted (${e?.message}); switching it off`);
        await this.prisma.tenant.update({ where: { id: old.tenantId }, data: { isActive: false } as any }).catch(() => {});
      }
    }
    this.log.log(`demo workspace rebuilt for ${today}`);
    return { tenantId: t, userId: user.id, date: today };
  }
}
