import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { BurialsService } from './burials.service';
import { CancelBurialDto, CreateBurialDto, CreateDeceasedDto } from './burials.dto';

@ApiTags('burials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('burials')
export class BurialsController {
  constructor(private readonly svc: BurialsService) {}

  /* Ai gọi, và BẰNG MÃ NÀO. Mã lấy từ `req.requiredPermission` do `PermissionGuard` vừa
   * đặt, nên phạm vi chắc chắn được tính theo đúng mã guard đã thi hành — không có bản thứ
   * hai của chuỗi mã để mà lệch. Xem `authorization/caller.ts`. */
  private caller(req: Request): Caller {
    return callerOf(req);
  }

  @Post('deceased')
  @RequirePermission('burial.deceased.create')
  createDeceased(@Body() dto: CreateDeceasedDto) {
    return this.svc.createDeceased(dto);
  }

  @Post()
  @RequirePermission('burial.record.create')
  create(@Body() dto: CreateBurialDto, @Req() req: Request) {
    return this.svc.createBurial(dto, this.caller(req));
  }

  @Post(':id/verify')
  @RequirePermission('burial.record.verify')
  verify(@Param('id') id: string, @Req() req: Request) {
    return this.svc.verify(id, this.caller(req));
  }

  @Post(':id/complete')
  @RequirePermission('burial.record.complete')
  complete(@Param('id') id: string, @Req() req: Request) {
    return this.svc.complete(id, this.caller(req));
  }

  /* Huỷ hồ sơ an táng — nhả cốt ra cho người khác, và gỡ rào chắn xoá khách hàng.
   *
   * Mã quyền RIÊNG chứ không dùng ké `burial.record.verify`: huỷ và thẩm định là hai việc
   * ngược chiều nhau, và gộp mã là ép ai được thẩm định thì cũng được huỷ. */
  @Post(':id/cancel')
  @RequirePermission('burial.record.cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelBurialDto, @Req() req: Request) {
    return this.svc.cancel(id, dto, this.caller(req));
  }

  /* AI đủ điều kiện an táng vào phần mộ này: đã mất, có quan hệ đã xác nhận với chủ mộ
   * (hoặc chính là chủ mộ), và chưa nằm ở cốt nào.
   *
   * Có endpoint riêng thay vì để giao diện tự lọc: ba điều kiện này là LUẬT NGHIỆP VỤ, và
   * luật sống ở hai chỗ là luật sẽ lệch. Gate bằng mã đọc hồ sơ an táng — người xem được
   * danh sách này là người sắp lập hồ sơ. */
  @Get('candidates')
  @RequirePermission('burial.record.view')
  candidates(@Query('gravePlotId') gravePlotId: string, @Req() req: Request) {
    return this.svc.burialCandidates(gravePlotId, this.caller(req));
  }

  @Get(':id')
  @RequirePermission('burial.record.view')
  get(@Param('id') id: string, @Req() req: Request) {
    return this.svc.get(id, this.caller(req));
  }

  @Get()
  @RequirePermission('burial.record.view')
  list(
    @Req() req: Request,
    @Query('gravePlotId') gravePlotId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.list(this.caller(req), gravePlotId, status);
  }
}
