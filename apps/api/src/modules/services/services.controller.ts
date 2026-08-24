import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { ServicesService } from './services.service';
import { CreateCatalogDto, RenewDto, SubscribeDto } from './services.dto';

@ApiTags('services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post('catalog')
  createCatalog(@Body() dto: CreateCatalogDto) {
    return this.svc.createCatalog(dto);
  }

  @Get('catalog')
  listCatalog(@Query('companyId') companyId: string) {
    return this.svc.listCatalog(companyId);
  }

  @Post('subscriptions')
  subscribe(@Body() dto: SubscribeDto, @Req() req: Request) {
    return this.svc.subscribe(dto, this.actor(req));
  }

  @Post('subscriptions/:id/renew')
  renew(@Param('id') id: string, @Body() dto: RenewDto, @Req() req: Request) {
    return this.svc.renew(id, dto, this.actor(req));
  }

  @Post('subscriptions/:id/cancel')
  cancel(@Param('id') id: string, @Req() req: Request) {
    return this.svc.cancel(id, this.actor(req));
  }

  @Get('subscriptions')
  listSubscriptions(@Query('gravePlotId') gravePlotId?: string, @Query('status') status?: string) {
    return this.svc.listSubscriptions(gravePlotId, status);
  }

  @Get('revenue')
  revenue(
    @Query('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.revenue(companyId, from, to);
  }
}
