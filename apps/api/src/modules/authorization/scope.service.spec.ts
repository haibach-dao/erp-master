import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ScopeService } from './scope.service';
import { PermissionsService } from './permissions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { PolicyEvaluator } from './policy-evaluator';

function build(scope: {
  level: 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';
  companyIds: string[];
  siteIds?: string[];
}) {
  /* Ở nhóm test này, mọi mã có cùng một phạm vi — nên chúng kiểm đúng phần NGỮ NGHĨA của
   * từng mức (GROUP với tới tất, COMPANY bó theo công ty, SITE bó theo nghĩa trang, NONE
   * không với tới gì), không lẫn với phần "mã này khác mã kia". Trường hợp các mã LỆCH
   * nhau có `buildPerCode` lo, còn việc danh sách công ty có thật sự bó theo mã hay không
   * thì nhóm cuối file lo — nhóm đó chạy `PermissionsService` THẬT, vì đó là chỗ nối giữa
   * hai lớp và cũng đúng là chỗ đã rò. */
  const permissions = {
    scopeForCode: vi.fn().mockResolvedValue({
      level: scope.level,
      companyIds: scope.companyIds,
      siteIds: scope.siteIds ?? [],
      /* Mức TẠI TỪNG công ty. Ở nhóm test này mọi công ty cùng một mức, nên bảng này suy
       * thẳng từ `scope.level` — đúng cái nhóm test này muốn kiểm (ngữ nghĩa của từng mức),
       * còn chuyện hai công ty LỆCH mức thì nhóm cuối file lo, trên `PermissionsService` thật. */
      levelByCompany: Object.fromEntries(
        scope.companyIds.map((c) => [c, scope.level === 'SITE' ? 'SITE' : 'COMPANY']),
      ),
    }),
  } as unknown as PermissionsService;
  return new ScopeService(permissions, new PolicyEvaluator());
}

/* Mã quyền dùng cho nhóm test ngữ nghĩa phạm vi. Giá trị cụ thể không quan trọng ở đây —
 * `build` cấp cùng một mức cho mọi mã — nhưng PHẢI có mã: thiếu mã là bị từ chối. */
const CODE = 'cemetery.plot.view';

const BOUND_TO_A = { level: 'COMPANY' as const, companyIds: ['co-a'] };
const UNRESTRICTED = { level: 'GROUP' as const, companyIds: [] };

