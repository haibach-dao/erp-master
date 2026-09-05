import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { UsersService } from './users.service';

/* DANH BẠ NHÂN VIÊN — mở 05/09/2026 cùng luật "người ký thẻ mộ là người quản lý nghĩa trang".
 *
 * Mã `iam.user.view` (S3) ĐÃ có trong danh mục từ đầu và đã cấp cho 4 vai, nhưng cho tới hôm
 * nay KHÔNG route nào tiêu thụ nó — quyền đã duyệt mà cửa chưa mở. Nên route này KHÔNG cần
 * migration danh mục quyền, và cũng không nới quyền cho ai: nó chỉ dùng đúng thứ đã cấp.
 *
 * Hệ quả thấy được ngay: hai màn hình quản trị đang bắt người dùng GÕ TAY ULID
 * (`organization/scope`, `organization/assignments`, placeholder "ULID của người dùng") vì
 * không có đường nào liệt kê người. Đây là đường đó.
 */
@ApiTags('iam')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('iam/users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  /* KHÔNG truyền người gọi xuống, và ở đây điều đó ĐÚNG: `iam.users` không có `companyId`
   * cũng không có `cemeteryId` — nhân viên là dữ liệu toàn hệ, cùng loại với danh mục VAI
   * (`authz-matrix.controller.ts:listRoles`, đã nằm trong sổ `NO_RECORD_SCOPE` từ trước).
   * Rào ở đây là mã quyền S3, không phải phạm vi. Đã ghi vào sổ kèm lý do chứ không để lưới
   * tự im.
   *
   * Lưu ý: đây là lý do THẬT, khác hẳn dòng miễn trừ của `card-signers` vừa bị gỡ cùng ngày —
   * dòng kia sai vì bảng đã mọc ra `cemeteryId`, còn bảng này thì chưa từng có trục nào.
   */
  @Get()
  @RequirePermission('iam.user.view')
  @ApiQuery({ name: 'roleCode', required: false, description: 'Chỉ người đang giữ vai này' })
  @ApiQuery({
    name: 'cemeteryId',
    required: false,
    description: 'Chỉ người đang được phân công nghĩa trang này',
  })
  list(@Query('roleCode') roleCode?: string, @Query('cemeteryId') cemeteryId?: string) {
    return this.svc.list({ roleCode, cemeteryId });
  }
}
