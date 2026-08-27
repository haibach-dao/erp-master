import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CemeteryService } from './cemetery.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* Caller mang theo MÃ QUYỀN đang thi hành, không chỉ userId — phạm vi được tính theo
 * TỪNG mã, nên truyền thiếu mã là kiểm phạm vi trên một câu hỏi khác câu đang chạy. */
const CALLER_RELEASE: Caller = { userId: 'u1', permission: 'cemetery.usage_right.release' };
const CALLER_TRANSFER: Caller = { userId: 'u1', permission: 'cemetery.usage_right.transfer' };

const RIGHT = 'ur-1';
const PLOT = 'plot-1';
const OLD_HOLDER = 'cus-old';
const NEW_HOLDER = 'cus-new';

function build(
  opts: {
    rightStatus?: string;
    rightMissing?: boolean;
    plotStatus?: string;
    burials?: number;
    newHolderMissing?: boolean;
    newHolderDeceased?: boolean;
  } = {},
) {
  const {
    rightStatus = 'Active',
    rightMissing = false,
    plotStatus = 'Allocated',
    burials = 0,
    newHolderMissing = false,
    newHolderDeceased = false,
  } = opts;

  const record = vi.fn().mockResolvedValue(undefined);
  const order: string[] = [];
  const updateRight = vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
    order.push(`update:${String(args.data.status)}`);
    return Promise.resolve({ id: RIGHT, ...args.data });
  });
  const createRight = vi.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
    order.push('create');
    return Promise.resolve({ id: 'ur-2', ...args.data });
  });
  const updatePlot = vi.fn().mockResolvedValue({});
  const createHistory = vi.fn().mockResolvedValue({});

  const prisma = {
    graveUsageRight: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          rightMissing
            ? null
            : { id: RIGHT, gravePlotId: PLOT, holderCustomerId: OLD_HOLDER, status: rightStatus },
        ),
    },
    gravePlot: {
      findUnique: vi.fn().mockResolvedValue({
        id: PLOT,
        companyId: 'co-1',
        cemeteryId: 'cem-1',
        plotCode: 'A-01-05',
        status: plotStatus,
      }),
    },
    burialRecord: { count: vi.fn().mockResolvedValue(burials) },
    customer: {
      findUnique: vi.fn().mockResolvedValue(
        newHolderMissing
          ? null
          : {
              id: NEW_HOLDER,
              customerCode: 'KH-0002',
              orgName: null,
              person: {
                fullName: 'Trần Thị B',
                deceased: newHolderDeceased ? { id: 'dec-1' } : null,
              },
            },
      ),
    },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        graveUsageRight: { update: updateRight, create: createRight },
        gravePlot: { update: updatePlot },
        gravePlotStatusHistory: { create: createHistory },
      }),
    ),
  } as unknown as PrismaService;

  const svc = new CemeteryService(
    prisma,
    { assertCompanyFor: vi.fn(), assertSiteFor: vi.fn() } as unknown as ScopeService,
    { record } as unknown as AuditService,
  );
  return { svc, record, order, updateRight, createRight, updatePlot, createHistory };
}

/* Thu hồi = mộ trở về TRỐNG. Một phần mộ có người nằm mà không ai đứng tên là hồ sơ không
 * ai chịu trách nhiệm — người nhà tới hỏi thì không có ai để hỏi.
 */
describe('thu hồi quyền sử dụng', () => {
  it('mộ trống thì thu hồi được, và mộ về Available', async () => {
    const { svc, updatePlot, createHistory } = build({ burials: 0 });

    await svc.releaseUsageRight(RIGHT, { reason: 'nhập nhầm chủ' }, CALLER_RELEASE);

    expect(updatePlot).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Available' }) }),
    );
    expect(createHistory).toHaveBeenCalledOnce();
  });

  it('mộ CÒN người an táng thì chặn, và chỉ sang SANG TÊN', async () => {
    const { svc, updatePlot } = build({ burials: 2 });

    await expect(svc.releaseUsageRight(RIGHT, { reason: 'x' }, CALLER_RELEASE)).rejects.toThrow(
      /còn 2 hồ sơ an táng.*SANG TÊN/s,
    );
    expect(updatePlot).not.toHaveBeenCalled();
  });

  it('quyền đã chấm dứt rồi thì không thao tác lại được', async () => {
    const { svc } = build({ rightStatus: 'Ended' });

    await expect(svc.releaseUsageRight(RIGHT, { reason: 'x' }, CALLER_RELEASE)).rejects.toThrow(
      /đã chấm dứt/,
    );
  });

  it('quyền đã sang tên thì báo đúng chữ "sang tên", không nói "chấm dứt"', async () => {
    const { svc } = build({ rightStatus: 'Transferred' });

    await expect(svc.releaseUsageRight(RIGHT, { reason: 'x' }, CALLER_RELEASE)).rejects.toThrow(
      /đã sang tên/,
    );
  });

  it('không tìm thấy quyền thì 404', async () => {
    const { svc } = build({ rightMissing: true });

    await expect(svc.releaseUsageRight(RIGHT, { reason: 'x' }, CALLER_RELEASE)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ghi audit kèm lý do — thu hồi là tước quyền của một người', async () => {
    const { svc, record } = build();

    await svc.releaseUsageRight(RIGHT, { reason: 'khách trả lại mộ' }, CALLER_RELEASE);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRAVE.USAGE_RIGHT_RELEASED',
        afterData: expect.objectContaining({ reason: 'khách trả lại mộ' }),
      }),
    );
  });
});