describe('ScopeService.assertCompanyFor — the caller no longer picks their own scope', () => {
  it('allows a company the caller is bound to', async () => {
    await expect(build(BOUND_TO_A).assertCompanyFor('u1', CODE, 'co-a')).resolves.toBeUndefined();
  });

  it('REFUSES another company — the cross-company read that used to work', async () => {
    await expect(build(BOUND_TO_A).assertCompanyFor('u1', CODE, 'co-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses with 403 rather than returning an empty list', async () => {
    // An empty result would claim "there is nothing here", which is a different and
    // misleading statement, and it hides the attempt from anyone reading the logs.
    await expect(build(BOUND_TO_A).assertCompanyFor('u1', CODE, 'co-b')).rejects.toThrow(
      /Ngoài phạm vi/,
    );
  });

  it('refuses an unbounded query from a company-bound caller', async () => {
    await expect(build(BOUND_TO_A).assertCompanyFor('u1', CODE, null)).rejects.toThrow(
      /chỉ rõ công ty/,
    );
    await expect(build(BOUND_TO_A).assertCompanyFor('u1', CODE, '')).rejects.toThrow(
      /chỉ rõ công ty/,
    );
  });

  it('lets a GROUP caller through for any company, including none', async () => {
    const svc = build(UNRESTRICTED);
    await expect(svc.assertCompanyFor('u1', CODE, 'co-a')).resolves.toBeUndefined();
    await expect(svc.assertCompanyFor('u1', CODE, 'co-z')).resolves.toBeUndefined();
    await expect(svc.assertCompanyFor('u1', CODE, null)).resolves.toBeUndefined();
  });

  it('refuses an unauthenticated caller before consulting any scope', async () => {
    await expect(build(BOUND_TO_A).assertCompanyFor(null, CODE, 'co-a')).rejects.toThrow(
      /Chưa xác thực/,
    );
  });

  it('a caller bound to nothing reaches nothing', async () => {
    const svc = build({ level: 'NONE', companyIds: [] });
    await expect(svc.assertCompanyFor('u1', CODE, 'co-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('ScopeService.visibleCompanyIds — what the picker may offer', () => {
  it('returns the bound companies', async () => {
    await expect(build(BOUND_TO_A).visibleCompanyIdsFor('u1', CODE)).resolves.toEqual(['co-a']);
  });

  it('returns null for a GROUP caller, meaning no restriction', async () => {
    await expect(build(UNRESTRICTED).visibleCompanyIdsFor('u1', CODE)).resolves.toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(build(BOUND_TO_A).visibleCompanyIdsFor(null, CODE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('ScopeService.assertSite — the hub axis', () => {
  const COVERS_ONE = { level: 'SITE' as const, companyIds: ['co-a'], siteIds: ['ct-1'] };

  it('allows a cemetery the caller covers', async () => {
    await expect(
      build(COVERS_ONE).assertPlotFor('u1', CODE, 'co-a', 'ct-1'),
    ).resolves.toBeUndefined();
  });

  it('refuses a cemetery the caller does not cover, even inside their own company', async () => {
    await expect(build(COVERS_ONE).assertPlotFor('u1', CODE, 'co-a', 'ct-2')).rejects.toThrow(
      /không phụ trách/,
    );
  });

  it('covering several cemeteries at once is normal, not an exception', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: ['ct-1', 'ct-9'] });
    await expect(svc.assertPlotFor('u1', CODE, 'co-a', 'ct-1')).resolves.toBeUndefined();
    await expect(svc.assertPlotFor('u1', CODE, 'co-a', 'ct-9')).resolves.toBeUndefined();
  });

  it('assigned to no cemetery reaches none of them — not all of them', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: [] });
    await expect(svc.assertPlotFor('u1', CODE, 'co-a', 'ct-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a GROUP caller is unrestricted here too', async () => {
    await expect(
      build(UNRESTRICTED).assertPlotFor('u1', CODE, 'co-a', 'ct-1'),
    ).resolves.toBeUndefined();
  });
});

/* The trap this level exists to close: a role that is MEANT to stop at specific
 * cemeteries, whose hub rows have not been created yet. Without a level, an empty site
 * list is indistinguishable from "this role is not site-bound", and the fail-safe and
 * fail-open readings swap places.
 */
describe('ScopeService.listSiteFilter — narrowing list queries', () => {
  it('narrows a site-bound caller to their own cemeteries', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: ['ct-1'] });
    await expect(svc.listSiteFilterFor('u1', CODE)).resolves.toEqual(['ct-1']);
  });

  it('narrows a site-bound caller with no cemeteries to NOTHING, not to everything', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: [] });
    await expect(svc.listSiteFilterFor('u1', CODE)).resolves.toEqual([]);
  });

  it('does not narrow a company-bound caller — they cover their whole company', async () => {
    await expect(build(BOUND_TO_A).listSiteFilterFor('u1', CODE)).resolves.toBeNull();
  });

  it('does not narrow a GROUP caller', async () => {
    await expect(build(UNRESTRICTED).listSiteFilterFor('u1', CODE)).resolves.toBeNull();
  });
});

/* ---- Phạm vi THEO MÃ QUYỀN ----
 *
 * Đây là chỗ bản "theo mức toàn-người-gọi" để lọt, và là tình huống chủ doanh nghiệp nêu
 * ngày 27/08/2026: người phụ trách nghĩa trang A không được chạm nghĩa trang B, nhưng nếu
 * được gán thêm vai phụ trách B thì phải chạm được.
 */
/* KHÔNG CÒN trường `callerLevel` ở đây, và sự vắng mặt đó là có ý.
 *
 * Bản trước có nó để mô phỏng "mức RỘNG NHẤT người này giữ ở bất cứ đâu" — thứ `loadFor`
 * từng đọc. Nay `ScopeService` không còn một đường nào chạm tới mức toàn-người-gọi:
 * `getEffectiveAccess` đã rời khỏi `loadFor`. Không còn gì để mô phỏng, nên không còn
 * trường. Đó là bằng chứng bằng CẤU TRÚC — mạnh hơn canh bằng test, vì muốn tái lập lỗ cũ
 * thì phải thêm lại cả một lời gọi, chứ không phải lỡ tay đổi một giá trị.
 */
function buildPerCode(opts: {
  /** Mức thật sự cấp cho TỪNG MÃ. */
  perCode: Record<string, 'GROUP' | 'COMPANY' | 'SITE' | 'NONE'>;
  companyIds: string[];
  siteIds: string[];
}) {
  const permissions = {
    scopeForCode: vi.fn().mockImplementation((_u: string, code: string) => {
      const muc = opts.perCode[code] ?? 'NONE';
      return Promise.resolve({
        level: muc,
        companyIds: opts.companyIds,
        siteIds: opts.siteIds,
        levelByCompany: Object.fromEntries(
          opts.companyIds.map((c) => [c, muc === 'SITE' ? 'SITE' : 'COMPANY']),
        ),
      });
    }),
  } as unknown as PermissionsService;
  return new ScopeService(permissions, new PolicyEvaluator());
}

/* Người vừa là quản lý nghĩa trang A (SITE) vừa là kiểm toán nội bộ toàn tập đoàn (GROUP,
 * CHỈ ĐỌC). Mức toàn-người-gọi của họ là GROUP; mức cho `burial.record.cancel` là SITE, vì
 * vai kiểm toán không hề cấp mã đó. */
const KIEM_TOAN_KIEM_QUAN_LY = {
  perCode: {
    'burial.record.cancel': 'SITE' as const,
    'burial.record.export': 'GROUP' as const,
  },
  companyIds: ['co-a'],
  siteIds: ['nt-A'],
};

describe('phạm vi theo MÃ QUYỀN — hợp giữa các vai cộng dồn QUYỀN, không cộng dồn TẦM VỚI', () => {
  /* Trước đây ở đây có một test giữ chỗ cho LỖ của bản cũ (`assertSite` đọc mức toàn-người-
   * gọi nên cho qua nghĩa trang B). Bản cũ ĐÃ BỊ XOÁ khỏi `ScopeService` — không còn hàm
   * nào để gọi, nên lỗ đó không tái diễn được bằng cấu trúc, mạnh hơn là canh bằng test.
   * Muốn kiểm phạm vi mà không có mã quyền thì bị TỪ CHỐI, xem test cuối nhóm này. */

  it('bản theo mã CHẶN nghĩa trang B trên `burial.record.cancel`', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.assertPlotFor('u1', 'burial.record.cancel', 'co-a', 'nt-B')).rejects.toThrow(
      /không phụ trách nghĩa trang này/,
    );
  });

  it('vẫn cho qua nghĩa trang A — vai được gán tới đâu thì với tới đó', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(
      svc.assertPlotFor('u1', 'burial.record.cancel', 'co-a', 'nt-A'),
    ).resolves.toBeUndefined();
  });

  it('được gán thêm vai phụ trách B thì chạm được B', async () => {
    const svc = buildPerCode({ ...KIEM_TOAN_KIEM_QUAN_LY, siteIds: ['nt-A', 'nt-B'] });
    await expect(
      svc.assertPlotFor('u1', 'burial.record.cancel', 'co-a', 'nt-B'),
    ).resolves.toBeUndefined();
  });

  it('mã mà vai kiểm toán THẬT SỰ cấp ở mức GROUP thì vẫn với tới cả tập đoàn', async () => {
    // Không phải "chặn tất cho chắc": quyền đọc toàn tập đoàn là thứ vai đó có thật.
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(
      svc.assertPlotFor('u1', 'burial.record.export', 'co-a', 'nt-B'),
    ).resolves.toBeUndefined();
  });

  it('thiếu mã quyền thì TỪ CHỐI, không rơi về mức toàn-người-gọi', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.assertPlotFor('u1', null, 'co-a', 'nt-A')).rejects.toThrow(
      /Không xác định được mã quyền/,
    );
    await expect(svc.assertCompanyFor('u1', undefined, 'co-a')).rejects.toThrow(
      /Không xác định được mã quyền/,
    );
  });

  it('bó danh sách theo mã: SITE trên mã này thì chỉ thấy nghĩa trang được gán', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.listSiteFilterFor('u1', 'burial.record.cancel')).resolves.toEqual(['nt-A']);
    // Cùng người, mã khác, mức khác — không bó.
    await expect(svc.listSiteFilterFor('u1', 'burial.record.export')).resolves.toBeNull();
  });

  it('công ty cũng theo mã: GROUP trên mã đó mới là không giới hạn', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.visibleCompanyIdsFor('u1', 'burial.record.cancel')).resolves.toEqual(['co-a']);
    await expect(svc.visibleCompanyIdsFor('u1', 'burial.record.export')).resolves.toBeNull();
    await expect(svc.assertCompanyFor('u1', 'burial.record.cancel', 'co-b')).rejects.toThrow(
      /Ngoài phạm vi/,
    );
  });
});

