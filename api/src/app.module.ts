import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { FeatureFlagModule } from './feature-flag/feature-flag.module';
import { CompanyModule } from './company/company.module';
import { CertificateModule } from './certificate/certificate.module';
import { WpiModule } from './wpi/wpi.module';
import { TurnoverModule } from './turnover/turnover.module';
import { QualificationModule } from './qualification/qualification.module';
import { TenderModule } from './tender/tender.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    FeatureFlagModule,
    CompanyModule,
    CertificateModule,
    WpiModule,
    TurnoverModule,
    QualificationModule,
    TenderModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
