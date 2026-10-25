import { Test, TestingModule } from '@nestjs/testing';
import { TenderService } from './tender.service';

describe('TenderService', () => {
  let service: TenderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenderService],
    }).compile();

    service = module.get<TenderService>(TenderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
