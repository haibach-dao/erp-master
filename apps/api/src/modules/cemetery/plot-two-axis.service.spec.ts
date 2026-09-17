import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CemeteryService } from './cemetery.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* BA ĐƯỜNG TỪNG CHỈ HỎI MỘT TRỤC — mỗi đường một kiểu hở.
 *
 * `assertPlotFor` tra mức TẠI công ty được truyền vào. Nên truyền một công ty trong phạm vi
 * kèm một nghĩa trang của công ty KHÁC là vô hiệu hoá vế nghĩa trang: người mức COMPANY thoát
 * ngay ở vế công ty. Hai đường đọc dưới đây thì ngược lại — chúng không hỏi nghĩa trang gì cả.
 *
 * Cả ba do một lượt soi độc lập 17/09/2026 tìm ra, sau khi `assertSiteFor` đã bị gộp vào
 * `assertPlotFor`.
 */

const PLOT = 'plot-1';
const SITE_A1 = 'nt-a1';
const CO_A = 'co-a';
const CO_B = 'co-b';

const CREATOR: Caller = { userId: 'u1', permission: 'cemetery.plot.create' };
const VIEWER: Caller = { userId: 'u1', permission: 'cemetery.usage_right.view' };

function build(
  over: {
    /** Nghĩa trang mà `dto.cemeteryId` trỏ tới thuộc công ty nào. `null` = không tồn tại. */
    cemeteryCompany?: string | null;
    plot?: { companyId: string; cemeteryId: string } | null;
  } = {},
) {
  const { cemeteryCompany = CO_A, plot = { companyId: CO_A, cemeteryId: SITE_A1 } } = over;

  const plotCreate = vi
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: PLOT, ...args.data }),
    );
  const prisma = {
    cemetery: {
      findUnique: vi
        .fn()
        .mockResolvedValue(cemeteryCompany === null ? null : { companyId: cemeteryCompany }),
    },
    gravePlot: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          plot === null ? null : { id: PLOT, plotCode: 'A-01', ...plot, graveType: null },
        ),
      create: plotCreate,
    },
    graveUsageRight: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    burialRecord: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertPlotFor = vi.fn().mockResolvedValue(undefined);
  const svc = new CemeteryService(
    prisma,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
  );
  return { svc, prisma, plotCreate, assertCompanyFor, assertPlotFor };
}

const DTO = {
  companyId: CO_A,
  cemeteryId: SITE_A1,
  graveTypeId: 'gt-1',
  plotCode: 'A-01',
} as never;

describe('tạo phần mộ — công ty và nghĩa trang do client gửi phải KHỚP NHAU', () => {
  /* Lược đồ không ép được: `GravePlot.companyId` và `cemeteryId` là hai cột rời, không có khoá
   * ngoại ghép. Nên phép đối chiếu phải nằm ở tầng dịch vụ. */
  it('CHẶN khi nghĩa trang thuộc công ty khác, và KHÔNG ghi dòng nào', async () => {
    const { svc, plotCreate } = build({ cemeteryCompany: CO_B });
    await expect(svc.createGravePlot(DTO, CREATOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(plotCreate).not.toHaveBeenCalled();
  });

  /* Ca này KHÔNG chứng minh được "dùng công ty của nghĩa trang thay vì tham số client", và
   * tên cũ của nó khẳng định đúng điều đó — một lượt soi độc lập bắt được.
   *
   * Lý do: phép đối chiếu ở trên đã ném khi hai giá trị khác nhau, nên mọi đường chạy tới
   * `assertPlotFor` đều có `cemetery.companyId === dto.companyId`. Hai nguồn không thể phân
   * biệt được nữa — và đó là TÍNH CHẤT MONG MUỐN, không phải thiếu sót. Cái ca này canh được
   * là: phép kiểm phạm vi vẫn CHẠY, và chạy SAU phép đối chiếu. */
  it('vẫn hỏi phạm vi sau khi đã đối chiếu, trên đúng cặp đã xác nhận', async () => {
    const { svc, assertPlotFor } = build({ cemeteryCompany: CO_A });
    await svc.createGravePlot(DTO, CREATOR);
    expect(assertPlotFor).toHaveBeenCalledWith(CREATOR.userId, CREATOR.permission, CO_A, SITE_A1);
  });

  it('nghĩa trang không tồn tại thì 404, không phải tạo bừa', async () => {
    const { svc, plotCreate } = build({ cemeteryCompany: null });
    await expect(svc.createGravePlot(DTO, CREATOR)).rejects.toBeInstanceOf(NotFoundException);
    expect(plotCreate).not.toHaveBeenCalled();
  });

  // Không phải "chặn tất cho chắc": khớp công ty thì vẫn tạo được như thường.
  it('khớp công ty thì tạo bình thường', async () => {
    const { svc, plotCreate } = build({ cemeteryCompany: CO_A });
    await svc.createGravePlot(DTO, CREATOR);
    expect(plotCreate).toHaveBeenCalled();
  });
});

/* Hai màn ĐỌC trên một phần mộ cụ thể. Chúng trả tên chủ mộ, mã khách và lịch sử sang tên —
 * trong khi đường GHI trên chính phần mộ đó đã hỏi đủ hai trục từ lâu. Đọc rò đúng thứ ghi đã
 * chặn là hở nửa vời. */
describe('đọc quyền sử dụng mộ — hỏi CẢ HAI TRỤC, như đường ghi', () => {
  it('lịch sử sang tên hỏi cả công ty lẫn nghĩa trang của phần mộ', async () => {
    const { svc, assertPlotFor } = build();
    await svc.usageRightHistory(PLOT, VIEWER).catch(() => undefined);
    expect(assertPlotFor).toHaveBeenCalledWith(VIEWER.userId, VIEWER.permission, CO_A, SITE_A1);
  });

  it('màn chủ mộ hỏi cả công ty lẫn nghĩa trang của phần mộ', async () => {
    const { svc, assertPlotFor } = build();
    await svc.plotOwnership(PLOT, VIEWER).catch(() => undefined);
    expect(assertPlotFor).toHaveBeenCalledWith(VIEWER.userId, VIEWER.permission, CO_A, SITE_A1);
  });
});
