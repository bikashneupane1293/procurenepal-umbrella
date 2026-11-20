// Demo controller + read-only guard for the public demo workspace (Task 15).
import { CallHandler, Controller, ExecutionContext, ForbiddenException, HttpCode, Injectable, NestInterceptor, Post, UseGuards } from '@nestjs/common';
import { from, switchMap } from 'rxjs';
import { DemoService } from './demo.service';
import { DigestService } from '../alerts/digest.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/** Anyone in the demo workspace may look around but not change anything (signing out still works). */
@Injectable()
export class DemoReadOnlyInterceptor implements NestInterceptor {
  constructor(private demo: DemoService) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    const method = String(req?.method ?? '').toUpperCase();
    if (!req?.user?.tenantId || ['GET', 'HEAD', 'OPTIONS'].includes(method) || /^\/auth\/logout/.test(req.originalUrl ?? req.url ?? '')) return next.handle();
    return from(this.demo.tenantId()).pipe(switchMap((id) => {
      if (id && id === req.user.tenantId) throw new ForbiddenException('This is the demo — changes are switched off. Create your free account to enter your own data.');
      return next.handle();
    }));
  }
}

@Controller()
export class DemoController {
  constructor(private demo: DemoService, private digest: DigestService) {}

  /** Public: a read-only session in the sample workspace ("Try the demo" on the home page). */
  @Post('demo/session') @HttpCode(200)
  session() { return this.demo.session(); }

  @Post('admin/demo/reset') @HttpCode(200) @UseGuards(JwtAuthGuard)
  async reset(@CurrentUser() u: any) {
    if (u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Super Admin only');
    return this.demo.reset();
  }

  /** Super Admin: send today's morning alerts now (normally 7:00 AM Nepal Time). */
  @Post('admin/digest/run') @HttpCode(200) @UseGuards(JwtAuthGuard)
  async runDigest(@CurrentUser() u: any) {
    if (u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Super Admin only');
    return this.digest.run();
  }
}
