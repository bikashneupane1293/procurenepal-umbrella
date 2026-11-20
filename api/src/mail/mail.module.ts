import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { WhatsAppService } from './whatsapp.service';

@Global()
@Module({ providers: [MailService, WhatsAppService], exports: [MailService, WhatsAppService] })
export class MailModule {}
