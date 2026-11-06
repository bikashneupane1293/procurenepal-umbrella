import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { TenderService } from './tender.service';
import { CreateTenderDto } from './dto/create-tender.dto';
import { UpdateTenderDto } from './dto/update-tender.dto';
import { EvaluateJvDto } from '../qualification/dto/evaluate-qualification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ModuleGuard, RequireModule } from '../access/module.guard';

@Controller('tenders')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('bolpatra')
export class TenderController {
  constructor(private readonly tenderService: TenderService) {}

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateTenderDto) {
    return this.tenderService.create(tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.tenderService.findAll(tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.tenderService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTenderDto,
  ) {
    return this.tenderService.update(tenantId, id, dto);
  }

  // Owner / Director only (checked in the service)
  @Delete(':id')
  remove(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
  ) {
    return this.tenderService.remove(tenantId, role, id);
  }

  // Evaluate ONE company and save the result
  @Post(':id/evaluate/:companyId')
  evaluate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') tenderId: string,
    @Param('companyId') companyId: string,
  ) {
    return this.tenderService.evaluateAndPersist(tenantId, tenderId, companyId);
  }

  // Evaluate EVERY company of the workspace (company-wide bid decision)
  @Post(':id/evaluate-all')
  evaluateAll(@CurrentUser('tenantId') tenantId: string, @Param('id') tenderId: string) {
    return this.tenderService.evaluateAll(tenantId, tenderId);
  }

  // Evaluate a proposed JV (2–5 partners with shares)
  @Post(':id/evaluate-jv')
  evaluateJv(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') tenderId: string,
    @Body() dto: EvaluateJvDto,
  ) {
    return this.tenderService.evaluateJv(tenantId, tenderId, dto.partners);
  }

  // Best JV partner finder (within the workspace)
  @Get(':id/jv-partners/:companyId')
  jvPartners(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') tenderId: string,
    @Param('companyId') companyId: string,
  ) {
    return this.tenderService.jvPartners(tenantId, tenderId, companyId);
  }

  @Get(':id/qualifications')
  getQualifications(@CurrentUser('tenantId') tenantId: string, @Param('id') tenderId: string) {
    return this.tenderService.getQualifications(tenantId, tenderId);
  }
}
