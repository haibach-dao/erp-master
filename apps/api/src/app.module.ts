import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { PiiModule } from './common/pii/pii.module';
import { AuditModule } from './modules/audit/audit.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { AuthModule } from './modules/iam/auth.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { CemeteryModule } from './modules/cemetery/cemetery.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HoldsModule } from './modules/holds/holds.module';
import { FilesModule } from './modules/files/files.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { BurialsModule } from './modules/burials/burials.module';
import { ServicesModule } from './modules/services/services.module';
import { HealthModule } from './health/health.module';

// Rate limit for credential endpoints. Named 'auth' and applied only where
// @UseGuards(ThrottlerGuard) is declared (AuthController) — no global guard, so
// business endpoints keep their current behaviour. In-memory storage is per
// instance; move to the Redis storage before running more than one API replica.
const AUTH_RATE_LIMIT = {
  name: 'auth',
  ttl: 60_000, // 1 phút
  limit: 10, // 10 lần thử / IP / phút
  blockDuration: 300_000, // vượt trần -> khoá 5 phút
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot([AUTH_RATE_LIMIT]),
    PrismaModule,
    PiiModule,
    AuditModule,
    OutboxModule,
    AuthModule,
    AuthorizationModule,
    CemeteryModule,
    CustomersModule,
    HoldsModule,
    FilesModule,
    ContractsModule,
    BurialsModule,
    ServicesModule,
    HealthModule,
  ],
})
export class AppModule {}
