import { describe, expect, it, vi } from 'vitest';
import { CardFeesService } from './card-fees.service';
import { CardApprovalsService } from './card-approvals.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScopeService } from '../authorization/scope.service';
import type { PermissionsService } from '../authorization/permissions.service';
import type { AuditService } from '../audit/audit.service';
import type { Caller } from '../authorization/caller';

/* BẢNG KÊ PHÍ CẤP THẺ — đường ĐỌC từng chỉ hỏi TRỤC CÔNG TY.
 *
 * `GraveCardFeeCharge` có CẢ `companyId` LẪN `gravePlotId`, nhưng bản trước chỉ lặp trên tập
 * công ty của các dòng đã lấy. Cùng lớp lỗi với `usageRightHistory` và `plotOwnership`: đường
 * ĐỌC hở đúng thứ đường GHI đã chặn. Một lượt soi độc lập 17/09/2026 bắt được.
 *
 * Công ty hỏi theo bản ghi MỘ chứ không theo cột `companyId` của chính dòng phí: cột đó là ảnh
 * chụp lúc tính tiền, còn câu hỏi ở đây là "mộ này nằm ở đâu".
 */

const LOG = 'clog-1';
const CO_A = 'co-a';
const SITE_A1 = 'nt-a1';
const SITE_A2 = 'nt-a2';

const VIEWER: Caller = { userId: 'u1', permission: 'cemetery.card_fee.view' };

function build(
  rows: { gravePlotId: string; companyId: string }[],
  plots: { id: string; companyId: string; cemeteryId: string }[],
) {
  const plotFindMany = vi
    .fn()
    .mockImplementation((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        plots
          .filter((p) => args.where.id.in.includes(p.id))
          .map((p) => ({ companyId: p.companyId, cemeteryId: p.cemeteryId })),
      ),
    );
  const prisma = {
    graveCardFeeCharge: { findMany: vi.fn().mockResolvedValue(rows) },
    gravePlot: { findMany: plotFindMany },
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertPlotFor = vi.fn().mockResolvedValue(undefined);
  const svc = new CardFeesService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
    { scopeLevelFor: vi.fn().mockResolvedValue('COMPANY') } as unknown as PermissionsService,
  );
  return { svc, assertPlotFor, plotFindMany };
}

const VIEWER_APPROVAL: Caller = { userId: 'u1', permission: 'cemetery.card.submit' };

/* Harness riêng cho `CardApprovalsService`: chỉ cần hai bảng nó đụng tới ở đường này. */
function buildApprovals(
  filter: { companyId: string; cemeteryIds: string[] | null }[] | null,
  cemeteries: { id: string; companyId: string }[],
) {
  const approvalFindMany = vi.fn().mockResolvedValue([]);
  /* Mock ĐỌC `where` thật, không trả cứng.
   *
   * Bản trước dùng `mockResolvedValue(cemeteries)` — trả CÙNG danh sách bất kể `where`. Đo bằng
   * đột biến: đổi lời gọi thành `where: {}` (fail-open hoàn toàn) thì 1062/1062 vẫn xanh. Phép
   * dịch phạm vi → `where` là thứ nhóm này mang tên, và nó không hề được canh. */
  const cemeteryFindMany = vi
    .fn()
    .mockImplementation((args: { where?: { OR?: unknown[]; companyId?: { in: string[] } } }) => {
      const where = args.where ?? {};
      if (where.OR === undefined) {
        // `{}` = không lọc gì ⇒ TRẢ TẤT CẢ. Đây là nhánh fail-open; ca dưới phải bắt được nó.
        if (where.companyId === undefined) return Promise.resolve(cemeteries);
        return Promise.resolve(cemeteries.filter((c) => where.companyId!.in.includes(c.companyId)));
      }
      const ors = where.OR as { companyId: string; id?: { in: string[] } }[];
      return Promise.resolve(
        cemeteries.filter((c) =>
          ors.some(
            (o) => o.companyId === c.companyId && (o.id === undefined || o.id.in.includes(c.id)),
          ),
        ),
      );
    });
  const prisma = {
    cardIssueApproval: { findMany: approvalFindMany },
    cemetery: { findMany: cemeteryFindMany },
  } as unknown as PrismaService;

  const svc = new CardApprovalsService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    {
      assertCompanyFor: vi.fn().mockResolvedValue(undefined),
      assertPlotFor: vi.fn().mockResolvedValue(undefined),
      plotScopeFilterFor: vi.fn().mockResolvedValue(filter),
    } as unknown as ScopeService,
  );
  return { svc, approvalFindMany };
}

function whereOfApproval(spy: ReturnType<typeof vi.fn>): Record<string, unknown> | undefined {
  const call = spy.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined;
  return call?.where;
}

