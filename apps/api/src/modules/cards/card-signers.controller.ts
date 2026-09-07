import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { CardSignersService } from './card-signers.service';
import { CreateCardSignerDto, UpdateCardSignerDto } from './cards.dto';

/* NGƯỜI KÝ THẺ MỘ — danh mục THEO NGHĨA TRANG (anh Bách chốt 05/09/2026).
 *
 * HAI mã quyền, không một:
 *   `cemetery.card_signer.view`  (S1) — ĐỌC danh sách. Ai cấp thẻ cũng cần, vì ô chọn người
 *                                        ký nằm ngay trên màn hình cấp thẻ.
 *   `config.card_signer.update`  (S3) — MỞ và SỬA danh mục. Một dòng mở ở đây in lên thẻ
 *                                        thật, nên nó là việc của ghế quản trị.
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

  /* CẢ BA route đều truyền người gọi xuống và service bó phạm vi thật.
   *
   * Tới 03/09/2026 `list` nằm trong sổ miễn trừ `NO_RECORD_SCOPE` với lý do "bảng không có
   * companyId nên không có bản ghi đích để bó". Lý do đó HẾT ĐÚNG từ 05/09: bảng có
   * `cemeteryId`. Dòng miễn trừ đã được gỡ khỏi ratchet — một dòng miễn trừ sống lâu hơn lý
   * do sinh ra nó là một cái lỗ, và nó im lặng nên không ai phát hiện. */
  @Get()
  @RequirePermission('cemetery.card_signer.view')
  @ApiQuery({ name: 'cemeteryId', required: false, description: 'Lọc theo nghĩa trang' })
  list(@Req() req: Request, @Query('cemeteryId') cemeteryId?: string) {
    return this.svc.list(this.caller(req), cemeteryId);
  }

  @Post()
  @RequirePermission('config.card_signer.update')
  create(@Body() dto: CreateCardSignerDto, @Req() req: Request) {
    return this.svc.create(dto, this.caller(req));
  }

  @Patch(':id')
  @RequirePermission('config.card_signer.update')
  update(@Param('id') id: string, @Body() dto: UpdateCardSignerDto, @Req() req: Request) {
    return this.svc.update(id, dto, this.caller(req));
  }

  /* Đặt tên `caller` chứ không `actorId` là CÓ Ý: ratchet tầng route cố tình không tin một
   * helper tên `actor*`, vì đó đúng là hình dạng của lớp lỗi nó sinh ra để bắt — controller
   * chỉ móc ra userId rồi tưởng như thế là đã truyền người gọi.
   *
   * `caller.permission` do `PermissionGuard` đặt từ `@RequirePermission`, KHÔNG gõ tay ở
   * đây: phạm vi tính theo TỪNG MÃ QUYỀN, không theo mức rộng nhất của người gọi. */
  private caller(req: Request): Caller {
    return callerOf(req);
  }
}
