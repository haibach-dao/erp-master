import { describe, expect, it, vi } from 'vitest';
import { CardFeesService } from './card-fees.service';
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
