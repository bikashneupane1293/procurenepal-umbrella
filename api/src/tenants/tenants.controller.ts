// Platform admin panel (Super Admin only) — the one controller that reads/writes across every
// tenant instead of being scoped to the signed-in user's own one. © Cuidado Technology Pvt. Ltd.
import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, SetModulesDto, SetPlanDto, ToggleTenantDto } from './dto/admin.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('tenants')
  list(@CurrentUser() user: any) {
    return this.tenants.listTenants(user.role);
  }

  @Get('tenants/:id')
  detail(@CurrentUser() user: any, @Param('id') id: string) {
    return this.tenants.getTenant(user.role, id);
  }

  /** Module list + each plan's default modules, for the Admin Panel's checkboxes. */
  @Get('plans')
  plans(@CurrentUser() user: any) {
    return this.tenants.plans(user.role);
  }

  @Put('tenants/:id/modules')
  setModules(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SetModulesDto) {
    return this.tenants.setModules(user.role, id, dto);
  }

  @Post('tenants')
  create(@CurrentUser() user: any, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(user.role, dto);
  }

  @Post('tenants/:id/plan')
  setPlan(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SetPlanDto) {
    return this.tenants.setPlan(user.role, id, dto);
  }

  @Patch('tenants/:id/active')
  toggleActive(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ToggleTenantDto) {
    return this.tenants.toggleTenantActive(user.role, id, dto.isActive);
  }

  @Get('stats')
  stats(@CurrentUser() user: any) {
    return this.tenants.stats(user.role);
  }

  @Get('billing')
  billing(@CurrentUser() user: any) {
    return this.tenants.billing(user.role);
  }
}
