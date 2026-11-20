import { Module } from '@nestjs/common';
import { TenderService } from './tender.service';
import { TenderController } from './tender.controller';
import { TenderRequirementsController } from './tender-requirements.controller';
import { TenderRequirementsService } from './tender-requirements.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QualificationModule } from '../qualification/qualification.module';

@Module({
  imports: [PrismaModule, QualificationModule],
  controllers: [TenderController, TenderRequirementsController],
  providers: [TenderService, TenderRequirementsService],
  exports: [TenderService],
})
export class TenderModule {}
