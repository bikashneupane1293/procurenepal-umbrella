import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { ProjectModule } from '../project/project.module';
import { BidService } from './bid.service';
import { BidReportService } from './bid-report.service';
import { BidController } from './bid.controller';

@Module({
  imports: [PrismaModule, BankModule, ProjectModule],
  controllers: [BidController],
  providers: [BidService, BidReportService],
  exports: [BidService],
})
export class BidModule {}
