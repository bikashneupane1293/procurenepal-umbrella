import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { ProjectSyncService } from './project-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectSyncService],
  exports: [ProjectSyncService],
})
export class ProjectModule {}
