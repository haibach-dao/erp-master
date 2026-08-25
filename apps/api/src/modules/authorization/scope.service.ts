import { ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionsService } from './permissions.service';

/* Decides which records a caller may reach, as opposed to which actions they may take.
 *
 * The two questions are separate and both have to be answered. PermissionGuard answers
 * "may you do this at all"; this answers "may you do it to THAT company's data". Until
 * now the second question was answered by the client: every list endpoint took a
 * `companyId` query parameter and trusted it, so any authenticated user could read any
 * company's contracts, price list or revenue by changing one value in the URL.
 *
 * Refusal is a 403, deliberately — not an empty list. An empty result says "there is
 * nothing here", which is a different and misleading statement, and it hides the attempt
 * from anyone reading the logs.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly permissions: PermissionsService) {}

  /* Check a company id supplied by the caller against the companies they are bound to.
   *
   * A GROUP-scoped caller is unrestricted and passes anything. Everyone else must name a
   * company they hold. `companyId = null` — "across all companies" — is therefore only
   * ever valid for a GROUP caller.
   */
  async assertCompany(userId: string | null, companyId: string | null | undefined): Promise<void> {
    if (userId === null) {
      throw new ForbiddenException('Chưa xác thực');
    }
    const { scope } = await this.permissions.getEffectiveAccess(userId);
    if (scope.unrestricted) {
      return;
    }
    if (companyId === null || companyId === undefined || companyId === '') {
      throw new ForbiddenException(
        'Phải chỉ rõ công ty: chỉ phạm vi toàn tập đoàn mới được truy vấn không giới hạn',
      );
    }
    if (!scope.companyIds.includes(companyId)) {
      throw new ForbiddenException('Ngoài phạm vi được gán: công ty này không thuộc quyền của bạn');
    }
  }

  /** Companies the caller may see, or `null` meaning "no restriction". */
  async visibleCompanyIds(userId: string | null): Promise<string[] | null> {
    if (userId === null) {
      throw new ForbiddenException('Chưa xác thực');
    }
    const { scope } = await this.permissions.getEffectiveAccess(userId);
    return scope.unrestricted ? null : scope.companyIds;
  }
}
