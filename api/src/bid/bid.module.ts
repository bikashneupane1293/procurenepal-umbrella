import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BidService } from './bid.service';
import { BidReportService } from './bid-report.service';
import { BidController } from './bid.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BidController],
  providers: [BidService, BidReportService],
  exports: [BidService],
})
export class BidModule {}
