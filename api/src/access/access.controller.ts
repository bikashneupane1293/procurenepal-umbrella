import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessService } from './access.service';
import { CreateUserDto, TenantModulesDto, UpdateUserDto } from './dto/user.dto';

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
}
