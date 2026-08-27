import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { callerOf, type Caller } from '../authorization/caller';
import { MaskUnless } from '../../common/masking/mask.decorator';
import { CemeteryService } from './cemetery.service';
import {
  ChangeStatusDto,
  CreateCemeteryDto,
  CreateCompanyDto,
  CreateGravePlotDto,
  CreateGraveTypeDto,
  SetPlotPositionDto,
  AssignUsageRightDto,
  ReleaseUsageRightDto,
  TransferUsageRightDto,
} from './cemetery.dto';

// M0 cemetery catalog. Every route carries a permission code; the record-level scope
// (which company/site a caller may touch) is NOT enforced yet — companyId still comes
// from the query string. That hole is tracked separately (doc 16 §F PR-9/PR-10).
@ApiTags('cemetery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery')
export class CemeteryController {
  constructor(private readonly svc: CemeteryService) {}

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  @Get('relationship-types')
  @RequirePermission('cemetery.reference.view')
  relationshipTypes() {
    return this.svc.listRelationshipTypes();
  }

  @Post('companies')
  @RequirePermission('org.company.create')
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.svc.createCompany(dto);
  }

  @Get('companies')
  @RequirePermission('org.company.view')
  listCompanies(@Req() req: Request) {
    return this.svc.listCompanies(this.caller(req));
  }

  @Post('cemeteries')
  @RequirePermission('cemetery.site.create')
  createCemetery(@Body() dto: CreateCemeteryDto, @Req() req: Request) {
    return this.svc.createCemetery(dto, this.caller(req));
  }

  @Get('cemeteries')
  @RequirePermission('cemetery.site.view')
  listCemeteries(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.svc.listCemeteries(companyId, this.caller(req));
  }

  @Post('grave-types')
  @RequirePermission('cemetery.grave_type.create')
  createGraveType(@Body() dto: CreateGraveTypeDto, @Req() req: Request) {
    return this.svc.createGraveType(dto, this.caller(req));
  }

  @Get('grave-types')
  @RequirePermission('cemetery.grave_type.view')
  @MaskUnless({ field: 'referencePrice', permission: 'cemetery.price.view' })
  listGraveTypes(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.svc.listGraveTypes(companyId, this.caller(req));
  }

  @Post('grave-plots')
  @RequirePermission('cemetery.plot.create')
  createGravePlot(@Body() dto: CreateGravePlotDto, @Req() req: Request) {
    return this.svc.createGravePlot(dto, this.caller(req));
  }

  @Get('grave-plots')
  @RequirePermission('cemetery.plot.view')
  listGravePlots(
    @Req() req: Request,
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('cemeteryId') cemeteryId?: string,
  ) {
    return this.svc.listGravePlots(companyId, this.caller(req), status, cemeteryId);
  }

  @Post('grave-plots/:id/status')
  @RequirePermission('cemetery.plot.set_status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req: Request) {
    return this.svc.changeGravePlotStatus(id, dto, this.caller(req));
  }

  @Get('grave-plots/:id/status-history')
  @RequirePermission('cemetery.plot.view_history')
  statusHistory(@Param('id') id: string) {
    return this.svc.getStatusHistory(id);
  }

  /* Toạ độ sơ đồ mặt bằng — tách khỏi `set_status` vì là hai việc khác nhau: đổi trạng
   * thái là nghiệp vụ bán/an táng, đặt toạ độ là số hoá bản vẽ. Người làm bản vẽ không
   * vì thế mà được đổi trạng thái mộ. */
  @Post('grave-plots/:id/position')
  @RequirePermission('cemetery.plot.update')
  setPosition(@Param('id') id: string, @Body() dto: SetPlotPositionDto, @Req() req: Request) {
    return this.svc.setPlotPosition(id, dto, this.caller(req));
  }

  @Get('cemeteries/:id/plot-map')
  @RequirePermission('cemetery.plot.view')
  plotMap(@Param('id') id: string, @Req() req: Request) {
    return this.svc.plotMap(id, this.caller(req));
  }

  /* ---- Quyền sử dụng phần mộ ---- */

  /* Gán mộ cho chủ mộ KHÔNG qua hợp đồng. Mã S3 riêng vì nó vượt mặt chuỗi thẩm định —
   * đường bình thường là `contract.record.activate`. Service chặn khách hàng đã mất. */
  @Post('usage-rights')
  @RequirePermission('cemetery.usage_right.assign')
  assignUsageRight(@Body() dto: AssignUsageRightDto, @Req() req: Request) {
    return this.svc.assignUsageRight(dto, this.caller(req));
  }

  @Get('grave-plots/:id/ownership')
  @RequirePermission('cemetery.usage_right.view')
  plotOwnership(@Param('id') id: string, @Req() req: Request) {
    return this.svc.plotOwnership(id, this.caller(req));
  }

  /* Thu hồi: mộ trở về TRỐNG. Service chặn khi mộ còn hồ sơ an táng — muốn đổi người chịu
   * trách nhiệm cho một mộ đã có người nằm thì đó là SANG TÊN. */
  @Post('usage-rights/:id/release')
  @RequirePermission('cemetery.usage_right.release')
  releaseUsageRight(
    @Param('id') id: string,
    @Body() dto: ReleaseUsageRightDto,
    @Req() req: Request,
  ) {
    return this.svc.releaseUsageRight(id, dto, this.caller(req));
  }

  /* Sang tên — đây là đường THỪA KẾ. Gán mộ chặn người đã mất đứng tên, nên không có
   * đường này thì mộ của người đã mất kẹt vĩnh viễn ở tên họ. */
  @Post('usage-rights/:id/transfer')
  @RequirePermission('cemetery.usage_right.transfer')
  transferUsageRight(
    @Param('id') id: string,
    @Body() dto: TransferUsageRightDto,
    @Req() req: Request,
  ) {
    return this.svc.transferUsageRight(id, dto, this.caller(req));
  }

  @Get('grave-plots/:id/usage-right-history')
  @RequirePermission('cemetery.usage_right.view')
  usageRightHistory(@Param('id') id: string, @Req() req: Request) {
    return this.svc.usageRightHistory(id, this.caller(req));
  }
}
