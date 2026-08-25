import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AccessRulesService } from './access-rules.service';

export class CreateRuleDto {
  @ApiProperty({ enum: ['ALLOW', 'DENY'] }) @IsIn(['ALLOW', 'DENY']) effect!: 'ALLOW' | 'DENY';
  @ApiProperty() @IsString() @MinLength(1) permissionCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subjectUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() roleCode?: string;
  @ApiProperty() @IsString() @MinLength(1) reason!: string;
}

/* Chuỗi luật truy cập — nơi quyền lực cao nhất của hệ nằm.
 *
 * Một luật ALLOW ở đây cấp được thứ không vai nào cấp, kể cả leaf S3 mà grant wildcard
 * không với tới. Vì thế XEM và SỬA là hai mã khác nhau: đọc được chuỗi luật là đọc được
 * bản đồ phòng thủ của hệ, còn sửa nó thì tương đương quyền tối cao.
 */
@ApiTags('authz')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('authz/access-rules')
export class AccessRulesController {
  constructor(private readonly svc: AccessRulesService) {}

  private actor(req: Request): string | null {
    return req.user?.userId ?? null;
  }

  @Get()
  @RequirePermission('authz.rule.view')
  list() {
    return this.svc.list();
  }

  /* Thử chuỗi luật cho một (người, mã) — `iptables -C` của hệ.
   * Chỉ cần quyền XEM: nó không đổi gì, và một chuỗi luật không thử được là một chuỗi
   * không ai dám sửa.
   */
  @Get('explain')
  @RequirePermission('authz.rule.view')
  explain(@Query('userId') userId: string, @Query('code') code: string) {
    return this.svc.explain(userId, code);
  }

  @Post()
  @RequirePermission('authz.rule.update')
  create(@Body() dto: CreateRuleDto, @Req() req: Request) {
    return this.svc.create(
      {
        effect: dto.effect,
        permissionCode: dto.permissionCode,
        subjectUserId: dto.subjectUserId ?? null,
        roleCode: dto.roleCode ?? null,
        reason: dto.reason,
      },
      this.actor(req),
    );
  }

  @Post(':id/move-up')
  @RequirePermission('authz.rule.update')
  moveUp(@Param('id') id: string, @Req() req: Request) {
    return this.svc.move(id, 'up', this.actor(req));
  }

  @Post(':id/move-down')
  @RequirePermission('authz.rule.update')
  moveDown(@Param('id') id: string, @Req() req: Request) {
    return this.svc.move(id, 'down', this.actor(req));
  }

  @Delete(':id')
  @RequirePermission('authz.rule.update')
  revoke(@Param('id') id: string, @Req() req: Request) {
    return this.svc.revoke(id, this.actor(req));
  }
}
