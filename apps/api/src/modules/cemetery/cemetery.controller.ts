import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
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

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
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
    return this.svc.listCompanies(this.actor(req));
  }

  @Post('cemeteries')
  @RequirePermission('cemetery.site.create')
  createCemetery(@Body() dto: CreateCemeteryDto, @Req() req: Request) {
    return this.svc.createCemetery(dto, this.actor(req));
  }

  @Get('cemeteries')
  @RequirePermission('cemetery.site.view')
  listCemeteries(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.svc.listCemeteries(companyId, this.actor(req));
  }

  @Post('grave-types')
  @RequirePermission('cemetery.grave_type.create')
  createGraveType(@Body() dto: CreateGraveTypeDto, @Req() req: Request) {
    return this.svc.createGraveType(dto, this.actor(req));
  }

  @Get('grave-types')
  @RequirePermission('cemetery.grave_type.view')
  @MaskUnless({ field: 'referencePrice', permission: 'cemetery.price.view' })
  listGraveTypes(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.svc.listGraveTypes(companyId, this.actor(req));
  }

  @Post('grave-plots')
  @RequirePermission('cemetery.plot.create')
  createGravePlot(@Body() dto: CreateGravePlotDto, @Req() req: Request) {
    return this.svc.createGravePlot(dto, this.actor(req));
  }

  @Get('grave-plots')
  @RequirePermission('cemetery.plot.view')
  listGravePlots(
    @Req() req: Request,
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('cemeteryId') cemeteryId?: string,
  ) {
    return this.svc.listGravePlots(companyId, this.actor(req), status, cemeteryId);
  }

  @Post('grave-plots/:id/status')
  @RequirePermission('cemetery.plot.set_status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req: Request) {
    return this.svc.changeGravePlotStatus(id, dto, this.actor(req));
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
    return this.svc.setPlotPosition(id, dto, req.user?.userId ?? null);
  }

  @Get('cemeteries/:id/plot-map')
  @RequirePermission('cemetery.plot.view')
  plotMap(@Param('id') id: string, @Req() req: Request) {
    return this.svc.plotMap(id, req.user?.userId ?? null);
  }

  /* ---- Quyền sử dụng phần mộ ---- */

  /* Gán mộ cho chủ mộ KHÔNG qua hợp đồng. Mã S3 riêng vì nó vượt mặt chuỗi thẩm định —
   * đường bình thường là `contract.record.activate`. Service chặn khách hàng đã mất. */
  @Post('usage-rights')
  @RequirePermission('cemetery.usage_right.assign')
  assignUsageRight(@Body() dto: AssignUsageRightDto, @Req() req: Request) {
    return this.svc.assignUsageRight(dto, req.user?.userId ?? null);
  }

  @Get('grave-plots/:id/ownership')
  @RequirePermission('cemetery.usage_right.view')
  plotOwnership(@Param('id') id: string, @Req() req: Request) {
    return this.svc.plotOwnership(id, req.user?.userId ?? null);
  }
}
