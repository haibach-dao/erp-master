import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { CardApprovalsService } from './card-approvals.service';
import { CardsService } from './cards.service';
import {
  DecideCardApprovalDto,
  SetCardApprovalRequiredDto,
  SubmitCardApprovalDto,
} from './cards.dto';

/* CỬA PHÊ DUYỆT IN THẺ MỘ — lát 1, anh Bách chốt 05/09/2026.
 *
 * HAI mã quyền, và chúng CỐ Ý tách nhau:
 *   `cemetery.card.submit`  (S2) — GỬI hồ sơ đi duyệt. Không tự nó gây hậu quả nào, nên S2.
 *   `cemetery.card.approve` (S3) — QUYẾT. Đây mới là chỗ mở đường cho việc thu tiền.
 *
 * Luật "không tự duyệt" KHÔNG ép ở đây và cũng không ép ở mức vai — nó ép ở MỨC BẢN GHI
 * (`card_issue_approvals_no_self_approve_check` + phép kiểm trong service). Lý do dài nằm ở
 * `permission-catalog.ts` chỗ khai hai mã: `QL_NGHIA_TRANG` vừa cấp thẻ vừa duyệt là chuyện
 * BÌNH THƯỜNG ở một nghĩa trang nhỏ, cái phải cấm là một NGƯỜI đi trọn cả hai đầu của CÙNG
 * MỘT hồ sơ.
 */
@ApiTags('card-approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery/card-approvals')
export class CardApprovalsController {
  constructor(
    private readonly approvals: CardApprovalsService,
    private readonly cards: CardsService,
  ) {}

  /* GỬI đi duyệt. Đi qua `CardsService` vì cần dựng thẻ và tra biểu phí — chiều phụ thuộc
   * cards → approvals, một hướng. */
  @Post('submit/:customerId')
  @RequirePermission('cemetery.card.submit')
  submit(
    @Param('customerId') customerId: string,
    @Body() dto: SubmitCardApprovalDto,
    @Req() req: Request,
  ) {
    return this.cards.submitForApproval(customerId, dto, this.caller(req));
  }

  /* HỘP PHÊ DUYỆT của chính người gọi. Không nhận tham số người dùng: hộp thư của người khác
   * không phải thứ mở bằng một tham số truy vấn. */
  @Get('inbox')
  @RequirePermission('cemetery.card.approve')
  inbox(@Req() req: Request) {
    return this.approvals.listInbox(this.caller(req));
  }

  /* Hồ sơ của MỘT khách — màn cấp thẻ đọc cái này để biết đang ở chặng nào.
   * Gate bằng `cemetery.card.submit`: người GỬI cần thấy hồ sơ mình đã gửi. */
  @Get()
  @RequirePermission('cemetery.card.submit')
  forCustomer(@Query('customerId') customerId: string, @Req() req: Request) {
    return this.approvals.listForCustomer(customerId, this.caller(req));
  }

  @Post(':id/decide')
  @RequirePermission('cemetery.card.approve')
  decide(@Param('id') id: string, @Body() dto: DecideCardApprovalDto, @Req() req: Request) {
    return this.approvals.decide(id, dto.decision, dto.note, this.caller(req));
  }

  /* HUỶ — của chính người gửi. Gate bằng `submit`, không phải `approve`: huỷ hồ sơ của mình là
   * việc của người gửi, không phải một quyết định.
   *
   * Đường này KHÔNG phải tiện ích. Hồ sơ chụp NGƯỜI, nên người ký bị ngừng dùng là mọi hồ sơ
   * đang chờ của họ thành hồ sơ chết; mà unique bộ phận chỉ cho MỘT hồ sơ chờ mỗi khách, nên
   * hồ sơ chết đó CHẶN LUÔN lần gửi mới. Đây là lối thoát duy nhất. */
  @Post(':id/cancel')
  @RequirePermission('cemetery.card.submit')
  cancel(@Param('id') id: string, @Req() req: Request) {
    return this.approvals.cancel(id, this.caller(req));
  }

  /* BẬT/TẮT cửa cho một công ty. Gate bằng `config.card_signer.update` — mã quản trị danh mục
   * thẻ mộ đã có sẵn, cùng ghế QT_NGHIEP_VU.
   *
   * KHÔNG đẻ thêm một mã quyền thứ ba cho một cái công tắc: mỗi mã mới là một dòng phải rà,
   * một migration, một ô trong ma trận. Việc này thuộc đúng ghế đang giữ cấu hình thẻ mộ. */
  @Post('settings')
  @RequirePermission('config.card_signer.update')
  setRequired(@Body() dto: SetCardApprovalRequiredDto, @Req() req: Request) {
    return this.approvals.setRequired(dto.companyId, dto.required, this.caller(req));
  }

  @Get('settings')
  @RequirePermission('cemetery.card.view')
  getSettings(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.approvals.getSettings(companyId, this.caller(req));
  }

  /* Đặt tên `caller` chứ không `actorId` là CÓ Ý: ratchet tầng route cố tình không tin một
   * helper tên `actor*`. `caller.permission` do `PermissionGuard` đặt từ `@RequirePermission`,
   * KHÔNG gõ tay — phạm vi tính theo TỪNG MÃ QUYỀN. */
  private caller(req: Request): Caller {
    return callerOf(req);
  }
}
