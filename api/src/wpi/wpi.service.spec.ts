import { Test, TestingModule } from '@nestjs/testing';
import { WpiService } from './wpi.service';

describe('WpiService', () => {
  let service: WpiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WpiService],
    }).compile();

    service = module.get<WpiService>(WpiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
