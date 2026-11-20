import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';

// Global so AuthService (Google sign-up / sign-up with Org ID) can use StaffService.
@Global()
@Module({ imports: [PrismaModule], providers: [StaffService], controllers: [StaffController], exports: [StaffService] })
export class StaffModule {}
