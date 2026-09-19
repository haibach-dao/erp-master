import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { CardsService } from './cards.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { CardFeesService } from './card-fees.service';
import type { CardApprovalsService } from './card-approvals.service';
import type { PermissionsService } from '../authorization/permissions.service';
import type { Caller } from '../authorization/caller';

/* MỘT THẺ = MỘT CÔNG TY, và công ty đó là công ty của PHẦN MỘ (anh Bách chốt 19/09/2026).
 *
 * Harness riêng, tối thiểu: nhóm này chỉ hỏi MỘT câu — bộ mộ được lọc xuống đúng một công ty
 * chưa, và công ty ấy lấy từ đâu. Trộn vào harness lớn của `cards.service.spec.ts` thì phải
 * dựng cả nhật ký in, phí, phê duyệt cho một câu hỏi không cần thứ nào trong đó.
 *
 * Bối cảnh: từ 17/09 khách của công ty A được đứng tên mộ ở công ty B, nên "công ty của khách"
 * và "công ty của mộ" là hai giá trị khác nhau. Tiền theo mộ, nên THẺ cũng theo mộ.
 */

const CUSTOMER = 'cus-1';
const CO_KHACH = 'co-KHACH';
const CO_A = 'co-A';
const CO_B = 'co-B';

const VIEWER: Caller = { userId: 'u1', permission: 'cemetery.card.view' };

function plotRow(id: string, companyId: string, cemeteryId: string) {
  return {
    id,
    plotCode: 'X-' + id,
    zone: null,
    subzone: null,
    block: null,
    row: null,
    mapX: null,
    mapY: null,
    capacityOverride: null,
    companyId,
    cemeteryId,
    cemetery: { name: 'NT ' + cemeteryId },
    graveType: { name: 'Mộ đơn', defaultCapacity: 1 },
  };
}

function build(plots: { id: string; companyId: string; cemeteryId: string }[]) {
  const quote = vi.fn().mockResolvedValue({
    scheduleId: 'sch-1',
    effectiveFrom: new Date('2026-01-01'),
    lines: [],
    totalAmount: '0',
  });

  const prisma = {
    customer: {
      findUnique: vi.fn().mockResolvedValue({
        id: CUSTOMER,
        customerCode: 'KH-0001',
        // Công ty của KHÁCH cố ý KHÁC mọi công ty của mộ — nếu thẻ lỡ lấy công ty này thì lộ.
        companyId: CO_KHACH,
        orgName: null,
        phone: null,
        person: null,
      }),
    },
    graveUsageRight: {
      findMany: vi.fn().mockResolvedValue(
        plots.map((p, i) => ({
          id: 'ur-' + String(i),
          gravePlotId: p.id,
          status: 'Active',
          effectiveFrom: new Date('2020-01-01'),
        })),
      ),
    },
    gravePlot: {
      findMany: vi
        .fn()
        .mockResolvedValue(plots.map((p) => plotRow(p.id, p.companyId, p.cemeteryId))),
    },
    burialRecord: { findMany: vi.fn().mockResolvedValue([]) },
    cardPrintLog: { findFirst: vi.fn().mockResolvedValue(null) },
    graveCardFeeCharge: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;

  const assertPlotFor = vi.fn().mockResolvedValue(undefined);
  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);

  const svc = new CardsService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
    { decrypt: vi.fn() } as unknown as PiiService,
    { holdsForMasking: vi.fn().mockResolvedValue(false) } as unknown as PermissionsService,
    { quote } as unknown as CardFeesService,
    {} as unknown as CardApprovalsService,
  );
  return { svc, quote, assertPlotFor, assertCompanyFor };
}

describe('thẻ mộ theo CÔNG TY CỦA PHẦN MỘ, không theo công ty của khách', () => {
  it('khách chỉ có mộ ở MỘT công ty: thẻ mang công ty của mộ, không phải của khách', async () => {
    const { svc, quote } = build([{ id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' }]);

    const card = await svc.preview(CUSTOMER, VIEWER);

    expect(card.companyId).toBe(CO_A);
    expect(card.companyId).not.toBe(CO_KHACH);
    // Và bảng giá tra theo đúng công ty ấy — đây là nhánh TIỀN.
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: CO_A }),
      expect.anything(),
    );
  });

  /* Khách có mộ ở HAI công ty: một tờ thẻ không mang tiền của hai pháp nhân được. Hệ phải nói
   * rõ và nêu SỐ công ty, chứ không lặng lẽ gộp — gộp chính là thứ làm doanh thu về nhầm nhà
   * suốt từ 02/09 tới 19/09. */
  it('khách có mộ ở HAI công ty thì KHÔNG gộp một thẻ — nói rõ phải tách theo công ty', async () => {
    const { svc } = build([
      { id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' },
      { id: 'p2', companyId: CO_B, cemeteryId: 'nt-b1' },
    ]);

    await expect(svc.preview(CUSTOMER, VIEWER)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.preview(CUSTOMER, VIEWER)).rejects.toThrow(/2 công ty/);
  });

  /* Phạm vi vẫn hỏi trên TỪNG mộ, và hỏi bằng công ty CỦA MỘ. Ca này canh rằng việc lọc theo
   * công ty không vô tình bỏ qua phép kiểm nào. */
  it('vẫn hỏi phạm vi trên từng mộ, bằng công ty của chính mộ đó', async () => {
    const { svc, assertPlotFor } = build([{ id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' }]);

    await svc.preview(CUSTOMER, VIEWER);

    expect(assertPlotFor).toHaveBeenCalledWith('u1', 'cemetery.card.view', CO_A, 'nt-a1');
  });

  /* KHÔNG hỏi phạm vi trên công ty của khách: hỏi thêm vế đó chặn đúng người quản lý nghĩa
   * trang B khi họ cấp thẻ cho mộ của B — cùng lỗi đã phải sửa ở `assertInScope`. */
  it('KHÔNG hỏi phạm vi trên công ty của khách', async () => {
    const { svc, assertCompanyFor } = build([{ id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' }]);

    await svc.preview(CUSTOMER, VIEWER);

    expect(assertCompanyFor).not.toHaveBeenCalledWith('u1', 'cemetery.card.view', CO_KHACH);
  });
});
