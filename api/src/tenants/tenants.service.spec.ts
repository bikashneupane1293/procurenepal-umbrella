import { Test, TestingModule } from '@nestjs/testing';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TenantsService', () => {
  let service: TenantsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantsService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