/* ---- Mức NONE: không phạm vi nào, nên không với tới bản ghi nào ----
 *
 * `NONE` KHÔNG phải một mức hẹp hơn `SITE`. Nó là câu "mã này không được cấp phạm vi nào",
 * và chỉ sinh ra từ ba nguồn: chuỗi luật truy cập trả DENY, không vai nào phủ mã đó, hoặc
 * grant mang một scope mà `broader()` không thực thi được (cột `role_permission.scope` mặc
 * định là `DEPARTMENT`, và màn hình ma trận cấp được cả SELF/ASSIGNED/CUSTOM).
 *
 * VÌ SAO NHÓM TEST NÀY PHẢI DỰNG `companyIds` KHÁC RỖNG: ca `NONE` duy nhất có trước nó
 * (`a caller bound to nothing reaches nothing`) dựng `companyIds: []`, nên nó xanh vì DANH
 * SÁCH RỖNG chứ không vì mức `NONE` bị chặn — `PolicyEvaluator.includes` từ chối mọi thứ
 * khi tập rỗng. Hình dạng THẬT của người bị luật DENY chặn một mã là: vẫn được gán vai ở
 * công ty A, vẫn có dòng phụ trách nghĩa trang, nhưng mức cho MÃ ĐÓ là `NONE`. Ca đó chưa
 * từng được dựng, và đó là lý do lỗ này sống sót qua mọi lần chạy test.
 */
const BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN = {
  perCode: {
    'cemetery.plot.view': 'NONE' as const,
    'cemetery.plot.update': 'COMPANY' as const,
  },
  companyIds: ['co-a'],
  siteIds: ['ct-1'],
};

describe('mức NONE — không được xử như COMPANY hay như SITE', () => {
  it('assertCompanyFor: từ chối CHÍNH công ty người đó được gán', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(svc.assertCompanyFor('u1', 'cemetery.plot.view', 'co-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('assertPlotFor: từ chối CHÍNH nghĩa trang người đó phụ trách', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(
      svc.assertPlotFor('u1', 'cemetery.plot.view', 'co-a', 'ct-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('visibleCompanyIdsFor: KHÔNG trả danh sách công ty cho một mã không có phạm vi', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(svc.visibleCompanyIdsFor('u1', 'cemetery.plot.view')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /* Chỗ rò RỘNG NHẤT trong bốn hàm: `null` ở đây nghĩa là "không bó theo nghĩa trang nào".
   * Một mã bị luật DENY chặn mà vẫn nhận `null` thì truy vấn danh sách chạy không một mệnh
   * đề lọc nào — người bị chặn đọc được NHIỀU HƠN người chỉ bị bó theo nghĩa trang. */
  it('listSiteFilterFor: KHÔNG trả null (tức không-bó) cho một mã không có phạm vi', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(svc.listSiteFilterFor('u1', 'cemetery.plot.view')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  /* Câu báo lỗi phải PHÂN BIỆT ĐƯỢC với hai câu của `checkCompany`/`checkSite`, không chỉ
   * khác vài chữ cuối. Hai câu kia nói "bản ghi này nằm ngoài phần bạn được giao"; câu này
   * nói "mã quyền của bạn không được giao phần nào cả" — người đọc log phải tách được hai
   * nguyên nhân bằng chính câu chữ. Bản đầu của lát này mở đầu bằng NGUYÊN VĂN tiền tố
   * `Ngoài phạm vi được gán:` nên ca test cũ tự nhận là canh sự phân biệt mà thật ra không
   * canh được gì; một lượt soi độc lập bắt được, và câu lỗi đã đổi. */
  it('nói rõ lý do là KHÔNG CÓ PHẠM VI, và KHÔNG mang tiền tố "Ngoài phạm vi được gán"', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(svc.assertCompanyFor('u1', 'cemetery.plot.view', 'co-a')).rejects.toThrow(
      /Không có phạm vi cho mã quyền đang thi hành/,
    );
    await expect(svc.assertCompanyFor('u1', 'cemetery.plot.view', 'co-a')).rejects.not.toThrow(
      /^Ngoài phạm vi được gán/,
    );
  });

  /* Phép canh này TỪNG nằm ở ca `a caller bound to nothing reaches nothing`, và cổng `NONE`
   * mới đã vô tình bịt mất nó: ca đó dựng `{ level: 'NONE', companyIds: [] }`, nên từ nay nó
   * dừng ở cổng `NONE` và không còn chạm tới `PolicyEvaluator` nữa. Nghĩa là nếu ai đó sửa
   * `checkCompany` thành "danh sách rỗng = không giới hạn" thì KHÔNG một test nào đỏ.
   *
   * Dựng lại ở mức COMPANY — mức đi qua được cổng `NONE` — để câu "được gán vào không công
   * ty nào thì không bao giờ có nghĩa là mọi công ty" vẫn có người canh. */
  it('mức COMPANY với danh sách công ty RỖNG vẫn với tới KHÔNG công ty nào', async () => {
    const svc = buildPerCode({
      perCode: { 'cemetery.plot.view': 'COMPANY' },
      companyIds: [],
      siteIds: [],
    });
    await expect(svc.assertCompanyFor('u1', 'cemetery.plot.view', 'co-a')).rejects.toThrow(
      /công ty này không thuộc quyền của bạn/,
    );
    await expect(svc.visibleCompanyIdsFor('u1', 'cemetery.plot.view')).resolves.toEqual([]);
  });

  /* Không phải "chặn tất cho chắc": cùng người, cùng công ty, mã KHÁC có phạm vi thật thì
   * vẫn phải đi qua. Thiếu ca này thì một bản vá chặn sạch mọi thứ cũng xanh. */
  it('mã khác của CHÍNH người đó, có phạm vi thật, vẫn đi qua', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(
      svc.assertCompanyFor('u1', 'cemetery.plot.update', 'co-a'),
    ).resolves.toBeUndefined();
    await expect(svc.visibleCompanyIdsFor('u1', 'cemetery.plot.update')).resolves.toEqual(['co-a']);
  });
});

/* ---- Trục CÔNG TY phải bó THEO MÃ, không phải theo người ----
 *
 * Nhóm test này KHÔNG mock `PermissionsService`. Nó dựng bản THẬT trên một Prisma giả, vì
 * lỗ nằm đúng ở CHỖ NỐI giữa hai lớp: `ScopeService` hỏi mức theo mã, còn danh sách công ty
 * thì lấy từ `getEffectiveAccess`, vốn gom `companyId` của MỌI dòng gán bất kể vai đó có
 * cấp mã đang thi hành hay không. Mỗi lớp kiểm riêng đều xanh; chỗ nối mới là chỗ rò.
 *
 * Tình huống thật: một người vừa là quản lý nghĩa trang ở công ty A, vừa là nhân viên kinh
 * doanh ở công ty B. Vai quản lý cấp `cemetery.plot.update`; vai kinh doanh KHÔNG cấp mã đó.
 * Hợp giữa các vai là cộng dồn QUYỀN, không phải cộng dồn TẦM VỚI.
 */
function buildTwoRolesTwoCompanies() {
  const assignments = [
    {
      scope: null,
      companyId: 'co-a',
      role: {
        code: 'QL_NGHIA_TRANG',
        rolePermissions: [
          { scope: 'COMPANY', permission: { code: 'cemetery.plot.update' } },
          { scope: 'COMPANY', permission: { code: 'crm.customer.view' } },
        ],
      },
    },
    {
      scope: null,
      companyId: 'co-b',
      role: {
        code: 'KD_KINH_DOANH',
        rolePermissions: [{ scope: 'COMPANY', permission: { code: 'crm.customer.view' } }],
      },
    },
  ];
  const permissions = new PermissionsService({
    roleAssignment: { findMany: vi.fn().mockResolvedValue(assignments) },
    scopeAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    accessRule: { findMany: vi.fn().mockResolvedValue([]) },
    permission: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaService);
  return new ScopeService(permissions, new PolicyEvaluator());
}

describe('trục CÔNG TY bó theo MÃ QUYỀN — vai nào cấp mã thì với tới công ty của vai đó', () => {
  it('CHẶN công ty B trên mã mà chỉ vai ở công ty A cấp', async () => {
    const svc = buildTwoRolesTwoCompanies();
    await expect(svc.assertCompanyFor('u1', 'cemetery.plot.update', 'co-b')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('vẫn cho qua công ty A trên chính mã đó', async () => {
    const svc = buildTwoRolesTwoCompanies();
    await expect(
      svc.assertCompanyFor('u1', 'cemetery.plot.update', 'co-a'),
    ).resolves.toBeUndefined();
  });

  it('mã mà CẢ HAI vai cùng cấp thì với tới cả hai công ty — không phải chặn bớt cho chắc', async () => {
    const svc = buildTwoRolesTwoCompanies();
    await expect(svc.assertCompanyFor('u1', 'crm.customer.view', 'co-a')).resolves.toBeUndefined();
    await expect(svc.assertCompanyFor('u1', 'crm.customer.view', 'co-b')).resolves.toBeUndefined();
  });

  it('danh sách công ty cho bộ lọc cũng bó theo mã', async () => {
    const svc = buildTwoRolesTwoCompanies();
    await expect(svc.visibleCompanyIdsFor('u1', 'cemetery.plot.update')).resolves.toEqual(['co-a']);
    await expect(svc.visibleCompanyIdsFor('u1', 'crm.customer.view')).resolves.toEqual([
      'co-a',
      'co-b',
    ]);
  });
});

/* ---- MỨC phải gắn với CÔNG TY, không phải một con số toàn cục ----
 *
 * Lỗ còn lại sau lượt 16/09: `grantScopeForCode` trả MỘT `level` = mức rộng nhất trong các
 * vai phủ mã, rồi `checkSite` thoát sớm khi mức là COMPANY. Hai điều đó cộng lại nghĩa là
 * mức lấy từ công ty NÀY xoá phép bó theo nghĩa trang ở công ty KIA.
 *
 * Người trong test: mức COMPANY ở công ty A (ví dụ Thu ngân), mức SITE ở công ty B (Quản lý
 * nghĩa trang B1). Trước 17/09 phải gọi ĐỦ CẶP `assertCompanyFor` + `assertSiteFor`, và VẪN thủng — nay một lời gọi
 * — và vẫn thủng, vì `level` toàn cục là COMPANY.
 */
function buildTwoCompaniesTwoLevels(siteIds: string[] = ['nt-b1']) {
  const assignments = [
    {
      scope: null,
      companyId: 'co-a',
      role: {
        code: 'THU_NGAN',
        rolePermissions: [{ scope: 'COMPANY', permission: { code: 'cemetery.plot.update' } }],
      },
    },
    {
      scope: null,
      companyId: 'co-b',
      role: {
        code: 'QL_NGHIA_TRANG',
        rolePermissions: [{ scope: 'SITE', permission: { code: 'cemetery.plot.update' } }],
      },
    },
  ];
  const permissions = new PermissionsService({
    roleAssignment: { findMany: vi.fn().mockResolvedValue(assignments) },
    scopeAssignment: {
      findMany: vi.fn().mockResolvedValue(siteIds.map((cemeteryId) => ({ cemeteryId }))),
    },
    accessRule: { findMany: vi.fn().mockResolvedValue([]) },
    permission: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaService);
  return new ScopeService(permissions, new PolicyEvaluator());
}

const CODE_UPDATE = 'cemetery.plot.update';

describe('mức gắn với CÔNG TY — mức ở công ty này không xoá phép bó nghĩa trang ở công ty kia', () => {
  it('CHẶN nghĩa trang không phụ trách trong công ty mà vai chỉ cho mức SITE', async () => {
    const svc = buildTwoCompaniesTwoLevels();
    // Gọi đủ cặp, đúng như mọi nơi gọi vẫn làm.
    await expect(svc.assertCompanyFor('u1', CODE_UPDATE, 'co-b')).resolves.toBeUndefined();
    await expect(svc.assertPlotFor('u1', CODE_UPDATE, 'co-b', 'nt-b2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('vẫn cho qua nghĩa trang ĐƯỢC phụ trách trong công ty đó', async () => {
    const svc = buildTwoCompaniesTwoLevels();
    await expect(svc.assertPlotFor('u1', CODE_UPDATE, 'co-b', 'nt-b1')).resolves.toBeUndefined();
  });

  /* Không phải "chặn tất cho chắc": ở công ty A vai cho mức COMPANY, nên mọi nghĩa trang
   * trong A đều với tới được — kể cả nghĩa trang không có dòng phụ trách nào. */
  it('công ty mà vai cho mức COMPANY thì KHÔNG bị bó theo nghĩa trang', async () => {
    const svc = buildTwoCompaniesTwoLevels();
    await expect(svc.assertCompanyFor('u1', CODE_UPDATE, 'co-a')).resolves.toBeUndefined();
    await expect(svc.assertPlotFor('u1', CODE_UPDATE, 'co-a', 'nt-a9')).resolves.toBeUndefined();
  });
});

/* ---- Đường DANH SÁCH cũng phải bó theo TỪNG công ty ----
 *
 * `assertPlotFor` đã chặn đường MỘT BẢN GHI, nhưng `visibleCompanyIdsFor` và
 * `listSiteFilterFor` vẫn trả hai danh sách PHẲNG dựng từ `level` toàn cục. Với người có mức
 * khác nhau ở hai công ty, hai danh sách phẳng KHÔNG biểu diễn nổi câu trả lời đúng: công ty
 * A "cả công ty", công ty B "chỉ nghĩa trang được giao". Gộp phẳng thì thành "cả A lẫn B,
 * không bó nghĩa trang" — tức trọn công ty B.
 *
 * Và danh sách là chỗ NGUY HIỂM hơn một bản ghi: nó phát ra id, mà id là tất cả những gì cần
 * để gọi các đường khác.
 */
describe('bộ lọc DANH SÁCH theo phần mộ — bó theo từng công ty, không gộp phẳng', () => {
  it('trả mệnh đề riêng cho từng công ty: A cả công ty, B chỉ nghĩa trang được giao', async () => {
    const svc = buildTwoCompaniesTwoLevels(['nt-b1']);
    await expect(svc.plotScopeFilterFor('u1', CODE_UPDATE)).resolves.toEqual([
      { companyId: 'co-a', cemeteryIds: null },
      { companyId: 'co-b', cemeteryIds: ['nt-b1'] },
    ]);
  });

  /* `null` = không bó gì, và CHỈ mức GROUP mới được nhận nó. */
  it('mức GROUP không bó gì', async () => {
    const svc = build({ level: 'GROUP', companyIds: [] });
    await expect(svc.plotScopeFilterFor('u1', CODE)).resolves.toBeNull();
  });

  /* Được giao không nghĩa trang nào thì với tới KHÔNG mộ nào trong công ty đó — mảng rỗng
   * phải giữ nguyên nghĩa, không được rơi về "không bó". */
  it('công ty mức SITE mà chưa được giao nghĩa trang nào thì với tới rỗng, không phải tất cả', async () => {
    const svc = buildTwoCompaniesTwoLevels([]);
    await expect(svc.plotScopeFilterFor('u1', CODE_UPDATE)).resolves.toEqual([
      { companyId: 'co-a', cemeteryIds: null },
      { companyId: 'co-b', cemeteryIds: [] },
    ]);
  });
});
