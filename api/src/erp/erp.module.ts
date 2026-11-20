import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ErpController } from './erp.controller';
import { ErpService } from './erp.service';
import { ErpFlowService } from './erp-flow.service';

@Module({ imports: [PrismaModule], controllers: [ErpController], providers: [ErpService, ErpFlowService], exports: [ErpService] })
export class ErpModule {}
