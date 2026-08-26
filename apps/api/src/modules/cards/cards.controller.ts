import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { CardsService } from './cards.service';
import { IssueCardDto } from './cards.dto';

@ApiTags('grave-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery/cards')
export class CardsController {
  constructor(private readonly svc: CardsService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  /* Xem trước KHÔNG cấp số, nên gate bằng mã đọc. Đây là chỗ hệ cũ làm sai: bên đó mở
   * thẻ ra xem cũng là cấp thẻ, nên số lần cấp nhảy theo số lần liếc. */
  @Get(':customerId/preview')
  @RequirePermission('cemetery.card.view')
  preview(@Param('customerId') customerId: string, @Req() req: Request) {
    return this.svc.preview(customerId, this.actor(req));
  }

  @Post(':customerId/issue')
  @RequirePermission('cemetery.card.print')
  issue(@Param('customerId') customerId: string, @Body() dto: IssueCardDto, @Req() req: Request) {
    return this.svc.issue(customerId, dto, this.actor(req));
  }

  /* In lại gate bằng mã ĐỌC, không phải mã cấp: nó không sinh số mới. Bắt phải có quyền
   * cấp thẻ mới in lại được là buộc người ta đi cấp lần mới khi máy in kẹt. */
  @Get('reprint/:cardPrintLogId')
  @RequirePermission('cemetery.card.view')
  reprint(@Param('cardPrintLogId') cardPrintLogId: string, @Req() req: Request) {
    return this.svc.reprint(cardPrintLogId, this.actor(req));
  }

  @Get(':customerId/issuances')
  @RequirePermission('cemetery.card.view')
  issuances(@Param('customerId') customerId: string, @Req() req: Request) {
    return this.svc.listIssuances(customerId, this.actor(req));
  }
}
