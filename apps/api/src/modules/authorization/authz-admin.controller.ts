import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AuthzAdminService } from './authz-admin.service';

export class AssignScopeDto {
  @ApiProperty() @IsString() @MinLength(1) userId!: string;
  @ApiProperty() @IsString() @MinLength(1) cemeteryId!: string;
}

/* Admin surface for the hub axis: who covers which cemetery.
 *
 * Reading the assignment of others is itself a permission (`authz.scope.assign`), not a
 * side effect of being logged in — the list tells you who can see which site, which is
 * exactly the map an attacker would want.
 */
@ApiTags('authz')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('authz/scope-assignments')
export class AuthzAdminController {
  constructor(private readonly svc: AuthzAdminService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Get()
  @RequirePermission('authz.scope.assign')
  list(@Query('userId') userId: string) {
    return this.svc.listForUser(userId);
  }

  @Post()
  @RequirePermission('authz.scope.assign')
  assign(@Body() dto: AssignScopeDto, @Req() req: Request) {
    return this.svc.assign(dto.userId, dto.cemeteryId, this.actor(req));
  }

  @Delete(':userId/:cemeteryId')
  @RequirePermission('authz.scope.assign')
  revoke(
    @Param('userId') userId: string,
    @Param('cemeteryId') cemeteryId: string,
    @Req() req: Request,
  ) {
    return this.svc.revoke(userId, cemeteryId, this.actor(req));
  }
}
