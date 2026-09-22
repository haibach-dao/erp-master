import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ServicesService } from './services.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* ĐĂNG KÝ DỊCH VỤ — tới 18/09/2026 đường này KHÔNG hỏi một dòng phạm vi nào.
 *
 * `companyId`, `gravePlotId`, `customerId` là BA id RỜI do client chọn, và không giá trị nào
 * được đối chiếu với nhau — kể cả `catalog.companyId` vừa đọc ngay trên. Từ quyết định 17/09
 * (khách công ty A được đứng tên mộ công ty B) thì "chúng chắc trùng nhau" không còn là giả
 * định dùng được nữa.
 *
 * Và cột `companyId` ấy là cột TIỀN: `revenue` cộng theo đúng nó, nên con số báo cáo chỉ đáng
 * tin bằng mức đáng tin của DTO.
 *
 * `ServicesService` trước lát này KHÔNG có spec nào.
 */

const CO_A = 'co-a';
const CO_B = 'co-b';
const SITE_B1 = 'nt-b1';
const PLOT = 'plot-1';

const CALLER: Caller = { userId: 'u1', permission: 'service.subscription.create' };

function build(
  over: {
    catalogCompany?: string;
    plot?: { companyId: string; cemeteryId: string } | null;
  } = {},
) {
  const { catalogCompany = CO_A, plot = { companyId: CO_B, cemeteryId: SITE_B1 } } = over;

  const created: Record<string, unknown>[] = [];
  const prisma = {
    serviceCatalog: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'cat-1',
        companyId: catalogCompany,
        active: true,
        durationMonths: 12,
        price: 1000,
      }),
    },
    gravePlot: { findUnique: vi.fn().mockResolvedValue(plot) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        serviceSubscription: {
          create: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
            created.push(args.data);
            return Promise.resolve({ id: 'sub-1', ...args.data });
          }),
        },
        serviceTransaction: {
          create: vi.fn().mockResolvedValue({ id: 'tx-1' }),
        },
      }),
    ),
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertPlotFor = vi.fn().mockResolvedValue(undefined);
  const svc = new ServicesService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
  );
  return { svc, created, assertCompanyFor, assertPlotFor };
}

const DTO = {
  companyId: CO_A,
  gravePlotId: PLOT,
  customerId: 'cus-1',
  serviceCatalogId: 'cat-1',
  effectiveFrom: '2026-09-18',
} as never;

describe('đăng ký dịch vụ — hỏi phạm vi trên CẢ HAI VẾ', () => {
  it('hỏi công ty của thuê bao', async () => {
    const { svc, assertCompanyFor } = build();
    await svc.subscribe(DTO, CALLER);
    expect(assertCompanyFor).toHaveBeenCalledWith(CALLER.userId, CALLER.permission, CO_A);
  });

  /* Phần mộ là chỗ công việc diễn ra, và nó có thể thuộc công ty KHÁC — hợp lệ từ 17/09. Nên
   * phải hỏi riêng, bằng công ty CỦA CHÍNH PHẦN MỘ. */
  it('hỏi phần mộ bằng công ty của CHÍNH phần mộ, kể cả khi khác công ty thuê bao', async () => {
    const { svc, assertPlotFor } = build();
    await svc.subscribe(DTO, CALLER);
    expect(assertPlotFor).toHaveBeenCalledWith(CALLER.userId, CALLER.permission, CO_B, SITE_B1);
  });

  it('ngoài phạm vi phần mộ thì KHÔNG ghi dòng nào', async () => {
    const { svc, created, assertPlotFor } = build();
    assertPlotFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));
    await expect(svc.subscribe(DTO, CALLER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(created).toEqual([]);
  });

  /* `catalog.companyId` là DỮ LIỆU, `dto.companyId` là LỜI KHAI. Lệch nhau thì chặn — nếu
   * không, thuê bao mang công ty A trong khi gói dịch vụ là của B, và doanh thu cộng nhầm nhà. */
  it('gói dịch vụ thuộc công ty khác thì CHẶN, không ghi gì', async () => {
    const { svc, created } = build({ catalogCompany: 'co-KHAC' });
    await expect(svc.subscribe(DTO, CALLER)).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toEqual([]);
  });

  it('phần mộ không tồn tại thì 404, không ghi gì', async () => {
    const { svc, created } = build({ plot: null });
    await expect(svc.subscribe(DTO, CALLER)).rejects.toBeInstanceOf(NotFoundException);
    expect(created).toEqual([]);
  });

  // Không phải "chặn tất cho chắc": hợp lệ thì vẫn đăng ký được như thường.
  it('hợp lệ thì vẫn ghi thuê bao', async () => {
    const { svc, created } = build();
    await svc.subscribe(DTO, CALLER);
    expect(created).toHaveLength(1);
  });

  /* CỘT TIỀN phải ghi đúng pháp nhân — và trước lát này KHÔNG ca nào đọc nó.
   *
   * `companyId` của thuê bao là cột `revenue` cộng theo. Fixture cố ý để phần mộ ở công ty B
   * còn thuê bao ở công ty A: nếu ai đó "sửa cho nhất quán" bằng cách ghi công ty của PHẦN MỘ,
   * doanh thu rời khỏi pháp nhân đã ký hợp đồng mà không ca nào đỏ. Đây là ca neo, không phải
   * ca mô tả — đổi nó là đổi nơi tiền đi về, phải có quyết định người. */
  it('ghi đúng công ty của THUÊ BAO, không mượn công ty của phần mộ', async () => {
    const { svc, created } = build();
    await svc.subscribe(DTO, CALLER);
    expect(created[0]?.companyId).toBe(CO_A);
    expect(created[0]?.companyId).not.toBe(CO_B);
  });
});
