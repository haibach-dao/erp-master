import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSION_KEY } from './require-permission.decorator';
import { PermissionsService } from './permissions.service';
import { permissionMatches } from './policy-evaluator';

/* Enforces @RequirePermission at the service boundary — DENY BY DEFAULT.
 *
 * Three fail-closed rules, in order:
 *  1. A route with no permission and no @Public() is refused. It used to be allowed,
 *     which meant a forgotten decorator was an open door rather than a broken build.
 *  2. A permission code that is not in the catalog is refused. A typo'd code must fail
 *     as "unknown code", not silently match nothing and look like a rights problem.
 *  3. A wildcard grant cannot reach a leaf marked `wildcard_exempt` (every S3 leaf).
 *     Naming the leaf is the only way in.
 *  4. An explicit deny beats every grant. Roles combine by UNION here — holding two roles
 *     adds their rights and nothing narrows — so a deny row is the only mechanism left
 *     that can take a granted right away. It is checked before the grants are read.
 *
 * Still NOT enforced here: which records the caller may touch. This guard answers "may
 * you do this at all", never "may you do this to THAT row" — the scope layer is separate
 * and not wired yet (doc 16 §D.10). Do not read a green guard as record-level control.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) === true) {
      return true;
    }
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, targets);
    if (required === undefined) {
      throw new ForbiddenException(
        'Route chưa khai quyền: thiếu @RequirePermission (hoặc @Public nếu cố ý công khai)',
      );
    }
    const req = context.switchToHttp().getRequest<Request>();
    const userId = req.user?.userId;
    if (userId === undefined) {
      throw new ForbiddenException('Chưa xác thực');
    }
    const meta = await this.permissions.getPermissionMeta(required);
    if (meta === null) {
      throw new ForbiddenException(`Mã quyền không có trong danh mục: ${required}`);
    }
    if (await this.permissions.isDenied(userId, required)) {
      throw new ForbiddenException(`Bị cấm tường minh: ${required}`);
    }
    const grants = await this.permissions.getGrants(userId);
    const ok = grants.some((g) =>
      permissionMatches(g.permission, required, { wildcardExempt: meta.wildcardExempt }),
    );
    if (!ok) {
      throw new ForbiddenException(`Thiếu quyền: ${required}`);
    }
    return true;
  }
}
