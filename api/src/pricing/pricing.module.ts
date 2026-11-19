import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';

// Global so AccessService (plan default modules) and TenantsService (quotes) can use it.
@Global()
@Module({
  imports: [PrismaModule],
  providers: [PricingService],
  controllers: [PricingController],
  exports: [PricingService],
})
export class PricingModule {}
