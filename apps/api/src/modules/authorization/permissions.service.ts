import { Injectable } from '@nestjs/common';
import { grantInForce } from '../../common/lifecycle/active';
import { PrismaService } from '../../prisma/prisma.service';
import type { PermissionGrant } from './policy.types';
import { permissionMatches } from './policy-evaluator';
import { isEnforcedScope, isScope, type Scope } from './scope.enum';

export interface PermissionMeta {
  code: string;
  wildcardExempt: boolean;
  sensitivity: string;
}

/* The broadest scope level a caller holds. NONE means they hold no usable scope at all
 * and therefore reach no records — which is what someone with no assignment gets.
 *
 * The LEVEL has to be reported, not just "restricted or not". A caller whose reach is
 * meant to stop at specific cemeteries but who has not been given any yet must reach
 * NOTHING; without the level, an empty site list is indistinguishable from "this role is
 * not site-bound", and the safe reading and the dangerous one swap places.
 */
export type ScopeLevel = 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';

/* Phạm vi của MỘT mã quyền: mức, cộng đúng những bản ghi mà mức đó phủ tới.
 *
 * Hai trục không đối xứng, và sự bất đối xứng đó là dữ liệu chứ không phải thiếu sót:
 * `companyIds` bó THEO MÃ (công ty của những dòng gán có grant phủ mã này), còn `siteIds`
 * là danh sách toàn-người-gọi vì `authz.scope_assignments` không có cột vai. Xem chú thích
 * ở `scopeForCode`.
 */
export interface CodeScope {
  /** Mức RỘNG NHẤT trên mã này, ở bất cứ công ty nào. Dùng cho bộ lọc danh sách. */
  level: ScopeLevel;
  companyIds: string[];
  siteIds: string[];
  /* Mức TẠI TỪNG CÔNG TY — mức ở công ty này không nói gì về công ty kia.
   *
   * VÌ SAO KHÔNG ĐỦ NẾU CHỈ CÓ `level` (đo được, 17/09/2026): `level` là hợp trên mọi công
   * ty, và `checkSite` thoát sớm khi mức là COMPANY. Ghép hai điều đó lại thì mức lấy từ
   * công ty A XOÁ phép bó theo nghĩa trang ở công ty B. Người vừa là Thu ngân ở công ty A
   * (COMPANY) vừa là Quản lý nghĩa trang B1 (SITE) chạm được MỌI nghĩa trang của công ty B,
   * kể cả cái họ không phụ trách — và điều đó xảy ra KỂ CẢ khi nơi gọi đã gọi đủ cặp
   * `assertCompanyFor` + `assertSiteFor`, nên không phải lỗi của nơi gọi.
   *
   * Chỉ có COMPANY và SITE ở đây. GROUP không nằm trong bảng này vì nó không gắn với công ty
   * nào — nó là "không giới hạn bản ghi", và `level === 'GROUP'` trả lời câu đó. */
  levelByCompany: Record<string, 'COMPANY' | 'SITE'>;
}

/* Outcome of the ordered rule chain for one code.
 * NO_MATCH means no rule mentioned it, so the role matrix decides.
 */
export type Ruling = 'ALLOW' | 'DENY' | 'NO_MATCH';

export interface EffectiveAccess {
  roles: string[];
  permissions: string[];
  /** Codes a DENY rule blocks for this caller, with no ALLOW ahead of it. */
  denied: string[];
  scope: {
    /** Highest level held on ANY code. For display; per-code decisions use scopeLevelFor. */
    level: ScopeLevel;
    /** A GROUP-scoped grant means "no record restriction" — every company, every site. */
    unrestricted: boolean;
    /** Companies this user is bound to. Empty + not unrestricted = bound to nothing. */
    companyIds: string[];
    /** Cemeteries this user covers (authz.scope_assignments) — the hub axis. */
    siteIds: string[];
  };
}

