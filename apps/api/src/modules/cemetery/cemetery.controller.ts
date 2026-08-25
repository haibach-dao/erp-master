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
  listCompanies() {
    return this.svc.listCompanies();
  }

  @Post('cemeteries')
  @RequirePermission('cemetery.site.create')
  createCemetery(@Body() dto: CreateCemeteryDto) {
    return this.svc.createCemetery(dto);
  }

  @Get('cemeteries')
  @RequirePermission('cemetery.site.view')
  listCemeteries(@Query('companyId') companyId: string) {
    return this.svc.listCemeteries(companyId);
  }

  @Post('grave-types')
  @RequirePermission('cemetery.grave_type.create')
  createGraveType(@Body() dto: CreateGraveTypeDto) {
    return this.svc.createGraveType(dto);
  }

  @Get('grave-types')
  @RequirePermission('cemetery.grave_type.view')
  @MaskUnless({ field: 'referencePrice', permission: 'cemetery.price.view' })
  listGraveTypes(@Query('companyId') companyId: string) {
    return this.svc.listGraveTypes(companyId);
  }

  @Post('grave-plots')
  @RequirePermission('cemetery.plot.create')
  createGravePlot(@Body() dto: CreateGravePlotDto) {
    return this.svc.createGravePlot(dto);
  }

  @Get('grave-plots')
  @RequirePermission('cemetery.plot.view')
  listGravePlots(
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('cemeteryId') cemeteryId?: string,
  ) {
    return this.svc.listGravePlots(companyId, status, cemeteryId);
  }

  @Post('grave-plots/:id/status')
  @RequirePermission('cemetery.plot.set_status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req: Request) {
    return this.svc.changeGravePlotStatus(id, dto, req.user?.userId ?? null);
  }

  @Get('grave-plots/:id/status-history')
  @RequirePermission('cemetery.plot.view_history')
  statusHistory(@Param('id') id: string) {
    return this.svc.getStatusHistory(id);
  }
}
