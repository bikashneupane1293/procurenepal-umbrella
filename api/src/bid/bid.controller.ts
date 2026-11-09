import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ModuleGuard, RequireModule } from '../access/module.guard';
import { BidService } from './bid.service';
import { BidReportService } from './bid-report.service';
import { CreateBidDto, UpdateBidDto } from './dto/bid.dto';

@Controller()
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('bolpatra')
export class BidController {
  constructor(
    private readonly bids: BidService,
    private readonly reports: BidReportService,
  ) {}

  @Get('bids')
  list(
    @CurrentUser('tenantId') tenantId: string,
    @Query('tenderId') tenderId?: string,
    @Query('status') status?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.bids.list(tenantId, { tenderId, status, companyId });
  }

  @Get('bids/:id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.bids.findOne(tenantId, id);
  }

  @Post('bids')
  create(@CurrentUser() user: any, @Body() dto: CreateBidDto) {
    return this.bids.create(user.tenantId, user.userId, dto);
  }

  @Patch('bids/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateBidDto) {
    return this.bids.update(user.tenantId, user.userId, id, dto);
  }

  // Owner / Director only (checked in the service)
  @Delete('bids/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.bids.remove(user.tenantId, user.role, id);
  }

  // Bolpatra Reports — ?days=30 (look-ahead for deadlines and expiries, 1–365)
  @Get('bolpatra/reports')
  summary(@CurrentUser('tenantId') tenantId: string, @Query('days') days?: string) {
    const d = Math.min(365, Math.max(1, Number(days) || 30));
    return this.reports.summary(tenantId, d);
  }
}