describe('bảng kê phí cấp thẻ — hỏi CẢ HAI TRỤC theo từng phần mộ', () => {
  it('hỏi phạm vi trên nghĩa trang của phần mộ, không chỉ trên công ty', async () => {
    const { svc, assertPlotFor } = build(
      [{ gravePlotId: 'mo-1', companyId: CO_A }],
      [{ id: 'mo-1', companyId: CO_A, cemeteryId: SITE_A1 }],
    );
    await svc.listCharges(LOG, VIEWER);
    expect(assertPlotFor).toHaveBeenCalledWith(VIEWER.userId, VIEWER.permission, CO_A, SITE_A1);
  });

  /* Một lượt in có thể gồm nhiều mộ ở nhiều nghĩa trang. Hỏi mỗi cái đầu là để lọt phần còn
   * lại — cùng lý do `buildCard` phải lặp trên toàn bộ bộ mộ. */
  it('nhiều nghĩa trang thì hỏi ĐỦ, không chỉ cái đầu', async () => {
    const { svc, assertPlotFor } = build(
      [
        { gravePlotId: 'mo-1', companyId: CO_A },
        { gravePlotId: 'mo-2', companyId: CO_A },
      ],
      [
        { id: 'mo-1', companyId: CO_A, cemeteryId: SITE_A1 },
        { id: 'mo-2', companyId: CO_A, cemeteryId: SITE_A2 },
      ],
    );
    await svc.listCharges(LOG, VIEWER);
    expect(assertPlotFor).toHaveBeenCalledWith(VIEWER.userId, VIEWER.permission, CO_A, SITE_A1);
    expect(assertPlotFor).toHaveBeenCalledWith(VIEWER.userId, VIEWER.permission, CO_A, SITE_A2);
  });

  // Không có dòng phí nào thì không tra mộ, và không hỏi phạm vi trên một chỗ trống.
  it('bảng kê rỗng thì không tra phần mộ nào', async () => {
    const { svc, assertPlotFor, plotFindMany } = build([], []);
    await svc.listCharges(LOG, VIEWER);
    expect(plotFindMany).not.toHaveBeenCalled();
    expect(assertPlotFor).not.toHaveBeenCalled();
  });
});

/* HỒ SƠ TRÌNH DUYỆT CỦA MỘT KHÁCH — `customerId` KHÔNG phải khoá hẹp.
 *
 * Nó là tham số truy vấn do client gửi: ai cầm mã quyền và biết một id khách là hỏi được. Lát
 * 17/09 từng xếp đường này vào nhóm "ngoại lệ có chủ đích" cùng `listInbox` và ghi thêm rằng
 * bó đúng thì cần migration — cả hai đều sai, một lượt soi độc lập bắt được. Trục nghĩa trang
 * quy được qua chính bảng `Cemetery`, không cần cột mới.
 */
describe('hồ sơ trình duyệt của một khách — bó theo nghĩa trang với tới được', () => {
  it('mức GROUP: không bó theo nghĩa trang', async () => {
    const { svc, approvalFindMany } = buildApprovals(null, []);
    await svc.listForCustomer('cus-1', VIEWER_APPROVAL);
    expect(whereOfApproval(approvalFindMany)).toEqual({ customerId: 'cus-1' });
  });

  /* Fixture có BA nghĩa trang, và một trong ba PHẢI BỊ LOẠI.
   *
   * Bản trước nạp đúng hai nghĩa trang rồi kỳ vọng cả hai — tức toàn bộ fixture. Fixture chỉ
   * gồm thứ ĐƯỢC PHÉP thì phép lọc đúng và phép lọc sai cho cùng kết quả. `nt-b2` thuộc công ty
   * B, nơi người này chỉ mức SITE và chỉ được giao `nt-b1`. */
  it('LỆCH MỨC: chỉ thấy hồ sơ ở nghĩa trang với tới được', async () => {
    const { svc, approvalFindMany } = buildApprovals(
      [
        { companyId: CO_A, cemeteryIds: null },
        { companyId: 'co-b', cemeteryIds: ['nt-b1'] },
      ],
      [
        { id: SITE_A1, companyId: CO_A },
        { id: 'nt-b1', companyId: 'co-b' },
        // PHẢI BỊ LOẠI: công ty B nhưng không nằm trong phân công.
        { id: 'nt-b2', companyId: 'co-b' },
      ],
    );
    await svc.listForCustomer('cus-1', VIEWER_APPROVAL);
    expect(whereOfApproval(approvalFindMany)).toEqual({
      customerId: 'cus-1',
      cemeteryId: { in: [SITE_A1, 'nt-b1'] },
    });
  });

  /* Không với tới nghĩa trang nào thì thấy RỖNG — không được rơi về "không lọc". */
  it('không với tới nghĩa trang nào thì danh sách rỗng, không phải tất cả', async () => {
    const { svc, approvalFindMany } = buildApprovals([], []);
    expect(whereOfApproval(approvalFindMany)).toBeUndefined();
    await svc.listForCustomer('cus-1', VIEWER_APPROVAL);
    expect(whereOfApproval(approvalFindMany)).toEqual({
      customerId: 'cus-1',
      cemeteryId: { in: [] },
    });
  });
});
