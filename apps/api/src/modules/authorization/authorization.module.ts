import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';
import { PermissionsService } from './permissions.service';
import { ScopeService } from './scope.service';
import { PermissionGuard } from './permission.guard';
import { AuthzAdminController } from './authz-admin.controller';
import { AuthzAdminService } from './authz-admin.service';
import { AuthModule } from '../iam/auth.module';

// Provides the pure policy evaluator + DB-backed permission loading and the route guard.
@Global()
@Module({
  imports: [AuthModule], // for JwtAuthGuard -> AuthService
  controllers: [AuthzAdminController],
  providers: [
    PolicyEvaluator,
    PermissionsService,
    ScopeService,
    PermissionGuard,
    AuthzAdminService,
  ],
  exports: [PolicyEvaluator, PermissionsService, ScopeService, PermissionGuard],
})
export class AuthorizationModule {}
