import { Module } from '@nestjs/common';
import { QualificationService } from './qualification.service';
import { QualificationController } from './qualification.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TurnoverModule } from '../turnover/turnover.module';

@Module({
  imports: [PrismaModule, TurnoverModule],
  controllers: [QualificationController],
  providers: [QualificationService],
  exports: [QualificationService],
})
export class QualificationModule {}
