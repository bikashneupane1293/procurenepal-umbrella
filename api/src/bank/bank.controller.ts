import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ModuleGuard, RequireModule } from '../access/module.guard';
import { BankService } from './bank.service';
import { GuaranteeService } from './guarantee.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { CreateGuaranteeDto, UpdateGuaranteeDto } from './dto/guarantee.dto';

const days = (v?: string) => Math.min(365, Math.max(1, Number(v) || 30));

@Controller()
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('bank')
export class BankController {
  constructor(private readonly banks: BankService, private readonly guarantees: GuaranteeService) {}

  // ---------- Banks ----------
  @Get('banks')
  listBanks(@CurrentUser('tenantId') tenantId: string, @Query('companyId') companyId?: string) {
    return this.banks.list(tenantId, companyId);
  }
  @Get('banks/:id')
  getBank(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.banks.findOne(tenantId, id);
  }
  @Post('banks')
  createBank(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateBankDto) {
    return this.banks.create(tenantId, dto);
  }
  @Patch('banks/:id')
  updateBank(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateBankDto) {
    return this.banks.update(tenantId, id, dto);
  }
  @Delete('banks/:id')
  removeBank(@CurrentUser() user: any, @Param('id') id: string) {
    return this.banks.remove(user.tenantId, user.role, id);
  }

  // ---------- Bank guarantees ----------
  // static paths first so they are not read as an :id
  @Get('bank-guarantees/summary')
  summary(@CurrentUser('tenantId') tenantId: string, @Query('days') d?: string) {
    return this.guarantees.summary(tenantId, days(d));
  }
  @Post('bank-guarantees/sync-from-bids')
  syncFromBids(@CurrentUser() user: any) {
    return this.guarantees.syncFromBids(user.tenantId, user.userId);
  }
  @Get('bank-guarantees')
  list(
    @CurrentUser('tenantId') tenantId: string,
    @Query('status') status?: string, @Query('type') type?: string, @Query('companyId') companyId?: string,
    @Query('bankId') bankId?: string, @Query('bidId') bidId?: string, @Query('tenderId') tenderId?: string, @Query('days') d?: string,
  ) {
    return this.guarantees.list(tenantId, { status, type, companyId, bankId, bidId, tenderId }, days(d));
  }
  @Get('bank-guarantees/:id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.guarantees.findOne(tenantId, id);
  }
  @Post('bank-guarantees')
  create(@CurrentUser() user: any, @Body() dto: CreateGuaranteeDto) {
    return this.guarantees.create(user.tenantId, user.userId, dto);
  }
  @Patch('bank-guarantees/:id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateGuaranteeDto) {
    return this.guarantees.update(user.tenantId, user.userId, id, dto);
  }
  @Delete('bank-guarantees/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.guarantees.remove(user.tenantId, user.role, id);
  }
}
