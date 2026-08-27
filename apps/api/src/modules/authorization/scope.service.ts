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

  /* ---- Bản THEO MÃ QUYỀN ----
   *
   * VÌ SAO PHẢI CÓ, và vì sao bốn hàm ở trên chưa đủ (đo được, 27/08/2026):
   *
   * `EffectiveAccess.scope.level` là mức RỘNG NHẤT người này giữ Ở BẤT CỨ ĐÂU. Chú thích
   * của chính nó đã nói "For display; per-code decisions use scopeLevelFor" — nhưng cho
   * tới 27/08/2026 KHÔNG có một dòng mã sản xuất nào gọi `scopeLevelFor`. Công cụ được
   * dựng ra rồi để đó; mọi lời gọi phạm vi vẫn chạy trên mức toàn-người-gọi.
   *
   * Hậu quả cụ thể, đúng tình huống chủ doanh nghiệp nêu ngày 27/08/2026: một người vừa
   * là `QL_NGHIA_TRANG` (SITE, phụ trách nghĩa trang A) vừa là `KTNB_KIEM_TOAN` (GROUP,
   * CHỈ ĐỌC toàn tập đoàn). Mức toàn-người-gọi của họ là GROUP, nên `assertSite` thoát
   * ngay ở dòng đầu và họ HUỶ ĐƯỢC hồ sơ an táng ở nghĩa trang B — bằng một mã quyền
   * (`burial.record.cancel`) mà vai kiểm toán không hề cấp, ở một nghĩa trang mà vai quản
   * lý không hề phủ. Hợp giữa các vai là cộng dồn QUYỀN, không phải cộng dồn TẦM VỚI.
   *
   * Nên: nơi nào biết mã quyền đang thi hành thì phải hỏi phạm vi THEO MÃ ĐÓ. Mã lấy từ
   * `req.requiredPermission` do `PermissionGuard` đặt, không gõ lại bằng tay.
   *
   * Ngữ nghĩa của phép kiểm là CHUNG với bốn hàm trên (`checkCompany`/`checkSite`) — chỉ
   * khác chỗ lấy `level`. Tách như vậy để không đẻ ra bản thứ hai của luật phạm vi: hai
   * bản là hai thứ sẽ lệch nhau, và đó đúng là lớp lỗi mà `common/lifecycle/active.ts`
   * sinh ra để dẹp.
   */
  async assertCompanyFor(
    userId: string | null,
    code: string | null | undefined,
    companyId: string | null | undefined,
  ): Promise<void> {
    const { subject, level } = await this.loadFor(userId, code);
    this.checkCompany(subject, level, companyId);
  }

  async assertSiteFor(
    userId: string | null,
    code: string | null | undefined,
    cemeteryId: string | null | undefined,
  ): Promise<void> {
    const { subject, level } = await this.loadFor(userId, code);
    this.checkSite(subject, level, cemeteryId);
  }

  /** Companies visible FOR ONE CODE, or `null` meaning "no restriction". */
  async visibleCompanyIdsFor(
    userId: string | null,
    code: string | null | undefined,
  ): Promise<string[] | null> {
    const { subject, level } = await this.loadFor(userId, code);
    return level === 'GROUP' ? null : (subject.companyIds ?? []);
  }

  /** Cemeteries a list query must be narrowed to FOR ONE CODE, or `null` when none. */
  async listSiteFilterFor(
    userId: string | null,
    code: string | null | undefined,
  ): Promise<string[] | null> {
    const { subject, level } = await this.loadFor(userId, code);
    return level === 'SITE' ? (subject.siteIds ?? []) : null;
  }

  /* ---- Luật phạm vi, khai đúng MỘT lần ---- */

  private checkCompany(
    subject: Subject,
    level: ScopeLevel,
    companyId: string | null | undefined,
  ): void {
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

  private checkSite(subject: Subject, level: ScopeLevel, cemeteryId: string | null | undefined) {
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

  /* Cùng subject, nhưng `level` tính THEO MÃ.
   *
   * Thiếu mã là TỪ CHỐI, không phải rơi về mức toàn-người-gọi. Rơi về là fail-open: route
   * quên khai `@RequirePermission` (hoặc gọi nhầm từ chỗ không đi qua guard) sẽ được kiểm
   * phạm vi rộng hơn chính nó đáng được — và im lặng. Cùng nếp với guard: không khai thì
   * không đi qua được.
   */
  private async loadFor(
    userId: string | null,
    code: string | null | undefined,
  ): Promise<{ subject: Subject; level: ScopeLevel }> {
    if (userId === null) {
      throw new ForbiddenException('Chưa xác thực');
    }
    if (isBlank(code)) {
      throw new ForbiddenException(
        'Không xác định được mã quyền đang thi hành — không kiểm được phạm vi',
      );
    }
    const { scope } = await this.permissions.getEffectiveAccess(userId);
    return {
      subject: { userId, companyIds: scope.companyIds, siteIds: scope.siteIds },
      level: await this.permissions.scopeLevelFor(userId, code as string),
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
