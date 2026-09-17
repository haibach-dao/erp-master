import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CemeteryService } from './cemetery.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* Caller mang theo MÃ QUYỀN đang thi hành, không chỉ userId — phạm vi được tính theo
 * TỪNG mã, nên truyền thiếu mã là kiểm phạm vi trên một câu hỏi khác câu đang chạy. */
const CALLER_ASSIGN: Caller = { userId: 'u1', permission: 'cemetery.usage_right.assign' };

const PLOT = 'plot-1';
const CUSTOMER = 'cus-1';

function build(
  opts: {
    plotStatus?: string;
    plotMissing?: boolean;
    customerMissing?: boolean;
    ownerDeceased?: boolean;
    existingRight?: { id: string; holderCustomerId: string } | null;
    /** Công ty của KHÁCH. Mặc định trùng công ty của mộ; đặt khác để dựng CẶP LỆCH. */
    customerCompanyId?: string;
  } = {},
) {
  const {
    plotStatus = 'Available',
    plotMissing = false,
    customerMissing = false,
    ownerDeceased = false,
    existingRight = null,
    customerCompanyId = 'co-1',
  } = opts;

  const record = vi.fn().mockResolvedValue(undefined);
  const createRight = vi
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...args.data, id: 'ur-new' }),
    );
  const updatePlot = vi.fn().mockResolvedValue({});
  const createHistory = vi.fn().mockResolvedValue({});

  const prisma = {
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue(
        plotMissing
          ? null
          : {
              id: PLOT,
              companyId: 'co-1',
              cemeteryId: 'cem-1',
              plotCode: 'A-01-05',
              status: plotStatus,
            },
      ),
    },
    customer: {
      findUnique: vi.fn().mockResolvedValue(
        customerMissing
          ? null
          : {
              id: CUSTOMER,
              customerCode: 'KH-0001',
              companyId: customerCompanyId,
              person: {
                id: 'p1',
                fullName: 'Nguyễn Văn A',
                deceased: ownerDeceased ? { id: 'dec-1' } : null,
              },
            },
      ),
    },
    graveUsageRight: { findFirst: vi.fn().mockResolvedValue(existingRight) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        graveUsageRight: { create: createRight },
        gravePlot: { update: updatePlot },
        gravePlotStatusHistory: { create: createHistory },
      }),
    ),
  } as unknown as PrismaService;

  const svc = new CemeteryService(
    prisma,
    { assertCompanyFor: vi.fn(), assertPlotFor: vi.fn() } as unknown as ScopeService,
    { record } as unknown as AuditService,
  );
  return { svc, record, createRight, updatePlot, createHistory };
}

const dto = { gravePlotId: PLOT, holderCustomerId: CUSTOMER };

/* Luật nghiệp vụ chủ doanh nghiệp chốt 26/08/2026: chỉ khách CÒN SỐNG mới đứng tên mộ.
 * Người đã mất không đứng tên tài sản — quyền của họ phải đi qua thừa kế, và thừa kế là
 * một hồ sơ có người duyệt chứ không phải một lần bấm nút.
 */
describe('gán mộ — chủ mộ phải còn sống', () => {
  it('khách còn sống thì gán được', async () => {
    const { svc, createRight } = build();

    await svc.assignUsageRight(dto, CALLER_ASSIGN);

    expect(createRight).toHaveBeenCalledOnce();
  });

  it('khách ĐÃ MẤT thì chặn, và câu lỗi nói rõ phải đi đường thừa kế', async () => {
    const { svc, createRight } = build({ ownerDeceased: true });

    await expect(svc.assignUsageRight(dto, CALLER_ASSIGN)).rejects.toThrow(/đã mất|kế thừa/);
    expect(createRight).not.toHaveBeenCalled();
  });
});

describe('gán mộ — một mộ một chủ', () => {
  it('mộ đã có chủ KHÁC thì chặn', async () => {
    const { svc, createRight } = build({
      existingRight: { id: 'ur-old', holderCustomerId: 'cus-khac' },
    });

    await expect(svc.assignUsageRight(dto, CALLER_ASSIGN)).rejects.toThrow(/đã có chủ khác/);
    expect(createRight).not.toHaveBeenCalled();
  });

  it('mộ đã do CHÍNH khách này đứng tên thì báo rõ, không tạo trùng', async () => {
    const { svc, createRight } = build({
      existingRight: { id: 'ur-old', holderCustomerId: CUSTOMER },
    });

    await expect(svc.assignUsageRight(dto, CALLER_ASSIGN)).rejects.toThrow(/chính khách hàng này/);
    expect(createRight).not.toHaveBeenCalled();
  });

  /* Mộ `Occupied` mà không có quyền sử dụng nào là dữ liệu đã lệch. Gán đè lên là chôn
   * cái lệch đó xuống sâu hơn — bắt người ta rà soát trước. */
  it('mộ đang có người an táng mà không có chủ thì bắt rà soát, không gán đè', async () => {
    const { svc, createRight } = build({ plotStatus: 'Occupied' });

    await expect(svc.assignUsageRight(dto, CALLER_ASSIGN)).rejects.toThrow(/rà soát/);
    expect(createRight).not.toHaveBeenCalled();
  });
});

