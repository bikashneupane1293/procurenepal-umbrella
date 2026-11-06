import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessService } from './access.service';
import { AccessController } from './access.controller';
import { ModuleGuard } from './module.guard';

// Global so any controller can use ModuleGuard without importing this module
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AccessController],
  providers: [AccessService, ModuleGuard],
  exports: [AccessService, ModuleGuard],
})
export class AccessModule {}