/* MỘT QUYẾT ĐỊNH, MỘT MỐC THỜI GIAN.
 *
 * Mọi hàm dưới đây nhận `now` ở tham số cuối và chuyền nó xuống, thay vì mỗi chỗ tự gọi
 * `new Date()`. Không phải chuyện gu: một câu trả lời "người này vào được không" thường ghép
 * từ HAI, BA lượt đọc CSDL (grant theo vai, phạm vi theo nghĩa trang, chuỗi luật). Mỗi lượt
 * tự lấy đồng hồ riêng thì giữa chúng có một khoảng thật — đúng bằng thời gian đi và về của
 * lượt đọc trước — và một grant hết hạn CHÍNH TRONG khoảng đó được lượt này tính là còn, lượt
 * kia tính là hết. Chuyện hiếm, nhưng ở tầng quyền thì "hiếm" đọc ra thành một lần cấp quyền
 * không giải thích được, không lặp lại được, không tìm ra được.
 *
 * `now` để MẶC ĐỊNH `new Date()` nên mọi nơi gọi cũ vẫn đúng; chỗ nào ghép nhiều lượt đọc thì
 * lấy mốc một lần ở đầu rồi truyền xuống. Cùng lý do đó, `AccessRulesService.explain` lấy mốc
 * TRƯỚC khi gọi `evaluateRules` và truyền chính mốc ấy vào — máy thử luật phải xét đúng thời
 * điểm mà máy thật xét, nếu không nó là một máy thử nói dối.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /* Effective grants for a user: every role_permission of every role assigned to them,
   * limited to the assignments that are in force right now.
   *
   * Combination rule is UNION — decided by the business owner. Holding two roles adds
   * their rights together; nothing narrows. Note what that does and does not mean: the
   * constitution's "smallest intersection" is about the axes of ONE TRANSACTION (person ∩
   * agent ∩ device ∩ data layer ∩ action ∩ destination), not about how one person's
   * several roles combine. Union across roles is ordinary RBAC.
   *
   * Because nothing narrows, the ordered rule chain is the only remaining brake.
   */
  async getGrants(userId: string, now: Date = new Date()): Promise<PermissionGrant[]> {
    const assignments = await this.activeAssignments(userId, now);
    const grants: PermissionGrant[] = [];
    for (const a of assignments) {
      for (const rp of a.role.rolePermissions) {
        const scopeStr = a.scope ?? rp.scope;
        const scope: Scope = isScope(scopeStr) ? scopeStr : 'CUSTOM';
        grants.push({ permission: rp.permission.code, scope });
      }
    }
    return grants;
  }

  /* Người này có cầm mã `code` không — dùng cho LỚP CHE trường và cho việc ghi nhật ký
   * "bản đầy đủ có rời khỏi hệ hay không".
   *
   * Tách ra thành hàm riêng vì có hai nơi phải trả lời CÙNG một câu hỏi và phải trả lời
   * GIỐNG NHAU: `MaskingInterceptor` quyết che hay không che, còn `CardsService` ghi vào
   * nhật ký rằng thẻ vừa in có CCCD đầy đủ hay không. Hai nơi tự kiểm thì sẽ có ngày một
   * bên nói che còn bên kia ghi là không che — và nhật ký sai còn tệ hơn không có nhật ký.
   *
   * FAIL CLOSED: mã không có trong danh mục trả về false, tức là VẪN CHE.
   *
   * GIỚI HẠN CÓ CHỦ ĐÍCH: hàm này KHÔNG đi qua chuỗi luật truy cập (`evaluateRules`), khác
   * với `scopeLevelFor`. Giữ nguyên hành vi vốn có của lớp che — một luật DENY hiện không
   * che thêm trường nào. Đổi điều đó là một quyết định riêng, không phải hệ quả phụ của
   * việc gom hai chỗ kiểm về một chỗ.
   */
  async holdsForMasking(userId: string, code: string): Promise<boolean> {
    const now = new Date();
    const meta = await this.getPermissionMeta(code);
    if (meta === null) {
      return false;
    }
    const grants = await this.getGrants(userId, now);
    return grants.some((g) =>
      permissionMatches(g.permission, code, { wildcardExempt: meta.wildcardExempt }),
    );
  }

  /* Scope level for ONE code — union across the grants that actually cover that code.
   *
   * Union has to be computed per code, never once for the whole caller. A single global
   * "widest level" leaks: someone holding a group-wide read-only audit role alongside a
   * company-level operational role would get group reach on the OPERATIONAL codes too,
   * which the audit role never granted them. Union means "add up what each role gives",
   * not "take the widest thing you hold anywhere and apply it everywhere".
   */
  async scopeLevelFor(userId: string, code: string, now: Date = new Date()): Promise<ScopeLevel> {
    return (await this.grantScopeForCode(userId, code, now)).level;
  }

  /* Phạm vi ĐẦY ĐỦ cho MỘT mã: mức, VÀ những công ty mà mã đó thật sự với tới.
   *
   * VÌ SAO PHẢI TRẢ CẢ HAI CÙNG MỘT LƯỢT (đo được, 16/09/2026):
   *
   * `scopeLevelFor` đã tính mức THEO MÃ từ lâu, nhưng nơi gọi nó — `ScopeService.loadFor` —
   * lại lấy danh sách công ty từ `getEffectiveAccess`, vốn gom `companyId` của MỌI dòng gán
   * còn hiệu lực, bất kể vai đó có cấp mã đang thi hành hay không. Ghép một mức bó theo mã
   * với một danh sách bó theo NGƯỜI thì phần bó chặt bị phần bó lỏng vô hiệu.
   *
   * Hậu quả cụ thể: người vừa là quản lý nghĩa trang ở công ty A vừa là nhân viên kinh doanh
   * ở công ty B dùng được `cemetery.plot.update` sang công ty B — bằng một mã mà vai kinh
   * doanh không hề cấp. Đúng lớp lỗi đã vá cho trục nghĩa trang hôm 27/08, chỉ khác trục.
   *
   * Trả hai giá trị từ MỘT hàm, với MỘT mốc `now` — để không còn chỗ nào ghép được mức của
   * lượt này với danh sách của lượt kia. (Không phải một lượt ĐỌC: bên trong vẫn có chuỗi
   * luật, danh mục và bảng gán, cộng bảng nghĩa trang chạy song song. Thứ được gom về một là
   * QUYẾT ĐỊNH và MỐC THỜI GIAN, không phải số truy vấn.)
   *
   * GIỚI HẠN CÓ THẬT, KHÔNG SỬA ĐƯỢC Ở TẦNG NÀY: `siteIds` vẫn là danh sách toàn-người-gọi.
   * Bảng `authz.scope_assignments` gắn NGƯỜI với NGHĨA TRANG và KHÔNG có cột vai — xem chú
   * thích thiết kế ở `schema.prisma`, chỗ nói rõ tách khỏi vai là có chủ đích. Nên dữ liệu
   * để bó trục nghĩa trang theo mã đơn giản là KHÔNG TỒN TẠI; bó được nó đòi thêm cột +
   * migration + một quyết định nghiệp vụ ("nghĩa trang gán cho người, hay gán cho vai-của-
   * người") đảo ngược chính chú thích đó. Tên trường để nguyên là `siteIds` chứ không đổi
   * thành thứ nghe như đã bó, để người đọc sau không tin nhầm.
   */
  async scopeForCode(userId: string, code: string, now: Date = new Date()): Promise<CodeScope> {
    const [byGrant, sites] = await Promise.all([
      this.grantScopeForCode(userId, code, now),
      this.prisma.scopeAssignment.findMany({
        where: { userId, ...grantInForce(now) },
        select: { cemeteryId: true },
      }),
    ]);
    return { ...byGrant, siteIds: sites.map((s) => s.cemeteryId).sort() };
  }

  /* Mức và công ty, tính từ CHÍNH những dòng gán phủ mã này — lõi dùng chung, khai một lần.
   *
   * `scopeLevelFor` là vỏ mỏng của hàm này thay vì một vòng lặp thứ hai: hai vòng lặp trên
   * cùng một câu hỏi là hai thứ sẽ lệch nhau. Nó cũng KHÔNG đọc `scope_assignments`, nên ba
   * nơi chỉ cần mức không phải trả giá cho một lượt đọc chúng không dùng.
   *
   * Điều kiện cộng một công ty vào tập là `covers` — dòng gán đó phải có ít nhất một grant
   * phủ mã. Dòng `companyId = null` đóng góp đúng số không, giữ nguyên nếp cũ: được gán vào
   * không công ty nào thì không bao giờ có nghĩa là mọi công ty.
   */
  private async grantScopeForCode(
    userId: string,
    code: string,
    now: Date,
  ): Promise<{
    level: ScopeLevel;
    companyIds: string[];
    levelByCompany: Record<string, 'COMPANY' | 'SITE'>;
  }> {
    const ruling = await this.evaluateRules(userId, code, now);
    if (ruling === 'DENY') {
      return { level: 'NONE', companyIds: [], levelByCompany: {} };
    }
    const [meta, assignments] = await Promise.all([
      this.getPermissionMeta(code),
      this.activeAssignments(userId, now),
    ]);
    let level: ScopeLevel = 'NONE';
    const companyIds = new Set<string>();
    const levelByCompany: Record<string, 'COMPANY' | 'SITE'> = {};
    for (const a of assignments) {
      let covers = false;
      /* Mức của RIÊNG dòng gán này, tách khỏi `level` chung: `level` là hợp trên mọi công ty
       * và dùng cho bộ lọc danh sách, còn cái này là thứ đi vào `levelByCompany`. */
      let assignmentLevel: ScopeLevel = 'NONE';
      for (const rp of a.role.rolePermissions) {
        const matches = permissionMatches(rp.permission.code, code, {
          ...(meta === null ? {} : { wildcardExempt: meta.wildcardExempt }),
        });
        if (!matches) {
          continue;
        }
        /* Cùng luật ưu tiên với `getGrants`: phạm vi ghi đè trên DÒNG GÁN thắng phạm vi mặc
         * định của vai. `broader` ép mọi chuỗi ngoài GROUP/COMPANY/SITE về `NONE`, đúng như
         * nhánh `isScope` của `getGrants` rồi cũng cho ra `NONE`. */
        const granted = a.scope ?? rp.scope;
        /* PHỦ MÃ THÔI CHƯA ĐỦ — phạm vi của chính grant đó phải là thứ hệ THỰC THI được.
         *
         * Bản đầu bật `covers` ngay khi mã khớp, không hỏi phạm vi. Hậu quả đi NGƯỢC ý người
         * ghi: một dòng gán mang `scope = 'DEPARTMENT'` (hệ không thực thi, `broader` ném về
         * `NONE`) vẫn góp `companyId` của nó vào tập. Người vừa giữ vai đó ở công ty A vừa
         * giữ một vai mức COMPANY ở công ty B sẽ có `level = COMPANY` và `companyIds =
         * [A, B]` — tức công ty A KHÔNG bị thu hẹp mà còn được với tới ở mức COMPANY, rộng
         * hơn cả trước khi ai đó gõ `DEPARTMENT` vào ô phạm vi.
         *
         * Cột `role_assignments.scope` không có đường GHI nào trong sản xuất, nên chỉ tới
         * được qua seed, migration hay `psql` — đúng những kênh mà chú thích ở `scope.service
         * .ts` đã thừa nhận là vẫn mở, và là lý do cổng `NONE` vẫn cần tồn tại. */
        if (!isEnforcedScope(granted)) {
          continue;
        }
        covers = true;
        level = broader(level, granted);
        assignmentLevel = broader(assignmentLevel, granted);
      }
      if (covers && a.companyId !== null) {
        companyIds.add(a.companyId);
        /* Mức TẠI công ty này = mức rộng nhất trong các dòng gán của CHÍNH công ty này.
         * `broader` đã gom `assignmentLevel` qua mọi grant phủ mã của dòng gán đó; ở đây chỉ
         * còn so với mức đã ghi cho cùng công ty từ một dòng gán khác. GROUP không vào bảng
         * này — nó không gắn công ty nào, và `level === 'GROUP'` đã trả lời câu đó. */
        if (assignmentLevel === 'COMPANY' || assignmentLevel === 'SITE') {
          const truoc = levelByCompany[a.companyId];
          if (truoc === undefined || (truoc === 'SITE' && assignmentLevel === 'COMPANY')) {
            levelByCompany[a.companyId] = assignmentLevel;
          }
        }
      }
    }
    return { level, companyIds: [...companyIds].sort(), levelByCompany };
  }

  /* Walk the ordered rule chain for one code — firewall semantics.
   *
   * Rules are evaluated by ascending priority, and the FIRST one that matches decides;
   * evaluation stops there. Nothing matched means NO_MATCH, and the role matrix answers
   * instead. Nothing granted after that means 403 — the implicit "deny all" at the end
   * of the chain, which PermissionGuard provides by refusing anything it was not told
   * to allow.
   *
   * Consequence worth being explicit about: an ALLOW rule sits ABOVE the role matrix, so
   * it can permit something no role grants — including a wildcard-exempt leaf. That is
   * inherent to an ordered rule list, which is why every rule carries a reason and why
   * the chain is printable in evaluation order.
   */
  async evaluateRules(userId: string, code: string, now: Date = new Date()): Promise<Ruling> {
    const [rules, roles] = await Promise.all([
      this.prisma.accessRule.findMany({
        where: {
          /* Luật NHẮM ĐÍCH DANH người này, hoặc luật áp cho mọi người (`subjectUserId: null`).
           * Khoá `OR` này là của RIÊNG mệnh đề trên, nên cửa sổ hiệu lực phải vào `AND` chứ
           * KHÔNG trải ra: `grantInForce` cũng mang một khoá `OR`, và hai khoá `OR` trong cùng
           * một object thì khoá sau đè khoá trước — mất im lặng một nửa điều kiện, không lỗi,
           * không cảnh báo. Ở tầng quyền thì "mất im lặng" nghĩa là luật DENY hết hạn vẫn chặn,
           * hoặc luật ALLOW đã hết hạn vẫn mở. Xem chú thích BẪY ở `common/lifecycle/active.ts`. */
          OR: [{ subjectUserId: userId }, { subjectUserId: null }],
          AND: [grantInForce(now)],
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      }),
      this.roleCodesOf(userId, now),
    ]);

    for (const rule of rules) {
      if (rule.roleCode !== null && !roles.includes(rule.roleCode)) {
        continue;
      }
      if (!permissionMatches(rule.permissionCode, code)) {
        continue;
      }
      return rule.effect === 'ALLOW' ? 'ALLOW' : 'DENY';
    }
    return 'NO_MATCH';
  }

  /** True when the rule chain lands on DENY for this code. */
  async isDenied(userId: string, code: string): Promise<boolean> {
    return (await this.evaluateRules(userId, code)) === 'DENY';
  }

  /** Codes the chain currently blocks, evaluated against the catalog the caller holds. */
  private async deniedAmong(userId: string, codes: string[], now: Date): Promise<string[]> {
    const out: string[] = [];
    for (const code of codes) {
      if ((await this.evaluateRules(userId, code, now)) === 'DENY') {
        out.push(code);
      }
    }
    return out.sort();
  }

  private async roleCodesOf(userId: string, now: Date = new Date()): Promise<string[]> {
    const assignments = await this.activeAssignments(userId, now);
    return [...new Set(assignments.map((a) => a.role.code))];
  }

  /* Catalog metadata for one code, or null when the code is not in the catalog at all.
   *
   * Read on every request on purpose — no cache. A revoked right has to stop working
   * immediately; OPERA's equivalent can take minutes to propagate and that is a property
   * to beat, not to copy. If a cache is ever added it needs a very short TTL and must
   * never hold a sensitive leaf (doc 16 §B.3).
   */
  async getPermissionMeta(code: string): Promise<PermissionMeta | null> {
    const row = await this.prisma.permission.findUnique({
      where: { code },
      select: { code: true, wildcardExempt: true, sensitivity: true },
    });
    return row;
  }

  /* Everything the UI and the pickers need, in one round trip.
   *
   * Deliberately derived here rather than trusted from the client: the web app used to
   * ask the user to type a companyId, which is the same as letting the caller choose
   * their own scope. The lists below are what the server is willing to accept from them.
   */
  async getEffectiveAccess(userId: string, now: Date = new Date()): Promise<EffectiveAccess> {
    /* MỘT mốc cho CẢ HAI trục. Trước đây `now` ở đây chỉ đi vào trục NGHĨA TRANG, còn trục
     * VAI đi qua `activeAssignments()` và hàm đó tự gọi `new Date()` của riêng nó — một quyết
     * định, hai đồng hồ, lệch nhau đúng một vòng gọi CSDL. */
    const [assignments, sites] = await Promise.all([
      this.activeAssignments(userId, now),
      this.prisma.scopeAssignment.findMany({
        where: { userId, ...grantInForce(now) },
        select: { cemeteryId: true },
      }),
    ]);

    const roles = new Set<string>();
    const permissions = new Set<string>();
    const companyIds = new Set<string>();
    let level: ScopeLevel = 'NONE';

    for (const a of assignments) {
      roles.add(a.role.code);
      for (const rp of a.role.rolePermissions) {
        permissions.add(rp.permission.code);
        level = broader(level, a.scope ?? rp.scope);
      }
      if (a.companyId !== null) {
        companyIds.add(a.companyId);
      }
    }

    // A blocked code must not be advertised to the UI as something the caller holds.
    const denied = await this.deniedAmong(userId, [...permissions], now);
    const denySet = new Set(denied);

    return {
      roles: [...roles].sort(),
      permissions: [...permissions].filter((c) => !denySet.has(c)).sort(),
      denied,
      scope: {
        level,
        unrestricted: level === 'GROUP',
        companyIds: [...companyIds].sort(),
        siteIds: sites.map((s) => s.cemeteryId).sort(),
      },
    };
  }

  /* Assignments in force at `now`. An expired grant simply stops existing — nobody has
   * to remember to go and revoke it, which is the entire point of having a `valid_to`.
   *
   * Nhận mốc của NGƯỜI GỌI thay vì tự lấy: xem chú thích "MỘT QUYẾT ĐỊNH, MỘT MỐC THỜI GIAN"
   * ở đầu lớp.
   */
  private activeAssignments(userId: string, now: Date = new Date()) {
    return this.prisma.roleAssignment.findMany({
      where: { userId, ...grantInForce(now) },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });
  }
}

// Union rule: the widest scope among the grants that cover the code in question.
const RANK: Record<string, number> = { NONE: 0, SITE: 1, COMPANY: 2, GROUP: 3 };

function broader(current: ScopeLevel, candidate: string): ScopeLevel {
  // Cùng danh sách mà đường GHI dùng để từ chối (`AuthzMatrixService.grant`), nên không có
  // chuyện một mức ghi được vào nhưng đọc ra thành `NONE`.
  const next: ScopeLevel = isEnforcedScope(candidate) ? candidate : 'NONE';
  return (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : current;
}
