import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { HoldsService } from './holds.service';
import { CreateHoldDto } from './holds.dto';

@ApiTags('cemetery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('cemetery/grave-holds')
export class HoldsController {
  constructor(private readonly svc: HoldsService) {}

  @Post()
  @RequirePermission('cemetery.hold.hold')
  create(@Body() dto: CreateHoldDto, @Req() req: Request) {
    return this.svc.createHold(dto, req.user?.userId ?? null);
  }

  @Post(':id/release')
  @RequirePermission('cemetery.hold.release')
  release(@Param('id') id: string, @Req() req: Request) {
    return this.svc.releaseHold(id, req.user?.userId ?? null);
  }

  @Get()
  @RequirePermission('cemetery.hold.view')
  list(@Query('gravePlotId') gravePlotId?: string, @Query('status') status?: string) {
    return this.svc.listHolds(gravePlotId, status);
  }
}
