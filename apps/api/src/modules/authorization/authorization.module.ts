import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';
import { PermissionsService } from './permissions.service';
import { ScopeService } from './scope.service';
import { PermissionGuard } from './permission.guard';

/* Provides the pure policy evaluator + DB-backed permission loading and the route guard.
 *
 * KHÔNG có `imports` và KHÔNG có `controllers` — CỐ Ý. Module này là @Global và
 * `AuthService` phụ thuộc vào `PermissionsService` của nó, nên import bất cứ thứ gì mà
 * chuỗi phụ thuộc dẫn về `AuthModule` sẽ tạo vòng (đã xảy ra một lần: xem
 * `authz-admin.module.ts`). Controller quản trị nằm ở `AuthzAdminModule`.
 */
@Global()
@Module({
  providers: [PolicyEvaluator, PermissionsService, ScopeService, PermissionGuard],
  exports: [PolicyEvaluator, PermissionsService, ScopeService, PermissionGuard],
})
export class AuthorizationModule {}
