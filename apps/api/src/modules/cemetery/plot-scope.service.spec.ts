import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CemeteryService } from './cemetery.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* PHẠM VI THEO PHẦN MỘ, khai đúng một lần ở `assertPlotScope` / `assertPlotInScope`.
 *
 * Nhóm test này giữ hai thứ:
 *
 *   1. `getStatusHistory` — tới 27/08/2026 không nhận caller và không kiểm phạm vi dòng nào.
 *      Lịch sử trạng thái kể ai đổi mộ nào, lúc nào, vì lý do gì: đủ để dựng lại nhịp bán và
 *      nhịp an táng của một nghĩa trang mình không phụ trách.
 *   2. `changeGravePlotStatus` — vừa được gom về dùng helper chung. Gom mà không có test là
 *      gom mù: hai chỗ trước đó gõ tay cùng một luật, và cách duy nhất biết bản gom vẫn nói
 *      đúng điều đó là CHẠY.
 */
const PLOT = 'plot-1';
const SITE = 'nt-1';
const VIEWER: Caller = { userId: 'u1', permission: 'cemetery.plot.view_history' };
const SETTER: Caller = { userId: 'u1', permission: 'cemetery.plot.set_status' };

function build(over: { plot?: { companyId: string; cemeteryId: string } | null } = {}) {
  const { plot = { companyId: 'co-1', cemeteryId: SITE } } = over;

  const historyFindMany = vi.fn().mockResolvedValue([]);
  const historyCreate = vi.fn().mockResolvedValue({});
  const plotUpdate = vi.fn().mockResolvedValue({ id: PLOT, status: 'Held' });
  const tx = {
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue({ id: PLOT, status: 'Available', version: 0 }),
      update: plotUpdate,
    },
    gravePlotStatusHistory: { create: historyCreate },
  };

  const plotFindUnique = vi.fn().mockResolvedValue(plot);
  const prisma = {
    gravePlot: { findUnique: plotFindUnique },
    gravePlotStatusHistory: { findMany: historyFindMany },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const svc = new CemeteryService(
    prisma,
    { assertCompanyFor, assertSiteFor } as unknown as ScopeService,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
  );
  return { svc, historyFindMany, historyCreate, plotUpdate, assertCompanyFor, assertSiteFor };
}

describe('lịch sử trạng thái phần mộ — bó theo phạm vi', () => {
  it('hỏi cả hai trục theo phần mộ, kèm mã quyền đang thi hành', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build();

    await svc.getStatusHistory(PLOT, VIEWER);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'cemetery.plot.view_history', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'cemetery.plot.view_history', SITE);
  });

  it('ngoài phạm vi thì KHÔNG đọc lịch sử', async () => {
    const { svc, historyFindMany, assertSiteFor } = build();
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(svc.getStatusHistory(PLOT, VIEWER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(historyFindMany).not.toHaveBeenCalled();
  });

  it('phần mộ không tồn tại thì 404 — không trả mảng rỗng như thể mộ đó không có lịch sử', async () => {
    const { svc } = build({ plot: null });

    await expect(svc.getStatusHistory('plot-9', VIEWER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('đổi trạng thái phần mộ — bản gom vẫn nói đúng điều cũ', () => {
  it('vẫn hỏi cả hai trục sau khi gom về helper chung', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build();

    await svc.changeGravePlotStatus(PLOT, { toStatus: 'Held' }, SETTER);

    expect(assertCompanyFor).toHaveBeenCalledWith('u1', 'cemetery.plot.set_status', 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', 'cemetery.plot.set_status', SITE);
  });

  it('ngoài phạm vi thì KHÔNG đổi trạng thái và không ghi lịch sử', async () => {
    const { svc, plotUpdate, historyCreate, assertSiteFor } = build();
    assertSiteFor.mockRejectedValue(new ForbiddenException('không phụ trách nghĩa trang này'));

    await expect(
      svc.changeGravePlotStatus(PLOT, { toStatus: 'Held' }, SETTER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(plotUpdate).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('người ĐỔI được ghi vào lịch sử là userId, không phải cả object caller', async () => {
    const { svc, historyCreate } = build();

    await svc.changeGravePlotStatus(PLOT, { toStatus: 'Held' }, SETTER);

    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ changedBy: 'u1' }) }),
    );
  });
});
