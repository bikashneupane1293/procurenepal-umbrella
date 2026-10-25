import { Module } from '@nestjs/common';
import { TenderService } from './tender.service';
import { TenderController } from './tender.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { QualificationModule } from '../qualification/qualification.module';

@Module({
  imports: [PrismaModule, QualificationModule],
  controllers: [TenderController],
  providers: [TenderService],
  exports: [TenderService],
})
export class TenderModule {}
