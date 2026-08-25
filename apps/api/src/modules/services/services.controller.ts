import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from '../authorization/permission.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { MaskUnless } from '../../common/masking/mask.decorator';
import { ServicesService } from './services.service';
import { CreateCatalogDto, RenewDto, SubscribeDto } from './services.dto';

@ApiTags('services')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Post('catalog')
  @RequirePermission('service.catalog.create')
  createCatalog(@Body() dto: CreateCatalogDto) {
    return this.svc.createCatalog(dto);
  }

  @Get('catalog')
  @RequirePermission('service.catalog.view')
  listCatalog(@Query('companyId') companyId: string, @Req() req: Request) {
    return this.svc.listCatalog(companyId, this.actor(req));
  }

  @Post('subscriptions')
  @RequirePermission('service.subscription.create')
  subscribe(@Body() dto: SubscribeDto, @Req() req: Request) {
    return this.svc.subscribe(dto, this.actor(req));
  }

  @Post('subscriptions/:id/renew')
  @RequirePermission('service.subscription.renew')
  renew(@Param('id') id: string, @Body() dto: RenewDto, @Req() req: Request) {
    return this.svc.renew(id, dto, this.actor(req));
  }

  @Post('subscriptions/:id/cancel')
  @RequirePermission('service.subscription.cancel')
  cancel(@Param('id') id: string, @Req() req: Request) {
    return this.svc.cancel(id, this.actor(req));
  }

  @Get('subscriptions')
  @RequirePermission('service.subscription.view')
  @MaskUnless({ field: 'agreedPrice', permission: 'service.subscription.view_price' })
  listSubscriptions(@Query('gravePlotId') gravePlotId?: string, @Query('status') status?: string) {
    return this.svc.listSubscriptions(gravePlotId, status);
  }

  @Get('revenue')
  @RequirePermission('service.revenue.view')
  revenue(
    @Req() req: Request,
    @Query('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.revenue(companyId, this.actor(req), from, to);
  }
}
