import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { CardSignersService } from './card-signers.service';
import { CreateCardSignerDto, UpdateCardSignerDto } from './cards.dto';

/* NGƯỜI KÝ THẺ MỘ — danh mục toàn hệ (anh Bách chốt 03/09/2026).
 *
 * HAI mã quyền, không một:
 *   `cemetery.card_signer.view`  (S1) — ĐỌC danh sách. Ai cấp thẻ cũng cần, vì ô chọn người
 *                                        ký nằm ngay trên màn hình cấp thẻ.
 *   `config.card_signer.update`  (S3) — MỞ và SỬA danh mục. Một dòng mở ở đây in lên thẻ của
 *                                        mọi công ty, nên nó là việc của ghế quản trị.
 *
 * Không dùng lại `cemetery.card.view` cho đường đọc: gắn chức năng mới vào một mã đã cấp là
 * cho một vai thêm năng lực mà chưa ai duyệt lần nào — cùng lý do đã ghi ở
 * `permission-catalog.ts` chỗ `config.plot_tag.update`.
 */
@ApiTags('card-signers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery/card-signers')
export class CardSignersController {
  constructor(private readonly svc: CardSignersService) {}

  /* Không truyền người gọi xuống service, và đó là ĐÚNG: bảng không có `companyId` nên
   * không có bản ghi đích nào để bó phạm vi. Đã ghi vào sổ `NO_RECORD_SCOPE` của ratchet
   * tầng route kèm lý do, chứ không để lưới tự im. */
  @Get()
  @RequirePermission('cemetery.card_signer.view')
  list() {
    return this.svc.list();
  }

  @Post()
  @RequirePermission('config.card_signer.update')
  create(@Body() dto: CreateCardSignerDto, @Req() req: Request) {
    return this.svc.create(dto, this.caller(req).userId);
  }

  @Patch(':id')
  @RequirePermission('config.card_signer.update')
  update(@Param('id') id: string, @Body() dto: UpdateCardSignerDto, @Req() req: Request) {
    return this.svc.update(id, dto, this.caller(req).userId);
  }

  /* Cùng nếp với `tags.controller.ts`. Chỉ `.userId` được truyền xuống, và chỉ để ghi
   * `createdBy` cùng người thao tác vào nhật ký — KHÔNG phải để bó phạm vi; danh mục toàn hệ
   * thì không có phạm vi để bó.
   *
   * Đặt tên `caller` chứ không `actorId` là CÓ Ý: ratchet tầng route cố tình không tin một
   * helper tên `actor*`, vì đó đúng là hình dạng của lớp lỗi nó sinh ra để bắt — controller
   * chỉ móc ra userId rồi tưởng như thế là đã truyền người gọi. */
  private caller(req: Request): Caller {
    return callerOf(req);
  }
}
