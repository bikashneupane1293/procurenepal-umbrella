// "Today" alerts (Task 15): bid deadlines, guarantees, vehicle renewals and services, fuel flags,
// milestones, documents and LCs — one list for the Dashboard and the 7:00 AM email.
// All day counts are Nepal calendar days. © Cuidado Technology Pvt. Ltd.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { nptDate, nptDaysBetween, nptToday } from '../common/nepal-time';

export interface Alert {
  module: string;
  tone: 'bad' | 'warn';
  title: string;
  detail: string;
  date: string;
  /** Nepal days from today (negative = already past) */
  days: number;
  link: string;
}

const when = (days: number) => (days < 0 ? `${-days} day(s) ago` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);
const CLOSED_TENDER = ['cancelled', 'canceled', 'closed', 'awarded', 'lost', 'submitted', 'withdrawn', 'not_bidding'];

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService, private access: AccessService) {}

  /** Alerts for the signed-in person: only modules they may open; page-limited staff get only their pages'. */
  async forUser(u: { tenantId: string; userId: string; role: string }): Promise<Alert[]> {
    const mods = await this.access.effectiveModules(u.tenantId, u.userId, u.role);
    if (await this.access.limitedView(u.tenantId, u.userId, u.role)) return []; // no analysis for limited-view staff
    const items = await this.access.userItems(u.tenantId, u.userId, u.role);
    const all = await this.collect(u.tenantId, mods);
    if (!items) return all;
    return all.filter((a) => items.some((id) => a.link === '/m/' + id));
  }

  async collect(tenantId: string, modules: string[], today = nptToday()): Promise<Alert[]> {
    const out: Alert[] = [];
    const has = (m: string) => modules.includes(m);
    const days = (d: any) => nptDaysBetween(today, nptDate(d));
    const erp = async (entity: string) => (await this.prisma.erpRecord.findMany({ where: { tenantId, entity } })) as any[];

    if (has('bolpatra')) {
      for (const t of (await this.prisma.tender.findMany({ where: { tenantId } })) as any[]) {
        if (!t.deadlineDate || CLOSED_TENDER.includes(String(t.status ?? '').toLowerCase())) continue;
        const d = days(t.deadlineDate);
        if (d < 0 || d > 7) continue;
        out.push({ module: 'bolpatra', tone: d <= 2 ? 'bad' : 'warn', title: `Bid deadline ${when(d)}`, detail: `${t.ifbNumber} — ${t.projectTitle}`, date: nptDate(t.deadlineDate), days: d, link: `/tenders/${t.id}` });
      }
    }
    if (has('bank')) {
      for (const g of (await this.prisma.bankGuarantee.findMany({ where: { tenantId } })) as any[]) {
        if (!g.expiryDate || g.status !== 'ACTIVE') continue;
        const d = days(g.expiryDate);
        if (d > 30 || d < -60) continue;
        out.push({ module: 'bank', tone: d <= 7 ? 'bad' : 'warn', title: `Bank guarantee ${d < 0 ? 'expired' : 'expires'} ${when(d)}`,
          detail: `${String(g.type).replace(/_/g, ' ').toLowerCase()} · ${g.bankName}${g.guaranteeNo ? ' · ' + g.guaranteeNo : ''} · Rs ${Number(g.amount).toLocaleString('en-IN')}`, date: nptDate(g.expiryDate), days: d, link: '/bank-guarantees' });
      }
      for (const l of await erp('bank.lc')) {
        if (['SETTLED', 'CANCELLED'].includes(l.status)) continue;
        const due = l.data?.dueDate ?? l.data?.expiryDate;
        if (!due) continue;
        const d = days(due);
        if (d > 30 || d < -60) continue;
        out.push({ module: 'bank', tone: d <= 7 ? 'bad' : 'warn', title: `LC ${l.data?.dueDate ? 'payment due' : 'expires'} ${when(d)}`, detail: l.number ?? l.data?.lcNo ?? 'Letter of credit', date: nptDate(due), days: d, link: '/m/bank.lc' });
      }
    }
    if (has('fleet')) {
      const vs = await erp('fleet.vehicle');
      const vn = (id: string) => vs.find((v) => v.id === id)?.data?.name ?? 'Vehicle';
      for (const x of await erp('fleet.tax')) {
        if (x.status !== 'ACTIVE' || !x.data?.expiry) continue;
        const d = days(x.data.expiry);
        if (d > 30 || d < -60) continue;
        out.push({ module: 'fleet', tone: d <= 7 ? 'bad' : 'warn', title: `${String(x.data.kind ?? 'Renewal').replace(/_/g, ' ').toLowerCase()} ${d < 0 ? 'expired' : 'expires'} ${when(d)}`.replace(/^./, (c) => c.toUpperCase()),
          detail: vn(x.data.vehicle), date: nptDate(x.data.expiry), days: d, link: '/m/fleet.tax' });
      }
      for (const x of await erp('fleet.maintenance')) {
        if (!x.data?.nextDueDate) continue;
        const d = days(x.data.nextDueDate);
        if (d > 14 || d < -60) continue;
        out.push({ module: 'fleet', tone: d < 0 ? 'bad' : 'warn', title: `Service due ${when(d)}`, detail: vn(x.data.vehicle), date: nptDate(x.data.nextDueDate), days: d, link: '/m/fleet.maintenance' });
      }
      for (const x of await erp('fleet.fuel')) {
        const c = String(x.data?.check ?? '');
        if (!c || c === 'OK' || !x.data?.date) continue;
        const d = days(x.data.date);
        if (d < -7 || d > 0) continue;
        out.push({ module: 'fleet', tone: /tank holds|lower than|worse/.test(c) ? 'bad' : 'warn', title: 'Fuel entry to check', detail: `${vn(x.data.vehicle)} · ${x.data.litres} l · ${c}`, date: nptDate(x.data.date), days: d, link: '/m/fleet.fuel' });
      }
    }
    if (has('project')) {
      for (const m of await erp('project.milestone')) {
        if (m.status === 'ACHIEVED' || !m.data?.targetDate) continue;
        const d = days(m.data.targetDate);
        if (d >= 0 || d < -90) continue;
        out.push({ module: 'project', tone: 'bad', title: `Milestone overdue ${-d} day(s)`, detail: m.data.title ?? m.data.name ?? 'Milestone', date: nptDate(m.data.targetDate), days: d, link: '/m/project.milestones' });
      }
      for (const x of await erp('project.document')) {
        if (!x.data?.expiry) continue;
        const d = days(x.data.expiry);
        if (d > 30 || d < -30) continue;
        out.push({ module: 'project', tone: d <= 7 ? 'bad' : 'warn', title: `Document ${d < 0 ? 'expired' : 'expires'} ${when(d)}`, detail: x.data.title ?? x.data.name ?? 'Project document', date: nptDate(x.data.expiry), days: d, link: '/m/project.documents' });
      }
    }
    return out.sort((a, b) => (a.tone === b.tone ? a.days - b.days : a.tone === 'bad' ? -1 : 1));
  }
}
