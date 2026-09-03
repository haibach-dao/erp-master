import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HoldsService } from './holds.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* PHẠM VI CỦA GIỮ CHỖ. Tới 27/08/2026 cả module này không kiểm phạm vi một dòng nào: gate
 * `cemetery.hold.hold` / `cemetery.hold.release` / `cemetery.hold.view` trả lời "có được
 * giữ / nhả / xem chỗ hay không", KHÔNG trả lời "phần mộ NÀO".
 *
 * Giữ chỗ là bước đầu của đường bán: nó đổi phần mộ `Available` -> `Held`, và nhả nó thì mộ
 * về `Available`. Nên hở ở đây là chạm được vào nhịp bán của nghĩa trang mình không phụ trách.
 */
const PLOT = 'plot-1';
const SITE = 'nt-1';
const HOLDER: Caller = { userId: 'u1', permission: 'cemetery.hold.hold' };
const RELEASER: Caller = { userId: 'u1', permission: 'cemetery.hold.release' };
const VIEWER: Caller = { userId: 'u1', permission: 'cemetery.hold.view' };

function build(
  over: {
    plot?: { companyId: string; cemeteryId: string } | null;
    hold?: { gravePlotId: string } | null;
    companies?: string[] | null;
    sites?: string[] | null;
  } = {},
) {
  const {
    plot = { companyId: 'co-1', cemeteryId: SITE },
    hold = { gravePlotId: PLOT },
    companies = null,
    sites = null,
  } = over;

  const holdCreate = vi.fn().mockResolvedValue({ id: 'gh-1' });
  const holdUpdate = vi.fn().mockResolvedValue({});
  const plotUpdate = vi.fn().mockResolvedValue({});
  const plotUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const historyCreate = vi.fn().mockResolvedValue({});
  const holdFindMany = vi.fn().mockResolvedValue([]);

  const tx = {
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue({ id: PLOT, status: 'Held', version: 0 }),
      update: plotUpdate,
      updateMany: plotUpdateMany,
    },
    graveHold: {
      findUnique: vi.fn().mockResolvedValue({ id: 'gh-1', gravePlotId: PLOT, status: 'Active' }),
      create: holdCreate,
      update: holdUpdate,
    },
    gravePlotStatusHistory: { create: historyCreate },
  };

  /* Phần mộ đọc NGOÀI giao dịch: `assertPlotInScope` hỏi phạm vi trước khi mở giao dịch, nên
   * nó đọc `prisma.gravePlot`, không phải `tx.gravePlot`. Mock hai chỗ khác nhau là có chủ ý
   * — trộn chung thì test vẫn xanh khi phép kiểm bị dời vào trong giao dịch. */
  const plotFindUnique = vi.fn().mockResolvedValue(plot);
  const prisma = {
    gravePlot: { findUnique: plotFindUnique },
    graveHold: { findUnique: vi.fn().mockResolvedValue(hold), findMany: holdFindMany },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const visibleCompanyIdsFor = vi.fn().mockResolvedValue(companies);
  const listSiteFilterFor = vi.fn().mockResolvedValue(sites);

  const svc = new HoldsService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    {
      assertCompanyFor,
      assertSiteFor,
      visibleCompanyIdsFor,
      listSiteFilterFor,
    } as unknown as ScopeService,
  );
  return {
    svc,
    holdCreate,
    holdUpdate,
    plotUpdate,
    holdFindMany,
    plotFindUnique,
    assertCompanyFor,
    assertSiteFor,
  };
}

