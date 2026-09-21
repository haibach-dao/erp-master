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
    company: { findUnique: vi.fn().mockResolvedValue({ name: 'Cty ' + CO_A }) },
    cardPrintLog: { findFirst: vi.fn().mockResolvedValue(null) },
    graveCardFeeCharge: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        cardPrintLog: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi
            .fn()
            .mockImplementation((args: { data: Record<string, unknown> }) =>
              Promise.resolve({ ...args.data }),
            ),
        },
      }),
    ),
  } as unknown as PrismaService;

  const assertPlotFor = vi.fn().mockResolvedValue(undefined);
  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);

  /* Hai cửa của đường CẤP. Ca chặn phải nổ TRƯỚC khi chạm tới chúng, nên chúng đứng đây
   * vừa để `issue` chạy được vừa để làm CHỨNG: được gọi tức là đã đi quá cửa chặn. */
  const resolveWaive = vi.fn().mockResolvedValue({ waived: false, waiveReason: null });
  const isRequired = vi.fn().mockResolvedValue(false);
  const recordCharges = vi.fn().mockResolvedValue([]);

  const svc = new CardsService(
    prisma,
    { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    { assertCompanyFor, assertPlotFor } as unknown as ScopeService,
    { decrypt: vi.fn() } as unknown as PiiService,
    { holdsForMasking: vi.fn().mockResolvedValue(false) } as unknown as PermissionsService,
    { quote, resolveWaive, recordCharges } as unknown as CardFeesService,
    {
      isRequired,
      assertApproved: vi.fn().mockResolvedValue(null),
    } as unknown as CardApprovalsService,
  );
  return { svc, quote, assertPlotFor, assertCompanyFor, resolveWaive };
}

/* Chữ ký của MỘT người — chính thứ không được phép đi kèm hai tờ thẻ của hai công ty. */
const ISSUE_DTO = {
  printReason: 'Cấp lần đầu',
  approvedBy: 'Nguyễn Văn A',
  approvedTitle: 'PHÓ GIÁM ĐỐC',
} as never;

