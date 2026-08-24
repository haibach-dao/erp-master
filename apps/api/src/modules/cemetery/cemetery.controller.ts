import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { CemeteryService } from './cemetery.service';
import {
  ChangeStatusDto,
  CreateCemeteryDto,
  CreateCompanyDto,
  CreateGravePlotDto,
  CreateGraveTypeDto,
} from './cemetery.dto';

// M0 cemetery catalog. Authenticated; company-scoped filtering by companyId param.
// Full RBAC scope enforcement (PolicyEvaluator + user org assignments) is a follow-up.
@ApiTags('cemetery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cemetery')
export class CemeteryController {
  constructor(private readonly svc: CemeteryService) {}

  @Get('relationship-types')
  relationshipTypes() {
    return this.svc.listRelationshipTypes();
  }

  @Post('companies')
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.svc.createCompany(dto);
  }

  @Get('companies')
  listCompanies() {
    return this.svc.listCompanies();
  }

  @Post('cemeteries')
  createCemetery(@Body() dto: CreateCemeteryDto) {
    return this.svc.createCemetery(dto);
  }

  @Get('cemeteries')
  listCemeteries(@Query('companyId') companyId: string) {
    return this.svc.listCemeteries(companyId);
  }

  @Post('grave-types')
  createGraveType(@Body() dto: CreateGraveTypeDto) {
    return this.svc.createGraveType(dto);
  }

  @Get('grave-types')
  listGraveTypes(@Query('companyId') companyId: string) {
    return this.svc.listGraveTypes(companyId);
  }

  @Post('grave-plots')
  createGravePlot(@Body() dto: CreateGravePlotDto) {
    return this.svc.createGravePlot(dto);
  }

  @Get('grave-plots')
  listGravePlots(
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('cemeteryId') cemeteryId?: string,
  ) {
    return this.svc.listGravePlots(companyId, status, cemeteryId);
  }

  @Post('grave-plots/:id/status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req: Request) {
    return this.svc.changeGravePlotStatus(id, dto, req.user?.userId ?? null);
  }

  @Get('grave-plots/:id/status-history')
  statusHistory(@Param('id') id: string) {
    return this.svc.getStatusHistory(id);
  }
}
