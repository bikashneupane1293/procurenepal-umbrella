import { Test, TestingModule } from '@nestjs/testing';
import { TenderService } from './tender.service';
import { PrismaService } from '../prisma/prisma.service';
import { QualificationService } from '../qualification/qualification.service';

describe('TenderService', () => {
  let service: TenderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenderService, { provide: PrismaService, useValue: {} }, { provide: QualificationService, useValue: {} }],
    }).compile();

    service = module.get<TenderService>(TenderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
