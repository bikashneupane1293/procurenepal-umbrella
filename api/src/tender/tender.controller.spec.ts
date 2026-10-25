import { Test, TestingModule } from '@nestjs/testing';
import { TenderController } from './tender.controller';

describe('TenderController', () => {
  let controller: TenderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenderController],
    }).compile();

    controller = module.get<TenderController>(TenderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
