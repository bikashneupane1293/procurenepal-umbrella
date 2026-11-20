// Each person's morning-alert choices (Task 16): email on/off, WhatsApp number and on/off.
// Stored in PlatformSetting under "prefs:<userId>" — no database change.
import { BadRequestException, Body, Controller, Get, Injectable, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WhatsAppService, normalizePhone } from '../mail/whatsapp.service';
import { MailService } from '../mail/mail.service';

export interface Prefs { morningEmail?: boolean; whatsapp?: string | null; morningWhatsapp?: boolean }
/** Owners and Directors get the 7:00 AM email unless they switch it off; everyone else only if they switch it on. */
export const emailByDefault = (role: string) => ['OWNER', 'DIRECTOR'].includes(role);

@Injectable()
export class PreferencesService {
  constructor(private prisma: PrismaService) {}
  async get(userId: string): Promise<Prefs> {
    const s: any = await this.prisma.platformSetting.findUnique({ where: { key: `prefs:${userId}` } });
    return s?.value ?? {};
  }
  async set(userId: string, p: Prefs) {
    await this.prisma.platformSetting.upsert({ where: { key: `prefs:${userId}` }, create: { key: `prefs:${userId}`, value: p as any, updatedBy: userId } as any, update: { value: p as any, updatedBy: userId } as any });
    return p;
  }
}

@Controller('me/preferences')
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private prefs: PreferencesService, private wa: WhatsAppService, private mail: MailService) {}

  @Get()
  async get(@CurrentUser() u: any) {
    const p = await this.prefs.get(u.userId);
    return { morningEmail: p.morningEmail ?? emailByDefault(u.role), whatsapp: p.whatsapp ?? '', morningWhatsapp: !!p.morningWhatsapp,
      emailAvailable: this.mail.enabled(), whatsappAvailable: this.wa.enabled() };
  }

  @Put()
  async put(@CurrentUser() u: any, @Body() b: any) {
    const cur = await this.prefs.get(u.userId);
    const next: Prefs = { ...cur };
    if (b?.morningEmail !== undefined) {
      if (typeof b.morningEmail !== 'boolean') throw new BadRequestException('morningEmail must be true or false');
      next.morningEmail = b.morningEmail;
    }
    if (b?.whatsapp !== undefined) {
      if (b.whatsapp === '' || b.whatsapp === null) next.whatsapp = null;
      else {
        const n = normalizePhone(b.whatsapp);
        if (!n) throw new BadRequestException('Enter a mobile number like 98XXXXXXXX (Nepal) or with country code, e.g. +97798XXXXXXXX');
        next.whatsapp = n;
      }
    }
    if (b?.morningWhatsapp !== undefined) {
      if (typeof b.morningWhatsapp !== 'boolean') throw new BadRequestException('morningWhatsapp must be true or false');
      next.morningWhatsapp = b.morningWhatsapp;
    }
    if (next.morningWhatsapp && !next.whatsapp) throw new BadRequestException('Add your WhatsApp number first');
    await this.prefs.set(u.userId, next);
    return this.get(u);
  }
}
