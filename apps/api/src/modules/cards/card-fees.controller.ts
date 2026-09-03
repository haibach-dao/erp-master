import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { CardFeesService } from './card-fees.service';
import { CreateCardFeeScheduleDto } from './cards.dto';

/* Biểu phí cấp thẻ mộ.
 *
 * Không có route SỬA và không có route XOÁ — bảng append-only, trigger ở CSDL chặn cả hai.
 * Đổi giá là ban hành một dòng mới với `effectiveFrom` mới; dòng cũ ở lại để thẻ cấp năm
 * ngoái vẫn đọc ra đúng giá năm ngoái, khớp với tờ giấy khách đang cầm.
 *
 * Mọi route ở đây đã gate bằng chính `cemetery.card_fee.view` / `.set_price`, nên KHÔNG cần
 * `@MaskUnless` — người không được xem tiền thì không vào được route, chứ không phải vào rồi
 * nhận số bị che.
 */
@ApiTags('grave-card-fees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery/card-fees')
export class CardFeesController {
  constructor(private readonly svc: CardFeesService) {}

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  @Get()
  @RequirePermission('cemetery.card_fee.view')
  list(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.svc.listSchedules(companyId, this.caller(req));
  }

  /* Công ty nào còn THIẾU biểu phí, kèm số khách đang chờ.
   *
   * Đặt TRƯỚC `charges/:cardPrintLogId` là chủ ý về thứ tự khớp route: Nest khớp theo thứ tự
   * khai, nên một route tĩnh phải đứng trên route có tham số cùng cấp. Ở đây hai đường không
   * đụng nhau (`coverage` vs `charges/...`), nhưng giữ nếp để lần sau thêm route tĩnh không
   * phải nhớ lại. */
  @Get('coverage')
  @RequirePermission('cemetery.card_fee.view')
  coverage(@Req() req: Request) {
    return this.svc.listCoverage(this.caller(req));
  }

  /* Ban hành — tách khỏi mã xem, và tách khỏi mã cấp thẻ. Người đặt giá không phải người
   * thu tiền: test tách nhiệm vụ ở `authz-invariants.spec.ts` canh đúng cặp này. */
  @Post()
  @RequirePermission('cemetery.card_fee.set_price')
  create(@Body() dto: CreateCardFeeScheduleDto, @Req() req: Request) {
    return this.svc.createSchedule(dto, this.caller(req));
  }

  /** Dòng phí của một lần cấp — để đối chứng với tờ giấy khách cầm. */
  @Get('charges/:cardPrintLogId')
  @RequirePermission('cemetery.card_fee.view')
  charges(@Param('cardPrintLogId') cardPrintLogId: string, @Req() req: Request) {
    return this.svc.listCharges(cardPrintLogId, this.caller(req));
  }
}
