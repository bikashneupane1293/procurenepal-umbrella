import { Test, TestingModule } from '@nestjs/testing';
import { TurnoverService } from './turnover.service';
import { WpiService } from '../wpi/wpi.service';

describe('TurnoverService', () => {
  let service: TurnoverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TurnoverService, WpiService],
    }).compile();

    service = module.get<TurnoverService>(TurnoverService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('keeps the Phase 5.3 result (83.9M × 30% JV in 2078/79 → 29,518,157)', () => {
    const r = service.calculateAact({ certificates: [{ amount: 83_898_334 * 0.3, fiscalYear: '2078/79' }] });
    expect(Math.round(r.averageAnnualTurnover)).toBe(29_518_157);
  });
});
