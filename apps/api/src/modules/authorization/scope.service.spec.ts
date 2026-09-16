import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ScopeService } from './scope.service';
import type { PermissionsService } from './permissions.service';
import { PolicyEvaluator } from './policy-evaluator';

function build(scope: {
  level: 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';
  companyIds: string[];
  siteIds?: string[];
}) {
  const permissions = {
    getEffectiveAccess: vi.fn().mockResolvedValue({
      roles: [],
      permissions: [],
      scope: { siteIds: [], unrestricted: scope.level === 'GROUP', ...scope },
    }),
    /* Ở nhóm test này, mức cho MỌI mã bằng mức của người gọi — nên chúng kiểm đúng phần
     * ngữ nghĩa phạm vi, không lẫn với phần "mức theo mã khác mức toàn người". Trường hợp
     * hai mức LỆCH nhau có `buildPerCode` ở dưới lo. */
    scopeLevelFor: vi.fn().mockResolvedValue(scope.level),
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
    await expect(build(COVERS_ONE).assertSiteFor('u1', CODE, 'ct-1')).resolves.toBeUndefined();
  });

  it('refuses a cemetery the caller does not cover, even inside their own company', async () => {
    await expect(build(COVERS_ONE).assertSiteFor('u1', CODE, 'ct-2')).rejects.toThrow(
      /không phụ trách/,
    );
  });

  it('covering several cemeteries at once is normal, not an exception', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: ['ct-1', 'ct-9'] });
    await expect(svc.assertSiteFor('u1', CODE, 'ct-1')).resolves.toBeUndefined();
    await expect(svc.assertSiteFor('u1', CODE, 'ct-9')).resolves.toBeUndefined();
  });

  it('assigned to no cemetery reaches none of them — not all of them', async () => {
    const svc = build({ level: 'SITE', companyIds: ['co-a'], siteIds: [] });
    await expect(svc.assertSiteFor('u1', CODE, 'ct-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a GROUP caller is unrestricted here too', async () => {
    await expect(build(UNRESTRICTED).assertSiteFor('u1', CODE, 'ct-1')).resolves.toBeUndefined();
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
function buildPerCode(opts: {
  /** Mức RỘNG NHẤT người này giữ ở bất cứ đâu — thứ bản cũ dùng. */
  callerLevel: 'GROUP' | 'COMPANY' | 'SITE' | 'NONE';
  /** Mức thật sự cấp cho TỪNG MÃ. */
  perCode: Record<string, 'GROUP' | 'COMPANY' | 'SITE' | 'NONE'>;
  companyIds: string[];
  siteIds: string[];
}) {
  const permissions = {
    getEffectiveAccess: vi.fn().mockResolvedValue({
      roles: [],
      permissions: [],
      scope: {
        level: opts.callerLevel,
        unrestricted: opts.callerLevel === 'GROUP',
        companyIds: opts.companyIds,
        siteIds: opts.siteIds,
      },
    }),
    scopeLevelFor: vi
      .fn()
      .mockImplementation((_u: string, code: string) =>
        Promise.resolve(opts.perCode[code] ?? 'NONE'),
      ),
  } as unknown as PermissionsService;
  return new ScopeService(permissions, new PolicyEvaluator());
}

/* Người vừa là quản lý nghĩa trang A (SITE) vừa là kiểm toán nội bộ toàn tập đoàn (GROUP,
 * CHỈ ĐỌC). Mức toàn-người-gọi của họ là GROUP; mức cho `burial.record.cancel` là SITE, vì
 * vai kiểm toán không hề cấp mã đó. */
const KIEM_TOAN_KIEM_QUAN_LY = {
  callerLevel: 'GROUP' as const,
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
    await expect(svc.assertSiteFor('u1', 'burial.record.cancel', 'nt-B')).rejects.toThrow(
      /không phụ trách nghĩa trang này/,
    );
  });

  it('vẫn cho qua nghĩa trang A — vai được gán tới đâu thì với tới đó', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.assertSiteFor('u1', 'burial.record.cancel', 'nt-A')).resolves.toBeUndefined();
  });

  it('được gán thêm vai phụ trách B thì chạm được B', async () => {
    const svc = buildPerCode({ ...KIEM_TOAN_KIEM_QUAN_LY, siteIds: ['nt-A', 'nt-B'] });
    await expect(svc.assertSiteFor('u1', 'burial.record.cancel', 'nt-B')).resolves.toBeUndefined();
  });

  it('mã mà vai kiểm toán THẬT SỰ cấp ở mức GROUP thì vẫn với tới cả tập đoàn', async () => {
    // Không phải "chặn tất cho chắc": quyền đọc toàn tập đoàn là thứ vai đó có thật.
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.assertSiteFor('u1', 'burial.record.export', 'nt-B')).resolves.toBeUndefined();
  });

  it('thiếu mã quyền thì TỪ CHỐI, không rơi về mức toàn-người-gọi', async () => {
    const svc = buildPerCode(KIEM_TOAN_KIEM_QUAN_LY);
    await expect(svc.assertSiteFor('u1', null, 'nt-A')).rejects.toThrow(
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
  callerLevel: 'COMPANY' as const,
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

  it('assertSiteFor: từ chối CHÍNH nghĩa trang người đó phụ trách', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(svc.assertSiteFor('u1', 'cemetery.plot.view', 'ct-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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

  it('nói rõ lý do là KHÔNG CÓ PHẠM VI, không lẫn với "ngoài phạm vi"', async () => {
    const svc = buildPerCode(BI_LUAT_CHAN_NHUNG_VAN_DUOC_GAN);
    await expect(svc.assertCompanyFor('u1', 'cemetery.plot.view', 'co-a')).rejects.toThrow(
      /không được cấp phạm vi nào/,
    );
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
