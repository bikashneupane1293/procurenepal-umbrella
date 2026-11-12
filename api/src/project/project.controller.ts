import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ModuleGuard, RequireModule } from '../access/module.guard';
import { ProjectService } from './project.service';
import { CreateProjectDto, SaveBoqDto, UpdateProjectDto } from './dto/project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('project')
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query('status') status?: string, @Query('companyId') companyId?: string) {
    return this.projects.list(tenantId, { status, companyId });
  }
  // static path before :id
  @Get('won-bids')
  wonBids(@CurrentUser('tenantId') tenantId: string) {
    return this.projects.wonBids(tenantId);
  }
  @Post('from-bid/:bidId')
  fromBid(@CurrentUser() user: any, @Param('bidId') bidId: string) {
    return this.projects.createFromBid(user.tenantId, user.userId, bidId);
  }
  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.projects.findOne(tenantId, id);
  }
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateProjectDto) {
    return this.projects.create(user.tenantId, user.userId, dto);
  }
  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user.tenantId, user.userId, id, dto);
  }
  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.projects.remove(user.tenantId, user.role, id);
  }
  @Get(':id/boq')
  boq(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.projects.getBoq(tenantId, id);
  }
  @Put(':id/boq')
  saveBoq(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: SaveBoqDto) {
    return this.projects.saveBoq(tenantId, id, dto);
  }
}
