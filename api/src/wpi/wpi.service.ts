import { Injectable } from '@nestjs/common';

@Injectable()
export class WpiService {
  // Fixed TypeScript type by adding : Record<string, number>
  private readonly wpiData: Record<string, number> = {
    '2081/82': 156.80,
    '2080/81': 150.70,
    '2079/80': 145.10,
    '2078/79': 133.70,
    '2077/78': 122.20,
    '2076/77': 113.50,
    '2075/76': 106.20,
    '2074/75': 100.00,
    '2073/74': 98.30,
  };

  getCurrentWpi(): number {
    return this.wpiData['2081/82'];
  }

  getWpiForYear(fiscalYear: string): number {
    return this.wpiData[fiscalYear] || 0;
  }

  calculateAdjustment(historicalAmount: number, historicalYear: string): number {
    const histWpi = this.getWpiForYear(historicalYear);
    if (histWpi === 0) return 0;

    const currentWpi = this.getCurrentWpi();
    const multiplier = currentWpi / histWpi;

    return historicalAmount * multiplier;
  }
}
