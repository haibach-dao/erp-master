import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { PermissionGuard } from './permission.guard';
import { RequirePermission } from './require-permission.decorator';
import { AuthzMatrixService } from './authz-matrix.service';
import { callerOf, type Caller } from './caller';

export class GrantDto {
  @ApiProperty() @IsString() @MinLength(1) roleCode!: string;
  @ApiProperty() @IsString() @MinLength(1) permissionCode!: string;
  @ApiProperty() @IsString() @MinLength(1) scope!: string;
}

export class AssignRoleDto {
  @ApiProperty() @IsString() @MinLength(1) userId!: string;
  @ApiProperty() @IsString() @MinLength(1) roleCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() companyId?: string;
  /** Hết hạn thì quyền tự rụng — không ai phải nhớ đi thu hồi. */
  @ApiPropertyOptional() @IsOptional() @IsISO8601() validTo?: string;
  @ApiProperty() @IsString() @MinLength(1) reason!: string;
}

/* Admin surface for the permission matrix itself.
 *
 * Each route carries exactly one code, and they are deliberately different codes:
 * reading the matrix, changing what a role contains, and giving a person a role are
 * three separate decisions and should be separately grantable, even though today one
 * role holds all of them.
 */
@ApiTags('authz')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('authz')
export class AuthzMatrixController {
  constructor(private readonly svc: AuthzMatrixService) {}

  private caller(req: Request): Caller {
    return callerOf(req);
  }

  @Get('roles')
  @RequirePermission('authz.role.view')
  listRoles() {
    return this.svc.listRoles();
  }

  @Get('permissions')
  @RequirePermission('authz.permission.view')
  listPermissions() {
    return this.svc.listPermissions();
  }

  @Post('role-permissions')
  @RequirePermission('authz.role_permission.grant')
  grant(@Body() dto: GrantDto, @Req() req: Request) {
    return this.svc.grant(dto.roleCode, dto.permissionCode, dto.scope, this.caller(req));
  }

  @Delete('role-permissions/:roleCode/:permissionCode')
  @RequirePermission('authz.role_permission.revoke')
  revoke(
    @Param('roleCode') roleCode: string,
    @Param('permissionCode') permissionCode: string,
    @Req() req: Request,
  ) {
    return this.svc.revoke(roleCode, permissionCode, this.caller(req));
  }

  /* Tra hai chiều: `?userId=` (người này giữ vai gì) hoặc `?roleCode=` (vai này ở tay ai).
   * Không truyền gì thì 400 — xem `listAssignments`. */
  @Get('role-assignments')
  @RequirePermission('authz.role.view')
  listAssignments(
    @Query('userId') userId: string | undefined,
    @Query('roleCode') roleCode: string | undefined,
    @Req() req: Request,
  ) {
    return this.svc.listAssignments(
      {
        ...(userId === undefined ? {} : { userId }),
        ...(roleCode === undefined ? {} : { roleCode }),
      },
      this.caller(req),
    );
  }

  @Post('role-assignments')
  @RequirePermission('authz.role_assignment.assign')
  assignRole(@Body() dto: AssignRoleDto, @Req() req: Request) {
    return this.svc.assignRole(
      {
        userId: dto.userId,
        roleCode: dto.roleCode,
        companyId: dto.companyId ?? null,
        validTo: dto.validTo ?? null,
        reason: dto.reason,
      },
      this.caller(req),
    );
  }

  @Delete('role-assignments/:id')
  @RequirePermission('authz.role_assignment.revoke')
  revokeRole(@Param('id') id: string, @Req() req: Request) {
    return this.svc.revokeRole(id, this.caller(req));
  }
}
