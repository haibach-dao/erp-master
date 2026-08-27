import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { MaskUnless } from '../../common/masking/mask.decorator';
import { ContractsService } from './contracts.service';
import { AddPartyDto, CreateContractDto, CancelContractDto } from './contracts.dto';

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  @Post()
  @RequirePermission('contract.record.create')
  create(@Body() dto: CreateContractDto, @Req() req: Request) {
    return this.svc.create(dto, this.caller(req));
  }

  @Post(':id/parties')
  @RequirePermission('contract.party.assign')
  addParty(@Param('id') id: string, @Body() dto: AddPartyDto) {
    return this.svc.addParty(id, dto);
  }

  @Post(':id/verify')
  @RequirePermission('contract.record.verify')
  verify(@Param('id') id: string, @Req() req: Request) {
    return this.svc.verify(id, this.caller(req));
  }

  @Post(':id/activate')
  @RequirePermission('contract.record.activate')
  activate(@Param('id') id: string, @Req() req: Request) {
    return this.svc.activate(id, this.caller(req));
  }

  /* Huỷ hợp đồng. Mã quyền này có trong danh mục từ đầu nhưng CHƯA từng có endpoint —
   * nên rào chắn xoá khách hàng bảo "dọn hợp đồng trước" mà không có chỗ nào để dọn. */
  @Post(':id/cancel')
  @RequirePermission('contract.record.cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelContractDto, @Req() req: Request) {
    return this.svc.cancel(id, dto, this.caller(req));
  }

  @Get(':id')
  @RequirePermission('contract.record.view')
  @MaskUnless({ field: 'totalAmount', permission: 'contract.amount.view_sensitive' })
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get()
  @RequirePermission('contract.record.view')
  @MaskUnless({ field: 'totalAmount', permission: 'contract.amount.view_sensitive' })
  list(
    @Req() req: Request,
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('gravePlotId') gravePlotId?: string,
  ) {
    return this.svc.list(companyId, this.caller(req), status, gravePlotId);
  }
}
