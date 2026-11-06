import { Test, TestingModule } from '@nestjs/testing';
import { TurnoverController } from './turnover.controller';
import { TurnoverService } from './turnover.service';

describe('TurnoverController', () => {
  let controller: TurnoverController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TurnoverController],
      providers: [{ provide: TurnoverService, useValue: {} }],
    }).compile();

    controller = module.get<TurnoverController>(TurnoverController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
