import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { EvaluateQualificationDto } from './dto/evaluate-qualification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('qualification')
@UseGuards(JwtAuthGuard)
export class QualificationController {
  constructor(private readonly qualificationService: QualificationService) {}

  @Post('evaluate')
  evaluate(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: EvaluateQualificationDto,
  ) {
    return this.qualificationService.evaluate(tenantId, dto);
  }
}
