import { Module } from '@nestjs/common';
import { TurnoverService } from './turnover.service';
import { TurnoverController } from './turnover.controller';
import { WpiModule } from '../wpi/wpi.module';

@Module({
  imports: [WpiModule],
  controllers: [TurnoverController],
  providers: [TurnoverService],
  exports: [TurnoverService],
})
export class TurnoverModule {}
