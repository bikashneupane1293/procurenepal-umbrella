// 7:00 AM (Nepal Time) alerts by email / WhatsApp (Task 15–16) — Owners and Directors by default; each person can switch email and WhatsApp on or off on their Account page.
// Runs inside the API: a check every 10 minutes (the cron-job.org ping keeps the free server awake);
// a PlatformSetting row remembers the day already sent, so a restart never sends twice.
// Also resets the public demo workspace once a day (03:00 NPT). © Cuidado Technology Pvt. Ltd.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AccessService } from '../access/access.service';
import { AlertsService } from './alerts.service';
import { DemoService } from '../demo/demo.service';
import { WhatsAppService } from '../mail/whatsapp.service';
import { PreferencesService, emailByDefault } from './preferences';
import { nptToday, NPT_OFFSET_MINUTES } from '../common/nepal-time';

const DIGEST_KEY = 'digest';
const DIGEST_HOUR = 7;
const DEMO_RESET_HOUR = 3;

export const nptHour = (now = new Date()) => new Date(now.getTime() + NPT_OFFSET_MINUTES * 60000).getUTCHours();

@Injectable()
export class DigestService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Digest');
  private timer: any = null;
  constructor(private prisma: PrismaService, private mail: MailService, private access: AccessService, private alerts: AlertsService, private demo: DemoService,
    private wa: WhatsAppService, private prefs: PreferencesService) {}

  onModuleInit() {
    if (process.env.JEST_WORKER_ID || process.env.DIGEST_DISABLED === 'true') return;
    this.timer = setInterval(() => this.tick().catch((e) => this.log.warn(`tick failed: ${e?.message}`)), 10 * 60 * 1000);
    setTimeout(() => this.tick().catch(() => {}), 60 * 1000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick(now = new Date()) {
    const h = nptHour(now), today = nptToday(now);
    if (h >= DEMO_RESET_HOUR) await this.demo.resetIfStale(today);
    if (h < DIGEST_HOUR) return;
    const last: any = await this.prisma.platformSetting.findUnique({ where: { key: DIGEST_KEY } });
    if (last?.value?.date === today) return;
    // claim the day first, so two overlapping ticks can't both send
    await this.prisma.platformSetting.upsert({ where: { key: DIGEST_KEY }, create: { key: DIGEST_KEY, value: { date: today } as any }, update: { value: { date: today } as any } });
    const r = await this.run(today);
    await this.prisma.platformSetting.update({ where: { key: DIGEST_KEY }, data: { value: { date: today, ...r } as any } });
    this.log.log(`morning alerts ${today}: ${r.emails} email(s) to ${r.workspaces} workspace(s)`);
  }

  /** Send today's alerts now (also used by Super Admin → "Send morning alerts now"). Each person gets the
   *  alerts of the modules they can open, by email and/or WhatsApp as they chose on their Account page. */
  async run(today = nptToday(), onlyTenantId?: string) {
    const demoId = await this.demo.tenantId();
    const tenants = ((await this.prisma.tenant.findMany({ where: onlyTenantId ? { id: onlyTenantId } : {} })) as any[]).filter((t) => t.isActive !== false && t.id !== demoId);
    let workspaces = 0, emails = 0, whatsapps = 0, alerts = 0;
    for (const t of tenants) {
      const tm = await this.access.tenantModules(t.id);
      const all = await this.alerts.collect(t.id, Object.keys(tm).filter((k) => tm[k]), today);
      if (!all.length) continue;
      const people = ((await this.prisma.user.findMany({ where: { tenantId: t.id } })) as any[]).filter((u) => u.isActive !== false && u.status !== 'PENDING');
      let reached = false;
      for (const p of people) {
        const pr = await this.prefs.get(p.id);
        const byEmail = pr.morningEmail ?? emailByDefault(p.role);
        const byWa = !!(pr.morningWhatsapp && pr.whatsapp);
        if (!byEmail && !byWa) continue;
        const list = await this.alerts.forUser({ tenantId: t.id, userId: p.id, role: p.role });
        if (!list.length) continue;
        reached = true;
        const bad = list.filter((a) => a.tone === 'bad').length;
        if (byEmail) {
          const lines = [
            `Good morning! Here is what needs attention in ${t.name} today (${today}, Nepal Time):`,
            ...list.slice(0, 40).map((a) => `${a.tone === 'bad' ? '🔴' : '🟠'} ${a.title} — ${a.detail} (${a.date})`),
            ...(list.length > 40 ? [`…and ${list.length - 40} more on your Dashboard.`] : []),
            `Open ProcureNepal: ${this.mail.url('/dashboard')}`,
            `You get this because morning alerts are on for you — switch them off on your Account page: ${this.mail.url('/account')}`,
          ];
          if (await this.mail.send({ to: p.email, toName: p.fullName, subject: `ProcureNepal — ${list.length} item(s) need attention today${bad ? ` (${bad} urgent)` : ''}`, lines })) emails++;
        }
        if (byWa) {
          const text = `${t.name}, ${today}: ${list.length} item(s)${bad ? `, ${bad} urgent` : ''} — ` + list.slice(0, 8).map((a) => `${a.title}: ${a.detail}`).join('; ') + (list.length > 8 ? `; +${list.length - 8} more` : '') + '.';
          if (await this.wa.sendAlerts(pr.whatsapp!, text)) whatsapps++;
        }
      }
      if (reached) { workspaces++; alerts += all.length; }
    }
    return { workspaces, emails, whatsapps, alerts, emailEnabled: this.mail.enabled(), whatsappEnabled: this.wa.enabled() };
  }
}
