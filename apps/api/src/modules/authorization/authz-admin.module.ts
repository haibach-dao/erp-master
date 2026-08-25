import { Module } from '@nestjs/common';
import { AuthModule } from '../iam/auth.module';
import { AuthzAdminController } from './authz-admin.controller';
import { AuthzAdminService } from './authz-admin.service';
import { AuthzMatrixController } from './authz-matrix.controller';
import { AuthzMatrixService } from './authz-matrix.service';
import { AccessRulesController } from './access-rules.controller';
import { AccessRulesService } from './access-rules.service';

/* Bề mặt QUẢN TRỊ phân quyền — tách khỏi `AuthorizationModule` để cắt phụ thuộc vòng.
 *
 * `AuthorizationModule` là @Global và cung cấp `PermissionsService`, mà `AuthService`
 * (trong `AuthModule`) lại cần service đó. Nếu `AuthorizationModule` cũng import
 * `AuthModule` để controller quản trị dùng được `JwtAuthGuard` thì thành vòng:
 *
 *   AuthModule --cần PermissionsService--> AuthorizationModule --import--> AuthModule
 *
 * Nest gặp vòng thì KHÔNG báo lỗi rõ ràng — nó tiêm `undefined` cho một phụ thuộc nào đó
 * và ứng dụng chết ở một chỗ trông hoàn toàn không liên quan. Lần này nạn nhân là
 * `ConfigService` của `FilesService`.
 *
 * Cách cắt: controller nằm ở module riêng (không @Global, không ai import lại), nên chiều
 * phụ thuộc chỉ còn một hướng.
 */
@Module({
  imports: [AuthModule], // JwtAuthGuard -> AuthService
  controllers: [AuthzAdminController, AuthzMatrixController, AccessRulesController],
  providers: [AuthzAdminService, AuthzMatrixService, AccessRulesService],
})
export class AuthzAdminModule {}
