import { Test, TestingModule } from '@nestjs/testing';
import { ModuleGuard } from '../access/module.guard';
import { QualificationController } from './qualification.controller';
import { QualificationService } from './qualification.service';

describe('QualificationController', () => {
  let controller: QualificationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QualificationController],
      providers: [{ provide: QualificationService, useValue: {} }],
    })
      .overrideGuard(ModuleGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<QualificationController>(QualificationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
