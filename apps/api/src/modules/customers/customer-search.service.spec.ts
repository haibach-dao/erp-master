import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* BỘ LỌC DANH SÁCH KHÁCH HÀNG — LỌC Ở SERVER.
 *
 * VÌ SAO BỘ TEST NÀY TỒN TẠI: `search()` trước đây KHÔNG có test nào, và bộ lọc là đúng
 * loại mã hỏng âm thầm — một mệnh đề `where` bị bỏ sót không làm gãy gì, chỉ làm màn hình
 * hiện thêm vài dòng lẽ ra không được hiện. Không ai nhận ra cho tới khi đếm tay.
 *
 * Nên các test dưới đây kiểm MỆNH ĐỀ TRUY VẤN, không chỉ kiểm số dòng trả về: mock trả cứng
 * thì "đã lọc" và "chưa lọc" cho ra cùng một kết quả.
 */

const CALLER: Caller = { userId: 'u1', permission: 'crm.customer.search' };

function build(
  opts: {
    visibleCompanies?: string[] | null;
    rights?: { holderCustomerId: string; gravePlotId: string }[];
    plotsInCemetery?: string[];
    rows?: { id: string; companyId: string | null }[];
    total?: number;
    scopeThrows?: boolean;
  } = {},
) {
  const {
    visibleCompanies = null,
    rights = [],
    plotsInCemetery = [],
    rows = [],
    total = rows.length,
    scopeThrows = false,
  } = opts;

  const findMany = vi.fn().mockResolvedValue(rows.map((r) => ({ ...r, person: null })));
  const count = vi.fn().mockResolvedValue(total);
  const plotFindMany = vi.fn().mockImplementation((args: { where: { cemeteryId?: string } }) => {
    if (args.where.cemeteryId !== undefined) {
      return Promise.resolve(plotsInCemetery.map((id) => ({ id })));
    }
    return Promise.resolve([]);
  });

  const prisma = {
    customer: { findMany, count },
    graveUsageRight: {
      findMany: vi.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
        // Lượt "trang trí" hỏi kèm `holderCustomerId`; lượt lọc thì không.
        if ((args.where as { holderCustomerId?: unknown }).holderCustomerId !== undefined) {
          return Promise.resolve([]);
        }
        return Promise.resolve(rights);
      }),
    },
    gravePlot: { findMany: plotFindMany },
  } as unknown as PrismaService;

  const reject = () => Promise.reject(new ForbiddenException('Ngoài phạm vi được gán'));
  const scope = {
    visibleCompanyIdsFor: vi.fn().mockResolvedValue(visibleCompanies),
    assertCompanyFor: vi.fn(scopeThrows ? reject : () => Promise.resolve()),
    assertSiteFor: vi.fn(scopeThrows ? reject : () => Promise.resolve()),
  } as unknown as ScopeService;

  const svc = new CustomersService(
    prisma,
    {} as unknown as PiiService,
    { record: vi.fn() } as unknown as AuditService,
    scope,
  );
  return { svc, findMany, count, plotFindMany, scope };
}

/** Mệnh đề `where` mà `customer.findMany` thực sự nhận được. */
function whereOf(findMany: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
}

describe('bộ lọc khách hàng — còn sống / đã mất', () => {
  it('lọc "đã mất" thành mệnh đề trên hồ sơ người mất, không lọc ở giao diện', async () => {
    const { svc, findMany } = build();

    await svc.search({ lifeStatus: 'deceased' }, CALLER);

    expect(whereOf(findMany).person).toEqual({ deceased: { isNot: null } });
  });

  it('lọc "còn sống" là mệnh đề NGƯỢC LẠI, không phải bỏ trống', async () => {
    const { svc, findMany } = build();

    await svc.search({ lifeStatus: 'alive' }, CALLER);

    expect(whereOf(findMany).person).toEqual({ deceased: { is: null } });
  });

  it('"tất cả" thì không sinh mệnh đề nào', async () => {
    const { svc, findMany } = build();

    await svc.search({ lifeStatus: 'all' }, CALLER);

    expect(whereOf(findMany).person).toBeUndefined();
  });
});

