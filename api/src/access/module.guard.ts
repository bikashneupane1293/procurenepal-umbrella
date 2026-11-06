import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessService } from './access.service';
import { MODULES } from './module-registry';

export const MODULE_KEY = 'requiredModule';
/** Put on a controller (after JwtAuthGuard) to require an active module, e.g. @RequireModule('bolpatra') */
export const RequireModule = (key: string) => SetMetadata(MODULE_KEY, key);

/**
 * Blocks the request when the module is switched off for the workspace,
 * or the signed-in user is not allowed to use it. Use together with JwtAuthGuard:
 *   @UseGuards(JwtAuthGuard, ModuleGuard) @RequireModule('bolpatra')
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(MODULE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('No user context');
    const allowed = await this.access.effectiveModules(user.tenantId, user.userId, user.role);
    if (!allowed.includes(key)) {
      const name = MODULES.find((m) => m.key === key)?.name ?? key;
      throw new ForbiddenException(`The ${name} module is not active for your account. Ask the workspace Owner (Companies → User Setup).`);
    }
    return true;
  }
}
