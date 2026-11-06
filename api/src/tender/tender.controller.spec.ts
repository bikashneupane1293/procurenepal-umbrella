import { Test, TestingModule } from '@nestjs/testing';
import { TenderController } from './tender.controller';
import { TenderService } from './tender.service';

describe('TenderController', () => {
  let controller: TenderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenderController],
      providers: [{ provide: TenderService, useValue: {} }],
    }).compile();

    controller = module.get<TenderController>(TenderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
