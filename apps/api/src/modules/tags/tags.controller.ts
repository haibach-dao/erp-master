import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { TagsService } from './tags.service';
import {
  AssignTagDto,
  CreateCustomerTagTypeDto,
  CreateGravePlotTagTypeDto,
  RemoveTagDto,
  UpdateTagTypeDto,
} from './tags.dto';

/* THẺ NHÃN — hai nhánh tách hẳn, đúng như hai danh mục ở tầng dữ liệu.
 *
 * Bốn route danh mục KHÔNG truyền `Caller` xuống service, và đó là chủ ý: danh mục là dữ
 * liệu TOÀN HỆ (hai bảng danh mục không có `companyId`), nên không có bản ghi đích nào để bó
 * phạm vi — y như danh mục vai và danh mục mã quyền. Rào ở đó là mã quyền `config.*.update`
 * (S3). Hai route ĐỌC danh mục được khai vào `NO_RECORD_SCOPE` kèm đúng lý do này.
 *
 * Ngược lại, mọi route GẮN/GỠ đều truyền `Caller` và service bó phạm vi thật.
 *
 * Không có route XOÁ ở đâu cả:
 *   - danh mục: NGỪNG DÙNG (`status: Retired`) — thẻ đã gắn vẫn phải đọc được tên
 *   - thẻ đã gắn: GỠ (`removedAt`) — anh Bách chốt "lưu vết"
 *
 * Gỡ đi qua POST `/remove` chứ không `DELETE`: đây không phải xoá một tài nguyên mà là ghi
 * thêm một sự kiện "đã gỡ, bởi ai, vì sao" — và nó mang `body` chứa lý do.
 */
@ApiTags('tags')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery/tags')
export class TagsController {
  constructor(private readonly svc: TagsService) {}

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  /* ---- Danh mục thẻ MỘ (toàn hệ) ---- */

  @Get('plot-types')
  @RequirePermission('cemetery.plot_tag.view')
  listPlotTagTypes() {
    return this.svc.listPlotTagTypes();
  }

  @Post('plot-types')
  @RequirePermission('config.plot_tag.update')
  createPlotTagType(@Body() dto: CreateGravePlotTagTypeDto, @Req() req: Request) {
    return this.svc.createPlotTagType(dto, this.caller(req).userId);
  }

  @Patch('plot-types/:id')
  @RequirePermission('config.plot_tag.update')
  updatePlotTagType(@Param('id') id: string, @Body() dto: UpdateTagTypeDto, @Req() req: Request) {
    return this.svc.updatePlotTagType(id, dto, this.caller(req).userId);
  }

  /* ---- Danh mục thẻ KHÁCH (toàn hệ) ---- */

  @Get('customer-types')
  @RequirePermission('crm.customer_tag.view')
  listCustomerTagTypes() {
    return this.svc.listCustomerTagTypes();
  }

  /* Mã quyền KHÁC hẳn nhánh thẻ mộ, và đó là nửa quan trọng của việc tách hai danh mục: mở
   * một thẻ MỘ mới ("cần sửa bia") là việc vận hành thường ngày; mở một thẻ KHÁCH mới là lúc
   * có thể lọt vào hệ một câu nói về con người. Hai mức rủi ro thì cấp cho hai nhóm người. */
  @Post('customer-types')
  @RequirePermission('config.customer_tag.update')
  createCustomerTagType(@Body() dto: CreateCustomerTagTypeDto, @Req() req: Request) {
    return this.svc.createCustomerTagType(dto, this.caller(req).userId);
  }

  @Patch('customer-types/:id')
  @RequirePermission('config.customer_tag.update')
  updateCustomerTagType(
    @Param('id') id: string,
    @Body() dto: UpdateTagTypeDto,
    @Req() req: Request,
  ) {
    return this.svc.updateCustomerTagType(id, dto, this.caller(req).userId);
  }

  /* ---- Gắn / gỡ thẻ MỘ ---- */

  @Get('plots/:gravePlotId')
  @RequirePermission('cemetery.plot_tag.view')
  listPlotTags(@Param('gravePlotId') gravePlotId: string, @Req() req: Request) {
    return this.svc.listPlotTags(gravePlotId, this.caller(req));
  }

  @Post('plots/:gravePlotId')
  @RequirePermission('cemetery.plot_tag.assign')
  assignPlotTag(
    @Param('gravePlotId') gravePlotId: string,
    @Body() dto: AssignTagDto,
    @Req() req: Request,
  ) {
    return this.svc.assignPlotTag(gravePlotId, dto, this.caller(req));
  }

  @Post('plots/:gravePlotId/:tagTypeId/remove')
  @RequirePermission('cemetery.plot_tag.assign')
  removePlotTag(
    @Param('gravePlotId') gravePlotId: string,
    @Param('tagTypeId') tagTypeId: string,
    @Body() dto: RemoveTagDto,
    @Req() req: Request,
  ) {
    return this.svc.removePlotTag(gravePlotId, tagTypeId, dto, this.caller(req));
  }

  /* ---- Gắn / gỡ thẻ KHÁCH ---- */

  @Get('customers/:customerId')
  @RequirePermission('crm.customer_tag.view')
  listCustomerTags(@Param('customerId') customerId: string, @Req() req: Request) {
    return this.svc.listCustomerTags(customerId, this.caller(req));
  }

  @Post('customers/:customerId')
  @RequirePermission('crm.customer_tag.assign')
  assignCustomerTag(
    @Param('customerId') customerId: string,
    @Body() dto: AssignTagDto,
    @Req() req: Request,
  ) {
    return this.svc.assignCustomerTag(customerId, dto, this.caller(req));
  }

  @Post('customers/:customerId/:tagTypeId/remove')
  @RequirePermission('crm.customer_tag.assign')
  removeCustomerTag(
    @Param('customerId') customerId: string,
    @Param('tagTypeId') tagTypeId: string,
    @Body() dto: RemoveTagDto,
    @Req() req: Request,
  ) {
    return this.svc.removeCustomerTag(customerId, tagTypeId, dto, this.caller(req));
  }
}
