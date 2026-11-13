import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessService } from './access.service';
import { CreateUserDto, TenantItemsDto, TenantModulesDto, UpdateUserDto } from './dto/user.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  // What the signed-in user may see (used to build the menu)
  @Get('access/me')
  me(@CurrentUser() user: any) {
    return this.access.me(user.tenantId, user.userId, user.role);
  }

  // Switch modules on/off for the whole workspace (Owner)
  @Put('access/workspace-modules')
  setModules(@CurrentUser() user: any, @Body() dto: TenantModulesDto) {
    return this.access.setTenantModules(user.tenantId, user.role, dto.modules ?? {});
  }

  // Switch a single sidebar item on/off within an active module (Owner)
  @Put('access/workspace-items')
  setItems(@CurrentUser() user: any, @Body() dto: TenantItemsDto) {
    return this.access.setTenantItems(user.tenantId, user.role, dto.items ?? {});
  }

  // User Setup
  @Get('users')
  list(@CurrentUser() user: any) {
    return this.access.listUsers(user.tenantId, user.role);
  }

  @Post('users')
  create(@CurrentUser() user: any, @Body() dto: CreateUserDto) {
    return this.access.createUser(user.tenantId, user.role, dto);
  }

  @Patch('users/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.access.updateUser(user.tenantId, user.role, user.userId, id, dto);
  }

  // Owner lost the activation link — issue a fresh one
  @Post('users/:id/activation-link')
  activationLink(@CurrentUser() user: any, @Param('id') id: string) {
    return this.access.getActivationLink(user.tenantId, user.role, id);
  }

  // Sign-in / sign-out history (Owner, Super Admin, HR and Operations)
  @Get('users/login-sessions')
  loginSessions(@CurrentUser() user: any, @Query('userId') userId?: string) {
    return this.access.listLoginSessions(user.tenantId, user.role, userId);
  }
}
