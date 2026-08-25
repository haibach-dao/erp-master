import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';
import { PermissionsService } from './permissions.service';
import { ScopeService } from './scope.service';
import { PermissionGuard } from './permission.guard';
import { AuthzAdminController } from './authz-admin.controller';
import { AuthzAdminService } from './authz-admin.service';
import { AuthzMatrixController } from './authz-matrix.controller';
import { AuthzMatrixService } from './authz-matrix.service';
import { AccessRulesController } from './access-rules.controller';
import { AccessRulesService } from './access-rules.service';
import { AuthModule } from '../iam/auth.module';

// Provides the pure policy evaluator + DB-backed permission loading and the route guard.
@Global()
@Module({
  imports: [AuthModule], // for JwtAuthGuard -> AuthService
  controllers: [AuthzAdminController, AuthzMatrixController, AccessRulesController],
  providers: [
    PolicyEvaluator,
    PermissionsService,
    ScopeService,
    PermissionGuard,
    AuthzAdminService,
    AuthzMatrixService,
    AccessRulesService,
  ],
  exports: [PolicyEvaluator, PermissionsService, ScopeService, PermissionGuard],
})
export class AuthorizationModule {}
