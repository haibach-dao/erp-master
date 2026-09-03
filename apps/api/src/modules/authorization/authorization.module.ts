import { Global, Module } from '@nestjs/common';
import { PolicyEvaluator } from './policy-evaluator';
import { PermissionsService } from './permissions.service';
import { ScopeService } from './scope.service';
import { PermissionGuard } from './permission.guard';
import { CatalogSentryService } from './catalog-sentry.service';

/* Provides the pure policy evaluator + DB-backed permission loading and the route guard.
 *
 * KHÔNG có `imports` và KHÔNG có `controllers` — CỐ Ý. Module này là @Global và
 * `AuthService` phụ thuộc vào `PermissionsService` của nó, nên import bất cứ thứ gì mà
 * chuỗi phụ thuộc dẫn về `AuthModule` sẽ tạo vòng (đã xảy ra một lần: xem
 * `authz-admin.module.ts`). Controller quản trị nằm ở `AuthzAdminModule`.
 */
/* `CatalogSentryService` ở đây chứ không ở một module riêng: nó chỉ tiêm `PrismaService`, mà
 * `PrismaModule` là @Global — nên không cần thêm `imports` nào và không dựng ra vòng phụ thuộc
 * mà chú thích trên vừa cảnh báo. Nó được EXPORT để `HealthController` đọc được bản tóm tắt. */
@Global()
@Module({
  providers: [
    PolicyEvaluator,
    PermissionsService,
    ScopeService,
    PermissionGuard,
    CatalogSentryService,
  ],
  exports: [
    PolicyEvaluator,
    PermissionsService,
    ScopeService,
    PermissionGuard,
    CatalogSentryService,
  ],
})
export class AuthorizationModule {}
