import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CertificateService } from './certificate.service';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller()
@UseGuards(JwtAuthGuard)
export class CertificateController {
  constructor(private readonly certificateService: CertificateService) {}

  @Post('companies/:companyId/certificates')
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Param('companyId') companyId: string,
    @Body() dto: CreateCertificateDto,
  ) {
    return this.certificateService.create(tenantId, companyId, dto);
  }

  @Get('certificates')
  findAllAll(@CurrentUser('tenantId') tenantId: string) {
    return this.certificateService.findAll(tenantId);
  }

  @Get('companies/:companyId/certificates')
  findAllForCompany(
    @CurrentUser('tenantId') tenantId: string,
    @Param('companyId') companyId: string,
  ) {
    return this.certificateService.findAll(tenantId, companyId);
  }

  @Get('certificates/:id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.certificateService.findOne(tenantId, id);
  }

  @Delete('certificates/:id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.certificateService.remove(tenantId, id);
  }
}
