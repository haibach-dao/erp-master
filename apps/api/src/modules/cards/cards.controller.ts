import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { MaskUnless } from '../../common/masking/mask.decorator';
import { CardsService } from './cards.service';
import { IssueCardDto } from './cards.dto';

/* Che tiền phí ở MỨC CONTROLLER, không rải lên từng route.
 *
 * Khai một lần ở đây thì route thêm sau này được che sẵn; khai trên từng hàm là một danh
 * sách phải nhớ, và một danh sách phải nhớ là một danh sách sẽ thiếu.
 *
 * Mã quyền CHÉP từ `permission-catalog.ts`, không gõ tay: không test nào kiểm chuỗi trong
 * `@MaskUnless` (`masking-invariants.spec.ts` chỉ soi `SENSITIVE_FIELDS`), nên một mã gõ sai
 * ở đây che vĩnh viễn với MỌI người — kể cả ADMIN — mà không lỗi, không cảnh báo.
 *
 * `maskTree` đi vào cả mảng và object lồng nhau, nên ba trường này bắt được cả
 * `fee.totalAmount` lẫn từng `fee.lines[].feeAmount`.
 */
@ApiTags('grave-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@MaskUnless({ field: 'totalAmount', permission: 'cemetery.card_fee.view' })
@MaskUnless({ field: 'feeAmount', permission: 'cemetery.card_fee.view' })
@MaskUnless({ field: 'unitPrice', permission: 'cemetery.card_fee.view' })
@Controller('cemetery/cards')
export class CardsController {
  constructor(private readonly svc: CardsService) {}

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  /* Xem trước KHÔNG cấp số, nên gate bằng mã đọc. Đây là chỗ hệ cũ làm sai: bên đó mở
   * thẻ ra xem cũng là cấp thẻ, nên số lần cấp nhảy theo số lần liếc. */
  @Get(':customerId/preview')
  @RequirePermission('cemetery.card.view')
  preview(@Param('customerId') customerId: string, @Req() req: Request) {
    return this.svc.preview(customerId, this.caller(req));
  }

  @Post(':customerId/issue')
  @RequirePermission('cemetery.card.print')
  issue(@Param('customerId') customerId: string, @Body() dto: IssueCardDto, @Req() req: Request) {
    return this.svc.issue(customerId, dto, this.caller(req));
  }

  /* In lại gate bằng mã ĐỌC, không phải mã cấp: nó không sinh số mới. Bắt phải có quyền
   * cấp thẻ mới in lại được là buộc người ta đi cấp lần mới khi máy in kẹt. */
  @Get('reprint/:cardPrintLogId')
  @RequirePermission('cemetery.card.view')
  reprint(@Param('cardPrintLogId') cardPrintLogId: string, @Req() req: Request) {
    return this.svc.reprint(cardPrintLogId, this.caller(req));
  }

  @Get(':customerId/issuances')
  @RequirePermission('cemetery.card.view')
  issuances(@Param('customerId') customerId: string, @Req() req: Request) {
    return this.svc.listIssuances(customerId, this.caller(req));
  }
}
