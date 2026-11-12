import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ErpService } from './erp.service';
import { ErpFlowService } from './erp-flow.service';

/**
 * One API for every register and document of the ERP engine.
 * Module access is checked per register / report inside the services (a register can belong to two menus).
 */
@Controller('erp')
@UseGuards(JwtAuthGuard)
export class ErpController {
  constructor(private readonly erp: ErpService, private readonly flow: ErpFlowService) {}

  @Get('menu/:id') menu(@CurrentUser() u: any, @Param('id') id: string) { return this.erp.menu(u, id); }
  @Get('options/:ref') options(@CurrentUser() u: any, @Param('ref') ref: string, @Query('projectId') projectId?: string) { return this.erp.options(u, ref, { projectId }); }
  @Get('reports/:name') report(@CurrentUser() u: any, @Param('name') name: string, @Query() q: Record<string, string>) { return this.flow.report(u, name, q); }
  @Post('actions/:name') action(@CurrentUser() u: any, @Param('name') name: string, @Body() body: any) { return this.flow.action(u, name, body ?? {}); }
  @Get('csv') datasets(@CurrentUser() u: any) { return this.flow.datasets(u); }
  @Get('csv/:key') dataset(@CurrentUser() u: any, @Param('key') key: string) { return this.flow.dataset(u, key); }

  @Get('records/:entity') list(@CurrentUser() u: any, @Param('entity') e: string, @Query('status') status?: string, @Query('projectId') projectId?: string, @Query('companyId') companyId?: string) {
    return this.erp.list(u, e, { status, projectId, companyId });
  }
  @Get('records/:entity/:id') get(@CurrentUser() u: any, @Param('entity') e: string, @Param('id') id: string) { return this.erp.get(u, e, id); }
  @Post('records/:entity') create(@CurrentUser() u: any, @Param('entity') e: string, @Body() body: any) { return this.erp.create(u, e, body); }
  @Patch('records/:entity/:id') update(@CurrentUser() u: any, @Param('entity') e: string, @Param('id') id: string, @Body() body: any) { return this.erp.update(u, e, id, body); }
  @Delete('records/:entity/:id') remove(@CurrentUser() u: any, @Param('entity') e: string, @Param('id') id: string) { return this.erp.remove(u, e, id); }
}
