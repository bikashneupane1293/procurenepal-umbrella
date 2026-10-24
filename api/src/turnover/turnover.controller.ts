import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TurnoverService } from './turnover.service';
import { CalculateTurnoverDto } from './dto/calculate-turnover.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('turnover')
@UseGuards(JwtAuthGuard)
export class TurnoverController {
  constructor(private readonly turnoverService: TurnoverService) {}

  @Post('calculate')
  calculate(@Body() dto: CalculateTurnoverDto) {
    return this.turnoverService.calculateAact(dto);
  }
}