describe('gán mộ — hệ quả kèm theo', () => {
  it('mộ trống chuyển sang Đã phân bổ và ghi lịch sử trạng thái', async () => {
    const { svc, updatePlot, createHistory } = build({ plotStatus: 'Available' });

    await svc.assignUsageRight(dto, CALLER_ASSIGN);

    expect(updatePlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Allocated' }) }),
    );
    expect(createHistory).toHaveBeenCalledOnce();
  });

  it('mộ vốn đã Allocated thì không ghi thêm dòng lịch sử thừa', async () => {
    const { svc, updatePlot, createHistory } = build({ plotStatus: 'Allocated' });

    await svc.assignUsageRight(dto, CALLER_ASSIGN);

    expect(updatePlot).not.toHaveBeenCalled();
    expect(createHistory).not.toHaveBeenCalled();
  });

  /* Quyền sinh ra KHÔNG qua hợp đồng phải đọc ra được là như vậy — nếu không, sau này
   * không ai phân biệt được quyền nào đã qua thẩm định và quyền nào là gán tay. */
  it('ghi audit nói rõ quyền này không đi qua hợp đồng', async () => {
    const { svc, record, createRight } = build();

    await svc.assignUsageRight({ ...dto, note: 'chuyển từ hệ cũ' }, CALLER_ASSIGN);

    expect(createRight).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceContractId: 'MANUAL_ASSIGN' }),
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRAVE.USAGE_RIGHT_ASSIGNED',
        afterData: expect.objectContaining({ viaContract: false, note: 'chuyển từ hệ cũ' }),
      }),
    );
  });

  it('không tìm thấy mộ hoặc khách thì 404', async () => {
    await expect(
      build({ plotMissing: true }).svc.assignUsageRight(dto, CALLER_ASSIGN),
    ).rejects.toThrow(NotFoundException);
    await expect(
      build({ customerMissing: true }).svc.assignUsageRight(dto, CALLER_ASSIGN),
    ).rejects.toThrow(NotFoundException);
  });

  it('mọi lỗi chặn đều là 409, không phải 500', async () => {
    for (const opts of [
      { ownerDeceased: true },
      { existingRight: { id: 'x', holderCustomerId: 'y' } },
      { plotStatus: 'Occupied' },
    ]) {
      await expect(build(opts).svc.assignUsageRight(dto, CALLER_ASSIGN)).rejects.toThrow(
        ConflictException,
      );
    }
  });
});

/* QUYẾT ĐỊNH NGHIỆP VỤ — anh Bách chốt 17/09/2026: KHÁCH của công ty A ĐƯỢC ĐỨNG TÊN mộ của
 * công ty B.
 *
 * Nhóm test này KHÔNG canh một lỗi. Nó neo một QUYẾT ĐỊNH, và nó tồn tại vì câu hỏi đã được
 * đặt ngược lại: một lượt soi độc lập chỉ ra `assignUsageRight` không so hai công ty và gọi
 * đó là "nguồn sinh cặp lệch". Câu trả lời là cặp lệch HỢP LỆ — nên chỗ này phải có người
 * canh theo CHIỀU NGƯỢC: ai thêm ràng buộc "hai công ty phải trùng" vào đây là làm đỏ.
 *
 * Hệ quả cho mọi nơi khác: `customer.companyId` và `plot.companyId` KHÔNG bảo đảm trùng nhau.
 * Chỗ nào ghép một giá trị bên này với một giá trị bên kia thì phải quy lại từ ĐÚNG bản ghi.
 */
describe('quyền sử dụng mộ — khách công ty A ĐƯỢC đứng tên mộ công ty B', () => {
  it('cho qua khi công ty của khách KHÁC công ty của phần mộ', async () => {
    const { svc, createRight } = build({ customerCompanyId: 'co-KHAC' });

    await svc.assignUsageRight({ gravePlotId: PLOT, holderCustomerId: CUSTOMER }, CALLER_ASSIGN);

    expect(createRight).toHaveBeenCalled();
  });

  /* Các rào chắn KHÁC vẫn phải giữ nguyên — cho phép lệch công ty không có nghĩa là bỏ mọi
   * phép kiểm. Chủ mộ đã mất vẫn bị chặn, dù công ty có lệch hay không. */
  it('vẫn chặn chủ mộ ĐÃ MẤT, kể cả khi công ty lệch', async () => {
    const { svc } = build({ customerCompanyId: 'co-KHAC', ownerDeceased: true });

    await expect(
      svc.assignUsageRight({ gravePlotId: PLOT, holderCustomerId: CUSTOMER }, CALLER_ASSIGN),
    ).rejects.toThrow(/đã mất|kế thừa/);
  });
});
