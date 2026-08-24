import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';
import { PermissionsService } from './permissions.service';
import { PermissionGuard } from './permission.guard';

// Provides the pure policy evaluator + DB-backed permission loading and the route guard.
@Global()
@Module({
  providers: [PolicyEvaluator, PermissionsService, PermissionGuard],
  exports: [PolicyEvaluator, PermissionsService, PermissionGuard],
})
export class AuthorizationModule {}
