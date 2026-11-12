import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';
import { GuaranteeService } from './guarantee.service';
import { GuaranteeSyncService } from './guarantee-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [BankController],
  providers: [BankService, GuaranteeService, GuaranteeSyncService],
  exports: [GuaranteeSyncService],
})
export class BankModule {}