/* Sang tên là đường THỪA KẾ: `assignUsageRight` chặn người đã mất đứng tên, nên nếu không
 * có đường này thì mộ của người đã mất kẹt vĩnh viễn ở tên họ.
 */
describe('sang tên phần mộ', () => {
  it('sang tên được, và mộ VẪN có người an táng cũng không sao', async () => {
    const { svc, createRight } = build({ burials: 3 });

    await svc.transferUsageRight(
      RIGHT,
      { toCustomerId: NEW_HOLDER, reason: 'thừa kế sau khi chủ mộ mất' },
      CALLER_TRANSFER,
    );

    expect(createRight).toHaveBeenCalledOnce();
  });

  /* Partial unique index chỉ cho MỘT quyền Active trên mỗi mộ. Tạo quyền mới trước khi
   * đóng quyền cũ là va thẳng vào ràng buộc đó — thứ tự này không đổi được. */
  it('ĐÓNG quyền cũ trước rồi mới tạo quyền mới', async () => {
    const { svc, order } = build();

    await svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'thừa kế' }, CALLER_TRANSFER);

    expect(order).toEqual(['update:Transferred', 'create']);
  });

  it('nối chuỗi previousRightId để đọc ngược được lịch sử chủ mộ', async () => {
    const { svc, createRight } = build();

    await svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'thừa kế' }, CALLER_TRANSFER);

    expect(createRight).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ previousRightId: RIGHT, sourceContractId: 'TRANSFER' }),
      }),
    );
  });

  it('chủ MỚI đã mất thì chặn — cùng luật với gán mộ', async () => {
    const { svc, createRight } = build({ newHolderDeceased: true });

    await expect(
      svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'thừa kế' }, CALLER_TRANSFER),
    ).rejects.toThrow(/đã mất.*thừa kế còn sống/s);
    expect(createRight).not.toHaveBeenCalled();
  });

  it('sang tên cho chính chủ hiện tại thì chặn', async () => {
    const { svc, createRight } = build();

    await expect(
      svc.transferUsageRight(RIGHT, { toCustomerId: OLD_HOLDER, reason: 'x' }, CALLER_TRANSFER),
    ).rejects.toThrow(/trùng chủ hiện tại/);
    expect(createRight).not.toHaveBeenCalled();
  });

  it('không tìm thấy chủ mới thì 404', async () => {
    const { svc } = build({ newHolderMissing: true });

    await expect(
      svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'x' }, CALLER_TRANSFER),
    ).rejects.toThrow(NotFoundException);
  });

  /* Sang tên đổi NGƯỜI CHỊU TRÁCH NHIỆM, không đổi hiện trạng phần mộ. Đụng vào trạng
   * thái mộ ở đây là làm mộ có người nằm bỗng thành trống. */
  it('KHÔNG đụng trạng thái phần mộ', async () => {
    const { svc, updatePlot, createHistory } = build({ burials: 1 });

    await svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'thừa kế' }, CALLER_TRANSFER);

    expect(updatePlot).not.toHaveBeenCalled();
    expect(createHistory).not.toHaveBeenCalled();
  });

  it('audit ghi cả chủ cũ lẫn chủ mới', async () => {
    const { svc, record } = build();

    await svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'thừa kế' }, CALLER_TRANSFER);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GRAVE.USAGE_RIGHT_TRANSFERRED',
        beforeData: expect.objectContaining({ holderCustomerId: OLD_HOLDER }),
        afterData: expect.objectContaining({ holderCustomerId: NEW_HOLDER }),
      }),
    );
  });

  it('mọi trường hợp chặn đều là 409', async () => {
    for (const opts of [{ newHolderDeceased: true }, { rightStatus: 'Ended' }]) {
      await expect(
        build(opts).svc.transferUsageRight(RIGHT, { toCustomerId: NEW_HOLDER, reason: 'x' }, CALLER_TRANSFER),
      ).rejects.toThrow(ConflictException);
    }
  });
});
