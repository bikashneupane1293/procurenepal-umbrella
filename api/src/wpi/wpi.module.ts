import { Module } from '@nestjs/common';
import { WpiService } from './wpi.service';
import { WpiController } from './wpi.controller';

@Module({
  controllers: [WpiController],
  providers: [WpiService],
  exports: [WpiService],
})
export class WpiModule {}
