import { Injectable } from '@nestjs/common';
import { WpiService } from '../wpi/wpi.service';
import { CalculateTurnoverDto } from './dto/calculate-turnover.dto';

@Injectable()
export class TurnoverService {
  constructor(private readonly wpiService: WpiService) {}

  calculateAact(dto: CalculateTurnoverDto) {
    const { certificates } = dto;

    // 1. Group by Fiscal Year
    const yearlySums: Record<string, number> = {};
    for (const cert of certificates) {
      yearlySums[cert.fiscalYear] = (yearlySums[cert.fiscalYear] || 0) + cert.amount;
    }

    // 2. Apply WPI Adjustment to each year
    const adjustedAmounts: number[] = [];
    const breakdown = [];

    for (const [year, sum] of Object.entries(yearlySums)) {
      const adjusted = this.wpiService.calculateAdjustment(sum, year);
      adjustedAmounts.push(adjusted);
      breakdown.push({
        fiscalYear: year,
        rawAmount: sum,
        wpiAdjustedAmount: adjusted,
      });
    }

    // 3. Sort descending to find Best 3 Years
    adjustedAmounts.sort((a, b) => b - a);

    // 4. Take the top 3
    const top3 = adjustedAmounts.slice(0, 3);

    // 5. Calculate Average
    const sumTop3 = top3.reduce((acc, val) => acc + val, 0);
    const aact = sumTop3 / (top3.length || 1);

    return {
      averageAnnualTurnover: aact,
      bestThreeYearsCount: top3.length,
      breakdown: breakdown,
    };
  }
}
