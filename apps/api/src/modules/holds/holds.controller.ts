import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { HoldsService } from './holds.service';
import { CreateHoldDto } from './holds.dto';

@ApiTags('cemetery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cemetery/grave-holds')
export class HoldsController {
  constructor(private readonly svc: HoldsService) {}

  @Post()
  create(@Body() dto: CreateHoldDto, @Req() req: Request) {
    return this.svc.createHold(dto, req.user?.userId ?? null);
  }

  @Post(':id/release')
  release(@Param('id') id: string, @Req() req: Request) {
    return this.svc.releaseHold(id, req.user?.userId ?? null);
  }

  @Get()
  list(@Query('gravePlotId') gravePlotId?: string, @Query('status') status?: string) {
    return this.svc.listHolds(gravePlotId, status);
  }
}
