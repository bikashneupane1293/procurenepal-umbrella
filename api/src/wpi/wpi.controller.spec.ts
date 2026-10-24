import { Test, TestingModule } from '@nestjs/testing';
import { WpiController } from './wpi.controller';

describe('WpiController', () => {
  let controller: WpiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WpiController],
    }).compile();

    controller = module.get<WpiController>(WpiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
