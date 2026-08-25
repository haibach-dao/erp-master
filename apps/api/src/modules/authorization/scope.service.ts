import { ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionsService, type ScopeLevel } from './permissions.service';
import { PolicyEvaluator } from './policy-evaluator';
import type { PermissionGrant, ResourceTarget, Subject } from './policy.types';

/* Decides which records a caller may reach, as opposed to which actions they may take.
 *
 * The two questions are separate and both have to be answered. PermissionGuard answers
 * "may you do this at all"; this answers "may you do it to THAT record". Until recently
 * the second question was answered by the client: every list endpoint took a `companyId`
 * query parameter and trusted it, so any authenticated user could read any company's
 * contracts, price list or revenue by changing one value in the URL.
 *
 * `PolicyEvaluator` is the single place that decides what a scope MEANS. This service is
 * its caller — it builds the Subject from stored assignments and the Target from the
 * record, and hands both over. Scope semantics therefore live in exactly one file, with
 * one test suite, rather than being re-derived at each call site.
 *
 * Refusal is a 403, deliberately — not an empty list. An empty result says "there is
 * nothing here", which is a different and misleading statement, and it hides the attempt
 * from anyone reading the logs.
 */
@Injectable()
export class ScopeService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly evaluator: PolicyEvaluator,
  ) {}

  /* Check a company id supplied by the caller against the companies they are bound to.
   *
   * A GROUP-scoped caller is unrestricted and passes anything. Everyone else must name a
   * company they hold. `companyId = null` — "across all companies" — is therefore only
   * ever valid for a GROUP caller.
   */
  async assertCompany(userId: string | null, companyId: string | null | undefined): Promise<void> {
    const { subject, level } = await this.load(userId);
    if (level === 'GROUP') {
      return;
    }
    if (isBlank(companyId)) {
      throw new ForbiddenException(
        'Phải chỉ rõ công ty: chỉ phạm vi toàn tập đoàn mới được truy vấn không giới hạn',
      );
    }
    if (!this.allows(subject, { companyId: companyId ?? null }, 'COMPANY')) {
      throw new ForbiddenException('Ngoài phạm vi được gán: công ty này không thuộc quyền của bạn');
    }
  }

  /* Check a cemetery against the hub — the cemeteries this person actually covers.
   *
   * A caller bound at COMPANY level covers every cemetery inside their company, so this
   * only bites for someone whose reach is meant to stop at specific sites. Being assigned
   * to no cemetery means reaching none of them, never all of them.
   */
  async assertSite(userId: string | null, cemeteryId: string | null | undefined): Promise<void> {
    const { subject, level } = await this.load(userId);
    // GROUP reaches everything; COMPANY covers every cemetery inside the companies the
    // caller holds, and that company check is a separate call the caller already makes.
    if (level === 'GROUP' || level === 'COMPANY') {
      return;
    }
    if (isBlank(cemeteryId)) {
      throw new ForbiddenException('Phải chỉ rõ nghĩa trang');
    }
    if (!this.allows(subject, { siteId: cemeteryId ?? null }, 'SITE')) {
      throw new ForbiddenException('Ngoài phạm vi được gán: bạn không phụ trách nghĩa trang này');
    }
  }

  /** Companies the caller may see, or `null` meaning "no restriction". */
  async visibleCompanyIds(userId: string | null): Promise<string[] | null> {
    const { subject, level } = await this.load(userId);
    return level === 'GROUP' ? null : (subject.companyIds ?? []);
  }

  /* Cemeteries a list query must be narrowed to, or `null` when no narrowing applies.
   *
   * Only a SITE-level caller gets narrowed. A COMPANY-level caller is already bounded by
   * their company and covers every cemetery in it, so narrowing them by the (empty) hub
   * would hide their own data.
   */
  async listSiteFilter(userId: string | null): Promise<string[] | null> {
    const { subject, level } = await this.load(userId);
    return level === 'SITE' ? (subject.siteIds ?? []) : null;
  }

  private async load(userId: string | null): Promise<{ subject: Subject; level: ScopeLevel }> {
    if (userId === null) {
      throw new ForbiddenException('Chưa xác thực');
    }
    const { scope } = await this.permissions.getEffectiveAccess(userId);
    return {
      subject: { userId, companyIds: scope.companyIds, siteIds: scope.siteIds },
      level: scope.level,
    };
  }

  /* Scope level for one permission code, unioned across the grants that cover it.
   *
   * Prefer this over the caller-wide `level` whenever the code is known: the caller-wide
   * value is the widest thing they hold ANYWHERE, which is broader than what any single
   * code was granted at.
   */
  async levelFor(userId: string | null, code: string): Promise<ScopeLevel> {
    if (userId === null) {
      throw new ForbiddenException('Chưa xác thực');
    }
    return this.permissions.scopeLevelFor(userId, code);
  }

  // One synthetic grant, so the decision runs through the same evaluator the rest of the
  // system uses rather than through a second, quietly divergent copy of the rules.
  private allows(subject: Subject, target: ResourceTarget, scope: PermissionGrant['scope']) {
    const grant: PermissionGrant = { permission: 'scope.check.view', scope };
    return this.evaluator.can({ permission: 'scope.check.view', subject, target }, [grant]);
  }
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}
