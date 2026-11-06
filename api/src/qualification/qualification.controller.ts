import { Controller, Post, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { EvaluateQualificationDto, ReplaceTurnoversDto } from './dto/evaluate-qualification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ModuleGuard, RequireModule } from '../access/module.guard';

@Controller()
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('bolpatra')
export class QualificationController {
  constructor(private readonly qualificationService: QualificationService) {}

  // Quick check — a saved tender (tenderId) or ad-hoc requirements
  @Post('qualification/evaluate')
  evaluate(@CurrentUser('tenantId') tenantId: string, @Body() dto: EvaluateQualificationDto) {
    return this.qualificationService.evaluate(tenantId, dto);
  }

  // The rule sets (default PPMO values) the engine knows
  @Get('qualification/rules')
  rules() {
    return this.qualificationService.rules();
  }

  // Audited annual construction turnover per fiscal year
  @Get('companies/:companyId/turnovers')
  listTurnovers(@CurrentUser('tenantId') tenantId: string, @Param('companyId') companyId: string) {
    return this.qualificationService.listTurnovers(tenantId, companyId);
  }

  @Put('companies/:companyId/turnovers')
  replaceTurnovers(
    @CurrentUser('tenantId') tenantId: string,
    @Param('companyId') companyId: string,
    @Body() dto: ReplaceTurnoversDto,
  ) {
    return this.qualificationService.replaceTurnovers(tenantId, companyId, dto);
  }
}
