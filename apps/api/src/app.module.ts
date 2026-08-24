import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { AuthModule } from './modules/iam/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { CemeteryModule } from './modules/cemetery/cemetery.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
    AuditModule,
    OutboxModule,
    AuthModule,
    AuthorizationModule,
    CemeteryModule,
    HealthModule,
  ],
})
export class AppModule {}
