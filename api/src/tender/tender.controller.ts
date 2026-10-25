import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { TenderService } from './tender.service';
import { CreateTenderDto } from './dto/create-tender.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('tenders')
@UseGuards(JwtAuthGuard)
export class TenderController {
  constructor(private readonly tenderService: TenderService) {}

  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateTenderDto,
  ) {
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

  @Post(':id/evaluate/:companyId')
  evaluate(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') tenderId: string,
    @Param('companyId') companyId: string,
  ) {
    return this.tenderService.evaluateAndPersist(tenantId, tenderId, companyId);
  }

  @Get(':id/qualifications')
  getQualifications(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') tenderId: string,
  ) {
    return this.tenderService.getQualifications(tenantId, tenderId);
  }
}
