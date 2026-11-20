import { Body, Controller, Delete, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ModuleGuard, RequireModule } from '../access/module.guard';
import { TenderRequirementsService } from './tender-requirements.service';

@Controller('tenders/:tenderId/requirements')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('bolpatra')
export class TenderRequirementsController {
  constructor(private readonly reqs: TenderRequirementsService) {}

  @Get()
  list(@CurrentUser() u: any, @Param('tenderId') tenderId: string) {
    return this.reqs.list(u.tenantId, tenderId);
  }

  @Put()
  replace(@CurrentUser() u: any, @Param('tenderId') tenderId: string, @Body() body: any) {
    return this.reqs.replace(u.tenantId, u.userId, tenderId, body);
  }

  @Patch(':id')
  update(@CurrentUser() u: any, @Param('tenderId') tenderId: string, @Param('id') id: string, @Body() body: any) {
    return this.reqs.update(u.tenantId, u.userId, tenderId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() u: any, @Param('tenderId') tenderId: string, @Param('id') id: string) {
    return this.reqs.remove(u.tenantId, tenderId, id);
  }
}
