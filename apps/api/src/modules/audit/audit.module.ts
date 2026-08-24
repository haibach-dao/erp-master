import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [AuthModule], // for JwtAuthGuard -> AuthService
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService],
})
export class AuditModule {}
