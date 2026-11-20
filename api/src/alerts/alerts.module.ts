import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { ErpModule } from '../erp/erp.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AlertsService } from './alerts.service';
import { DigestService } from './digest.service';
import { DemoService } from '../demo/demo.service';
import { DemoController, DemoReadOnlyInterceptor } from '../demo/demo';
import { ActivityController, AuditInterceptor } from '../audit/activity';
import { PreferencesController, PreferencesService } from './preferences';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private alerts: AlertsService) {}
  /** "Today" list for the Dashboard — only modules (and pages) this person may open. */
  @Get() list(@CurrentUser() u: any) { return this.alerts.forUser(u); }
}

/** Task 15: Today alerts, 7:00 AM email, activity log, public demo. */
@Module({
  imports: [PrismaModule, ErpModule, AuthModule],
  controllers: [AlertsController, ActivityController, DemoController, PreferencesController],
  providers: [
    AlertsService, DigestService, DemoService, PreferencesService,
    { provide: APP_INTERCEPTOR, useClass: DemoReadOnlyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AlertsModule {}