describe('bộ lọc khách hàng — đứng tên phần mộ', () => {
  const RIGHTS = [
    { holderCustomerId: 'c1', gravePlotId: 'p1' },
    { holderCustomerId: 'c2', gravePlotId: 'p2' },
    { holderCustomerId: 'c1', gravePlotId: 'p3' },
  ];

  it('"đang đứng tên" giao vào đúng tập chủ mộ, không trùng lặp', async () => {
    const { svc, findMany } = build({ rights: RIGHTS });

    await svc.search({ graveOwner: 'yes' }, CALLER);

    expect(whereOf(findMany).id).toEqual({ in: ['c1', 'c2'] });
  });

  it('"chưa đứng tên" là phép LOẠI TRỪ, không phải tập rỗng', async () => {
    const { svc, findMany } = build({ rights: RIGHTS });

    await svc.search({ graveOwner: 'no' }, CALLER);

    expect(whereOf(findMany).id).toEqual({ notIn: ['c1', 'c2'] });
  });

  it('không ai đứng tên mộ nào thì "đang đứng tên" trả tập RỖNG, không phải bỏ lọc', async () => {
    /* Đây là chỗ một `if (ids.length)` đặt nhầm biến phép bó thành phép mở toang — và triệu
     * chứng là màn hình hiện TOÀN BỘ khách hàng đúng lúc người dùng vừa lọc cho hẹp lại. */
    const { svc, findMany } = build({ rights: [] });

    await svc.search({ graveOwner: 'yes' }, CALLER);

    expect(whereOf(findMany).id).toEqual({ in: [] });
  });

  it('lọc theo nghĩa trang chỉ lấy chủ của mộ TRONG nghĩa trang đó', async () => {
    const { svc, findMany } = build({ rights: RIGHTS, plotsInCemetery: ['p2'] });

    await svc.search({ cemeteryId: 'nt-A' }, CALLER);

    expect(whereOf(findMany).id).toEqual({ in: ['c2'] });
  });

  it('"chưa đứng tên mộ" + một nghĩa trang cụ thể bị TỪ CHỐI, không trả tập lặng lẽ sai', async () => {
    // "Không đứng tên mộ nào ở nghĩa trang A" gồm cả người đứng tên ba mộ ở nghĩa trang B.
    const { svc } = build({ rights: RIGHTS });

    await expect(
      svc.search({ graveOwner: 'no', cemeteryId: 'nt-A' }, CALLER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chọn nghĩa trang ngoài phạm vi thì 403, không phải danh sách rỗng', async () => {
    const { svc } = build({ rights: RIGHTS, scopeThrows: true });

    await expect(svc.search({ cemeteryId: 'nt-B' }, CALLER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('bộ lọc khách hàng — phạm vi và công ty', () => {
  it('mặc định bó theo phạm vi người gọi, không trả khách của mọi công ty', async () => {
    const { svc, findMany } = build({ visibleCompanies: ['co-a'] });

    await svc.search({}, CALLER);

    expect(whereOf(findMany).companyId).toEqual({ in: ['co-a'] });
  });

  it('người gọi mức GROUP thì không bó công ty', async () => {
    const { svc, findMany } = build({ visibleCompanies: null });

    await svc.search({}, CALLER);

    expect(whereOf(findMany).companyId).toBeUndefined();
  });

  it('chọn công ty là THU HẸP, và công ty ngoài phạm vi thì 403', async () => {
    const { svc, findMany } = build({ visibleCompanies: ['co-a', 'co-b'] });
    await svc.search({ companyId: 'co-a' }, CALLER);
    expect(whereOf(findMany).companyId).toEqual({ in: ['co-a'] });

    const denied = build({ visibleCompanies: ['co-a'], scopeThrows: true });
    await expect(denied.svc.search({ companyId: 'co-z' }, CALLER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('phạm vi hỏi THEO MÃ `crm.customer.search`, không theo mức rộng nhất người đó giữ', async () => {
    const { svc, scope } = build({ visibleCompanies: ['co-a'] });

    await svc.search({}, CALLER);

    expect(scope.visibleCompanyIdsFor).toHaveBeenCalledWith('u1', 'crm.customer.search');
  });
});

describe('bộ lọc khách hàng — tìm tự do, trần số dòng, và nói thật khi bị cắt', () => {
  it('chuỗi tìm rỗng KHÔNG sinh mệnh đề OR nào', async () => {
    const { svc, findMany } = build();

    await svc.search({ q: '' }, CALLER);

    expect(whereOf(findMany).OR).toBeUndefined();
  });

  it('có chuỗi tìm thì quét đủ 5 trục: mã, điện thoại, email, tên tổ chức, họ tên', async () => {
    const { svc, findMany } = build();

    await svc.search({ q: 'nguyen' }, CALLER);

    expect((whereOf(findMany).OR as unknown[]).length).toBe(5);
  });

  it('đếm và lấy trang dùng CÙNG một mệnh đề where', async () => {
    /* Hai mệnh đề khác nhau là hai câu trả lời khác nhau cho cùng một câu hỏi — hiện ra
     * thành "tổng 12" trên một bảng đang có 9 dòng. */
    const { svc, findMany, count } = build({ visibleCompanies: ['co-a'] });

    await svc.search({ lifeStatus: 'deceased', q: 'a' }, CALLER);

    expect((count.mock.calls[0]?.[0] as { where: unknown }).where).toEqual(whereOf(findMany));
  });

  it('trần 200 dòng: client không tự nâng thành cổng trích xuất bằng một tham số URL', async () => {
    const { svc, findMany } = build();

    await svc.search({ limit: 100000 }, CALLER);

    expect((findMany.mock.calls[0]?.[0] as { take: number }).take).toBe(200);
  });

  it('mặc định 50 dòng khi không truyền limit', async () => {
    const { svc, findMany } = build();

    await svc.search({}, CALLER);

    expect((findMany.mock.calls[0]?.[0] as { take: number }).take).toBe(50);
  });

  it('NÓI RA khi danh sách bị cắt — im lặng là chỗ người dùng đếm nhầm', async () => {
    const { svc } = build({ rows: [{ id: 'c1', companyId: 'co-a' }], total: 87 });

    const res = await svc.search({}, CALLER);

    expect(res.total).toBe(87);
    expect(res.truncated).toBe(true);
    expect(res.items).toHaveLength(1);
  });

  it('không bị cắt thì `truncated` là false', async () => {
    const { svc } = build({ rows: [{ id: 'c1', companyId: 'co-a' }], total: 1 });

    const res = await svc.search({}, CALLER);

    expect(res.truncated).toBe(false);
  });
});
