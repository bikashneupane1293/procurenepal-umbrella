import { Test, TestingModule } from '@nestjs/testing';
import { QualificationController } from './qualification.controller';
import { QualificationService } from './qualification.service';

describe('QualificationController', () => {
  let controller: QualificationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QualificationController],
      providers: [{ provide: QualificationService, useValue: {} }],
    }).compile();

    controller = module.get<QualificationController>(QualificationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