describe('thẻ mộ theo CÔNG TY CỦA PHẦN MỘ, không theo công ty của khách', () => {
  it('khách chỉ có mộ ở MỘT công ty: thẻ mang công ty của mộ, không phải của khách', async () => {
    const { svc, quote } = build([{ id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' }]);

    const card = (await svc.preview(CUSTOMER, VIEWER)).cards[0]!;

    expect(card.companyId).toBe(CO_A);
    expect(card.companyId).not.toBe(CO_KHACH);
    // Và bảng giá tra theo đúng công ty ấy — đây là nhánh TIỀN.
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: CO_A }),
      expect.anything(),
    );
  });

  /* Khách có mộ ở HAI công ty: hệ TỰ CẮT thành hai thẻ, mỗi thẻ một công ty — khách vẫn MỘT
   * hồ sơ. Một tờ thẻ không mang tiền của hai pháp nhân được, còn bắt quầy bấm hai lần thì
   * cách nhanh nhất ở quầy là mở thêm hồ sơ khách ở công ty kia — đúng thứ vế "dùng chung
   * CSDL, hạn chế nhập lại" cấm. */
  it('khách có mộ ở HAI công ty: TỰ CẮT thành hai thẻ, mỗi thẻ một công ty', async () => {
    const { svc } = build([
      { id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' },
      { id: 'p2', companyId: CO_B, cemeteryId: 'nt-b1' },
    ]);

    const { cards } = await svc.preview(CUSTOMER, VIEWER);

    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.companyId)).toEqual([CO_A, CO_B]);
    // Mỗi thẻ chỉ gồm mộ của CHÍNH công ty đó — không tờ nào mang mộ của nhà kia.
    expect(cards[0]?.plots.map((p) => p.gravePlotId)).toEqual(['p1']);
    expect(cards[1]?.plots.map((p) => p.gravePlotId)).toEqual(['p2']);
  });

  /* Số lần cấp đánh theo KHÁCH, không theo công ty — cố ý: đổi sang đánh theo công ty là đổi
   * nghĩa con số ĐÃ IN trên tờ giấy khách đang cầm. Hai thẻ cấp cùng lúc vì thế mang hai số
   * LIỀN NHAU, và đó là câu trả lời đúng: chúng là hai lần cấp chứng từ khác nhau. */
  it('hai thẻ nhận số lần cấp NỐI TIẾP, không phải cùng một số', async () => {
    const { svc } = build([
      { id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' },
      { id: 'p2', companyId: CO_B, cemeteryId: 'nt-b1' },
    ]);

    const { cards } = await svc.preview(CUSTOMER, VIEWER);

    expect(cards.map((c) => c.nextPrintNumber)).toEqual([1, 2]);
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

/* CẤP THẺ — một lần bấm cấp ĐÚNG MỘT tờ.
 *
 * Bản đầu của lát này lặp qua từng công ty với CÙNG một `dto`, và lưới kiểm lúc đó xanh
 * hết: không ca nào hỏi xem chữ ký đi đâu. Mà `dto` mang `approvedBy`/`approvedTitle` của
 * MỘT người, còn người ký gắn theo nghĩa trang (luật 05/09) — nên vòng lặp ấy đóng tên một
 * người lên cả tờ của công ty họ không quản lý nghĩa trang, và tờ giấy ra khỏi quầy rồi thì
 * không ai đọc ngược lại được.
 */
describe('cấp thẻ: một lần cấp = một tờ = một công ty', () => {
  it('khách hai công ty mà KHÔNG khai công ty: CHẶN, và chặn TRƯỚC khi chạm tới tiền', async () => {
    const { svc, resolveWaive } = build([
      { id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' },
      { id: 'p2', companyId: CO_B, cemeteryId: 'nt-b1' },
    ]);

    await expect(svc.issue(CUSTOMER, ISSUE_DTO, VIEWER)).rejects.toBeInstanceOf(ConflictException);
    expect(resolveWaive).not.toHaveBeenCalled();
  });

  /* Công ty do client KHAI phải là công ty khách THẬT có mộ. Thiếu vế này, một lời gọi API
   * thẳng cấp được tờ thẻ mang tên công ty bất kỳ — `buildCard` lọc mộ theo công ty ấy nên
   * tờ thẻ KHÔNG CÓ MỘ NÀO, tức một chứng từ rỗng đã ăn số và có thể đã ăn phí. */
  it('khai một công ty khách không có mộ: CHẶN, không cấp tờ rỗng', async () => {
    const { svc, resolveWaive } = build([{ id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' }]);

    await expect(
      svc.issue(CUSTOMER, { ...(ISSUE_DTO as object), companyId: 'co-LA' } as never, VIEWER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(resolveWaive).not.toHaveBeenCalled();
  });

  /* Không phải "chặn tất cho chắc": khai đúng thì cấp được, và cấp ĐÚNG MỘT tờ của ĐÚNG
   * công ty đã khai — tờ của công ty kia không bị cấp kèm. */
  it('khai đúng công ty: cấp một tờ, của đúng công ty đó', async () => {
    const { svc, resolveWaive } = build([
      { id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' },
      { id: 'p2', companyId: CO_B, cemeteryId: 'nt-b1' },
    ]);

    const { issued } = await svc.issue(
      CUSTOMER,
      { ...(ISSUE_DTO as object), companyId: CO_B } as never,
      VIEWER,
    );

    expect(issued).toHaveLength(1);
    expect(issued[0]?.companyId).toBe(CO_B);
    expect(issued[0]?.plots.map((p) => p.gravePlotId)).toEqual(['p2']);
    // Và tiền tra theo công ty của tờ vừa cấp, không phải công ty kia.
    expect(resolveWaive).toHaveBeenCalledTimes(1);
  });

  // Khách một công ty: không phải khai gì cả, màn hình cũ không đổi một nhịp nào.
  it('khách một công ty: không khai cũng cấp được', async () => {
    const { svc } = build([{ id: 'p1', companyId: CO_A, cemeteryId: 'nt-a1' }]);

    const { issued } = await svc.issue(CUSTOMER, ISSUE_DTO, VIEWER);

    expect(issued.map((c) => c.companyId)).toEqual([CO_A]);
  });
});