describe('giữ chỗ — GIỮ bó theo phần mộ', () => {
  it('hỏi cả hai trục theo phần mộ được giữ, kèm mã quyền', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build({
      plot: { companyId: 'co-1', cemeteryId: SITE },
    });
    // Mộ phải `Available` mới giữ được; dựng lại tx cho đúng luồng là việc của test khác.
    await svc.createHold({ gravePlotId: PLOT, customerId: 'cus-1' }, HOLDER).catch(() => undefined);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'cemetery.hold.hold', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'cemetery.hold.hold', SITE);
  });

  /* Phép kiểm đặt TRƯỚC giao dịch. Nếu nó nằm trong giao dịch thì một 403 vẫn phải kéo cả
   * giao dịch quay lui — làm được, nhưng là giữ khoá hàng trong lúc chờ một lời gọi ngoài
   * Prisma. Test này neo rằng không có dòng nào được ghi khi phạm vi từ chối. */
  it('ngoài phạm vi thì KHÔNG mở giao dịch, không tạo phiếu nào', async () => {
    const { svc, holdCreate, assertSiteFor } = build();
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(
      svc.createHold({ gravePlotId: PLOT, customerId: 'cus-1' }, HOLDER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(holdCreate).not.toHaveBeenCalled();
  });

  it('phần mộ không tồn tại thì 404, không phải 403', async () => {
    const { svc } = build({ plot: null });

    await expect(
      svc.createHold({ gravePlotId: 'plot-9', customerId: 'cus-1' }, HOLDER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('giữ chỗ — NHẢ cũng bó, không chỉ giữ', () => {
  it('quy phiếu giữ về phần mộ rồi mới hỏi phạm vi', async () => {
    const { svc, assertSiteFor } = build();

    await svc.releaseHold('gh-1', RELEASER);

    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'cemetery.hold.release', SITE);
  });

  /* Bỏ sót chiều này là người ngoài phạm vi nhả được chỗ người khác đang giữ — mộ về
   * `Available`, tức mở đường cho người khác giữ hoặc mua. Phá hoại chỉ cần một chiều. */
  it('ngoài phạm vi thì KHÔNG nhả, phần mộ không bị kéo về Available', async () => {
    const { svc, holdUpdate, plotUpdate, assertCompanyFor } = build();
    assertCompanyFor.mockRejectedValue(new ForbiddenException('Ngoài phạm vi được gán'));

    await expect(svc.releaseHold('gh-1', RELEASER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(holdUpdate).not.toHaveBeenCalled();
    expect(plotUpdate).not.toHaveBeenCalled();
  });

  it('phiếu giữ không tồn tại thì 404 trước cả phép kiểm phạm vi', async () => {
    const { svc, assertCompanyFor } = build({ hold: null });

    await expect(svc.releaseHold('gh-9', RELEASER)).rejects.toBeInstanceOf(NotFoundException);
    expect(assertCompanyFor).not.toHaveBeenCalled();
  });
});

/* Danh sách là chỗ lấy được ID phiếu để gọi `release`. Bó ghi mà hở đọc là bó nửa vời. */
describe('giữ chỗ — DANH SÁCH bó theo phạm vi', () => {
  it('mức GROUP không bị bó gì', async () => {
    const { svc, holdFindMany } = build({ companies: null, sites: null });

    await svc.listHolds(VIEWER);

    expect(holdFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('mức COMPANY bó theo công ty qua QUAN HỆ tới phần mộ', async () => {
    const { svc, holdFindMany } = build({ companies: ['co-1'], sites: null });

    await svc.listHolds(VIEWER);

    expect(holdFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { gravePlot: { companyId: { in: ['co-1'] } } } }),
    );
  });

  it('mức SITE bó theo cả công ty và nghĩa trang', async () => {
    const { svc, holdFindMany } = build({ companies: ['co-1'], sites: [SITE] });

    await svc.listHolds(VIEWER);

    expect(holdFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gravePlot: { companyId: { in: ['co-1'] }, cemeteryId: { in: [SITE] } } },
      }),
    );
  });

  /* `[]` là câu trả lời ĐÚNG, không phải chỗ để bỏ mệnh đề đi: được gán không nghĩa trang
   * nào nghĩa là với tới không cái nào, không phải với tới tất cả. */
  it('chưa được gán nghĩa trang nào thì danh sách RỖNG, không phải tất cả', async () => {
    const { svc, holdFindMany } = build({ companies: ['co-1'], sites: [] });

    await svc.listHolds(VIEWER);

    expect(holdFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gravePlot: { companyId: { in: ['co-1'] }, cemeteryId: { in: [] } } },
      }),
    );
  });

  it('lọc theo MỘT phần mộ thì phần mộ đó phải trong phạm vi', async () => {
    const { svc, assertSiteFor } = build();

    await svc.listHolds(VIEWER, PLOT);

    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'cemetery.hold.view', SITE);
  });

  it('lọc theo phần mộ ngoài phạm vi thì 403, không lặng lẽ trả cả công ty', async () => {
    const { svc, assertSiteFor } = build();
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(svc.listHolds(VIEWER, PLOT)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('giữ nguyên bộ lọc trạng thái khi đã bó phạm vi — hai mệnh đề cùng tồn tại', async () => {
    const { svc, holdFindMany } = build({ companies: ['co-1'], sites: null });

    await svc.listHolds(VIEWER, undefined, 'Active');

    expect(holdFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'Active', gravePlot: { companyId: { in: ['co-1'] } } },
      }),
    );
  });
});
