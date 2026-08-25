import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';
import { PermissionsService } from './permissions.service';
import { ScopeService } from './scope.service';
import { PermissionGuard } from './permission.guard';

// Provides the pure policy evaluator + DB-backed permission loading and the route guard.
@Global()
@Module({
  providers: [PolicyEvaluator, PermissionsService, ScopeService, PermissionGuard],
  exports: [PolicyEvaluator, PermissionsService, ScopeService, PermissionGuard],
})
export class AuthorizationModule {}
