import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSION_KEY } from './require-permission.decorator';
import { PermissionsService } from './permissions.service';
import { permissionMatches } from './policy-evaluator';

// Enforces @RequirePermission at the service boundary. Permission-level gate: allows if the
// user holds a grant whose code matches (wildcards supported). Record/company-scope checks
// are a follow-up (need org-unit assignments); routes without the decorator pass through.
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const userId = req.user?.userId;
    if (userId === undefined) {
      throw new ForbiddenException('Chưa xác thực');
    }
    const grants = await this.permissions.getGrants(userId);
    const ok = grants.some((g) => permissionMatches(g.permission, required));
    if (!ok) {
      throw new ForbiddenException(`Thiếu quyền: ${required}`);
    }
    return true;
  }
}
