import { describe, expect, it, vi } from 'vitest';
import { CemeteryService } from './cemetery.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* HAI ĐƯỜNG DANH SÁCH CỦA `CemeteryService` — TỚI 17/09/2026 KHÔNG CÓ MỘT CA TEST NÀO.
 *
 * Một lượt soi độc lập chỉ ra chúng cũng là hai nơi ghép mệnh đề mong manh nhất trong sáu nơi
 * gọi `plotScopeWhere`:
 *   - `listGravePlots` dùng `Object.assign` để trộn mệnh đề phạm vi vào một `where` đã dựng
 *     sẵn. Ai đó thêm một `OR` vào `where` phía trên (lọc "mã mộ HOẶC khu") thì `Object.assign`
 *     XOÁ TRẮNG mệnh đề phạm vi — im lặng, không lỗi. Đúng lớp bẫy "hai khoá `OR` trong cùng
 *     một object thì khoá sau đè khoá trước" mà `permissions.service.ts` đã ghi thành cảnh báo.
 *   - `listCemeteries` spread mệnh đề vào một `where` đã có `companyId`; ở nhánh RỖNG mệnh đề
 *     mang chính khoá `companyId` nên nó ghi đè — hẹp lại, nhưng phải có người canh chiều đó.
 *
 * Nhóm test này kiểm THẲNG mệnh đề `where` đi xuống Prisma, vì đó là thứ quyết định ai đọc
 * được gì.
 */

const CO_A = 'co-a';
const CO_B = 'co-b';
const SITE_B1 = 'nt-b1';

const VIEWER: Caller = { userId: 'u1', permission: 'cemetery.plot.view' };
const SITE_VIEWER: Caller = { userId: 'u1', permission: 'cemetery.site.view' };

function build(filter: { companyId: string; cemeteryIds: string[] | null }[] | null) {
  const plotFindMany = vi.fn().mockResolvedValue([]);
  const cemeteryFindMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    gravePlot: { findMany: plotFindMany },
    cemetery: { findMany: cemeteryFindMany },
  } as unknown as PrismaService;

  const svc = new CemeteryService(
    prisma,
    {
      assertCompanyFor: vi.fn().mockResolvedValue(undefined),
      assertPlotFor: vi.fn().mockResolvedValue(undefined),
      plotScopeFilterFor: vi.fn().mockResolvedValue(filter),
    } as unknown as ScopeService,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
  );
  return { svc, plotFindMany, cemeteryFindMany };
}

function whereOf(spy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return (spy.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
}

describe('listGravePlots — mệnh đề phạm vi phải sống sót qua Object.assign', () => {
  it('mức GROUP: không thêm mệnh đề phạm vi nào', async () => {
    const { svc, plotFindMany } = build(null);
    await svc.listGravePlots({ companyId: CO_A } as never, VIEWER);
    expect(whereOf(plotFindMany)).toEqual({ companyId: CO_A });
  });

  /* Hình dạng mà hai danh sách phẳng không diễn đạt nổi — và là ca duy nhất đổi kết quả so
   * với bản cũ: trước đây người này thấy TRỌN công ty B. */
  it('LỆCH MỨC: công ty A cả công ty, công ty B chỉ nghĩa trang được giao', async () => {
    const { svc, plotFindMany } = build([
      { companyId: CO_A, cemeteryIds: null },
      { companyId: CO_B, cemeteryIds: [SITE_B1] },
    ]);
    await svc.listGravePlots({ companyId: CO_B } as never, VIEWER);
    expect(whereOf(plotFindMany)).toEqual({
      companyId: CO_B,
      OR: [{ companyId: CO_A }, { companyId: CO_B, cemeteryId: { in: [SITE_B1] } }],
    });
  });

  it('không với tới công ty nào: mệnh đề KHÔNG BAO GIỜ đúng, không phải "không lọc"', async () => {
    const { svc, plotFindMany } = build([]);
    await svc.listGravePlots({ companyId: CO_A } as never, VIEWER);
    expect(whereOf(plotFindMany)).toEqual({ companyId: { in: [] } });
  });

  /* Lọc theo MỘT nghĩa trang đi nhánh khác — `assertPlotFor` chặn ở đó, nên `where` chỉ mang
   * đúng nghĩa trang được hỏi. Giữ ca này để bản gộp không lặng lẽ bỏ mất nhánh nào. */
  it('hỏi đúng MỘT nghĩa trang thì lọc thẳng theo nghĩa trang đó', async () => {
    const { svc, plotFindMany } = build([{ companyId: CO_B, cemeteryIds: [SITE_B1] }]);
    await svc.listGravePlots({ companyId: CO_B, cemeteryId: SITE_B1 } as never, VIEWER);
    expect(whereOf(plotFindMany)).toEqual({ companyId: CO_B, cemeteryId: SITE_B1 });
  });
});

describe('listCemeteries — bảng Cemetery dùng `id` làm trục nghĩa trang', () => {
  it('mức GROUP: chỉ lọc theo công ty được hỏi', async () => {
    const { svc, cemeteryFindMany } = build(null);
    await svc.listCemeteries(CO_A, SITE_VIEWER);
    expect(whereOf(cemeteryFindMany)).toEqual({ companyId: CO_A });
  });

  /* Cột phải là `id`, KHÔNG phải `cemeteryId` — bảng này chính là nghĩa trang. Hỏi sai cột thì
   * Prisma nổ ở runtime chứ không lặng lẽ, nhưng chỉ khi có ai đó chạy tới. */
  it('LỆCH MỨC: mệnh đề dùng cột `id`, và công ty B bị bó theo nghĩa trang được giao', async () => {
    const { svc, cemeteryFindMany } = build([
      { companyId: CO_A, cemeteryIds: null },
      { companyId: CO_B, cemeteryIds: [SITE_B1] },
    ]);
    await svc.listCemeteries(CO_B, SITE_VIEWER);
    expect(whereOf(cemeteryFindMany)).toEqual({
      companyId: CO_B,
      OR: [{ companyId: CO_A }, { companyId: CO_B, id: { in: [SITE_B1] } }],
    });
  });

  /* Nhánh RỖNG mang chính khoá `companyId` nên nó GHI ĐÈ `companyId` của truy vấn. Hướng ghi
   * đè là HẸP lại (`{ in: [] }` không bao giờ đúng), nên đúng — nhưng phải có người canh, vì
   * một lần đảo thứ tự spread là nó thành mở toang. */
  it('không với tới công ty nào: `companyId` bị ghi đè thành mệnh đề rỗng, không mất mệnh đề', async () => {
    const { svc, cemeteryFindMany } = build([]);
    await svc.listCemeteries(CO_A, SITE_VIEWER);
    expect(whereOf(cemeteryFindMany)).toEqual({ companyId: { in: [] } });
  });
});
