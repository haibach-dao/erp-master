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

  /* Mức VÀ phạm vi, cả hai tính THEO MÃ, lấy trong MỘT lượt.
   *
   * Trước 16/09/2026 chỉ `level` theo mã, còn `companyIds` lấy từ `getEffectiveAccess` —
   * hợp của MỌI dòng gán, bất kể vai đó có cấp mã đang thi hành hay không. Ghép một mức bó
   * chặt với một danh sách bó lỏng thì phần bó chặt bị vô hiệu: xem chú thích `scopeForCode`
   * trong `permissions.service.ts`.
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
    const { level, companyIds, siteIds } = await this.permissions.scopeForCode(
      userId,
      code as string,
    );
    /* NONE là TỪ CHỐI, và phải từ chối NGAY ĐÂY.
     *
     * `NONE` không phải một mức hẹp hơn `SITE`. Nó là câu "mã này không được cấp phạm vi
     * nào". Trước bản này, cả bốn đường bên dưới đọc nó thành một thứ khác hẳn, mỗi đường
     * một kiểu: `checkCompany` rơi xuống nhánh COMPANY, `checkSite` rơi xuống nhánh SITE,
     * `visibleCompanyIdsFor` trả nguyên danh sách công ty, `listSiteFilterFor` trả `null`.
     *
     * HAI NGUỒN `NONE` THẬT SỰ VỚI TỚI ĐƯỢC ĐÂY (đã soi lại 16/09/2026, xem đính chính ở
     * cuối chú thích):
     *
     * 1. Grant mang một scope mà `broader()` không thực thi — cột `role_permissions.scope`
     *    mặc định `DEPARTMENT`. `PermissionGuard` cho qua vì nó hỏi MÃ, không hỏi PHẠM VI.
     *    Đường GHI nay đã bị chặn (`AuthzMatrixService.grant` + `isEnforcedScope`), nhưng
     *    seed, migration và `psql` vẫn ghi thẳng vào cột được, nên cổng này vẫn cần.
     * 2. Một luật ALLOW trong `access_rules` phủ mã mà không vai nào cấp. Guard trả `true`
     *    ngay ở nhánh ALLOW; xuống tới đây thì không grant nào phủ nên mức là `NONE`. Luật
     *    ALLOW nói "được làm", nó KHÔNG nói "ở đâu" — nên không có phạm vi, và không có
     *    phạm vi thì không với tới bản ghi nào. Đó là lựa chọn fail-closed có chủ đích;
     *    muốn luật ALLOW tự mang phạm vi thì phải thêm cột, và đó là quyết định riêng.
     *
     * ĐÍNH CHÍNH LỜI KHAI CỦA CHÍNH LÁT NÀY (commit b63b1be nói sai hai điều, một lượt soi
     * độc lập bắt được; giữ lại đây vì cả hai nghe rất hợp lý và sẽ bị nghĩ lại):
     *
     * - "Người bị một luật DENY chặn vẫn đọc được" — KHÔNG với tới được qua HTTP.
     *   `PermissionGuard` gọi `evaluateRules` và ném 403 "Bị luật truy cập chặn" TRƯỚC khi
     *   controller chạy. `scopeLevelFor` vẫn trả `NONE` cho DENY, nhưng đường request không
     *   bao giờ tới đây với hình dạng đó.
     * - "`listSiteFilterFor` trả `null` tức KHÔNG BÓ GÌ" — sai ở cả tám nơi gọi. Mỗi nơi
     *   hoặc ghép chung `where` với `visibleCompanyIdsFor` (luôn trả MẢNG khi không phải
     *   GROUP), hoặc đứng sau một `assertCompanyFor` trên cùng mã. Trục công ty vẫn bó.
     *   Over-reach thật là "thấy cả công ty thay vì chỉ nghĩa trang mình phụ trách" —
     *   nghiêm trọng, nhưng không phải "không lọc gì".
     *
     * Chặn ở MỘT chỗ chứ không rải ra bốn chỗ: bốn bản của cùng một luật là bốn thứ sẽ lệch
     * nhau — đúng lớp lỗi mà `common/lifecycle/active.ts` sinh ra để dẹp.
     */
    if (level === 'NONE') {
      /* KHÔNG mở đầu bằng "Ngoài phạm vi được gán" như hai câu ở `checkCompany`/`checkSite`.
       * Hai câu đó nói "bản ghi này nằm ngoài phần bạn được giao"; câu này nói "mã quyền
       * của bạn không được giao phần nào cả" — hai nguyên nhân khác hẳn, và người đọc log
       * phân biệt được chúng bằng chính câu chữ. */
      throw new ForbiddenException(
        'Không có phạm vi cho mã quyền đang thi hành: không vai nào cấp nó ở một mức hệ thực thi được',
      );
    }
    return { subject: { userId, companyIds, siteIds }, level };
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
