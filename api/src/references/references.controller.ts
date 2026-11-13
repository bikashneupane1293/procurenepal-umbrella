import { Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ADMIN_ROLES } from '../access/module-registry';
import { ReferencesService } from './references.service';

@Controller('references')
@UseGuards(JwtAuthGuard)
export class ReferencesController {
  constructor(private readonly refs: ReferencesService) {}

  @Get()
  list() {
    return this.refs.list();
  }

  // Manual for now — no scheduler is wired up yet (see PROGRESS.md "Next works").
  @Post('check')
  check(@CurrentUser() user: any) {
    if (!ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only the workspace Owner can run this check');
    return this.refs.checkAll();
  }
}
