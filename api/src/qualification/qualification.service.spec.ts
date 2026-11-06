import { Test, TestingModule } from '@nestjs/testing';
import { QualificationService } from './qualification.service';
import { PrismaService } from '../prisma/prisma.service';
import { WpiService } from '../wpi/wpi.service';

describe('QualificationService', () => {
  let service: QualificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QualificationService, { provide: PrismaService, useValue: {} }, WpiService],
    }).compile();

    service = module.get<QualificationService>(QualificationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
