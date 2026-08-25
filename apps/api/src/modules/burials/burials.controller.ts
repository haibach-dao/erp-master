import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { BurialsService } from './burials.service';
import { CreateBurialDto, CreateDeceasedDto } from './burials.dto';

@ApiTags('burials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('burials')
export class BurialsController {
  constructor(private readonly svc: BurialsService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post('deceased')
  @RequirePermission('burial.deceased.create')
  createDeceased(@Body() dto: CreateDeceasedDto) {
    return this.svc.createDeceased(dto);
  }

  @Post()
  @RequirePermission('burial.record.create')
  create(@Body() dto: CreateBurialDto, @Req() req: Request) {
    return this.svc.createBurial(dto, this.actor(req));
  }

  @Post(':id/verify')
  @RequirePermission('burial.record.verify')
  verify(@Param('id') id: string, @Req() req: Request) {
    return this.svc.verify(id, this.actor(req));
  }

  @Post(':id/complete')
  @RequirePermission('burial.record.complete')
  complete(@Param('id') id: string, @Req() req: Request) {
    return this.svc.complete(id, this.actor(req));
  }

  @Get(':id')
  @RequirePermission('burial.record.view')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get()
  @RequirePermission('burial.record.view')
  list(@Query('gravePlotId') gravePlotId?: string, @Query('status') status?: string) {
    return this.svc.list(gravePlotId, status);
  }
}
