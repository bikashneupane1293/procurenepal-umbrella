import { Module } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { QualificationController } from './qualification.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TurnoverModule } from '../turnover/turnover.module';
import { WpiModule } from '../wpi/wpi.module';

@Module({
  imports: [PrismaModule, TurnoverModule, WpiModule],
  controllers: [QualificationController],
  providers: [QualificationService],
  exports: [QualificationService],
})
export class QualificationModule {}
