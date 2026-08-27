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
 *
 * Before any of that, the ORDERED RULE CHAIN gets first say (firewall semantics): rules
 * are walked by ascending priority and the first match decides. A DENY rule refuses
 * outright; an ALLOW rule admits without consulting the role matrix at all. Only when no
 * rule matches does the matrix answer — and if it grants nothing, the request is refused.
 * That final refusal IS the "deny all" at the bottom of the chain.
 *
 * Roles combine by UNION, so nothing narrows a granted right; the rule chain is the only
 * mechanism that can take one away.
 *
 * KHÔNG thi hành ở đây: caller được chạm vào BẢN GHI NÀO. Guard trả lời "có được làm việc
 * này không", không bao giờ trả lời "có được làm lên DÒNG ĐÓ không" — đó là việc của
 * `ScopeService`, và nó phải được gọi ở từng service. Đừng đọc một guard xanh thành kiểm
 * soát mức bản ghi: guard xanh + service không gọi `ScopeService` = IDOR, và `BurialsService`
 * đã ở đúng tình trạng đó từ lúc dựng cho tới 27/08/2026.
 *
 * Guard có ĐÓNG GÓP một mảnh cho tầng phạm vi: nó ghi mã vừa thi hành vào
 * `req.requiredPermission`, để `ScopeService` tính mức phạm vi THEO ĐÚNG MÃ ĐÓ thay vì
 * theo mức rộng nhất mà người này giữ ở đâu đó.
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
    /* Ghi lại mã đang thi hành để tầng phạm vi đọc lại được. Đặt SAU khi đã đối chiếu
     * danh mục: mã không có trong danh mục thì không phải mã, và để nó lọt xuống dưới là
     * đưa cho `ScopeService` một chuỗi mà `scopeLevelFor` sẽ trả `NONE` vì lý do khác hẳn
     * lý do thật. */
    req.requiredPermission = required;
    const ruling = await this.permissions.evaluateRules(userId, required);
    if (ruling === 'DENY') {
      throw new ForbiddenException(`Bị luật truy cập chặn: ${required}`);
    }
    if (ruling === 'ALLOW') {
      return true;
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
