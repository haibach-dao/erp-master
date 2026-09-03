import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TagsService } from './tags.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* THẺ NHÃN — anh Bách chốt 02–03/09/2026: hai danh mục TÁCH RIÊNG, gỡ thẻ thì LƯU VẾT,
 * đợt 1 thẻ không chặn nghiệp vụ nào.
 *
 * Bộ test này canh ba thứ dễ mất nhất khi ai đó sửa sau này:
 *   1. Gỡ thẻ là GHI `removedAt`, KHÔNG xoá dòng.
 *   2. Thẻ đã ngừng dùng không gắn mới được (nhưng thẻ đang gắn vẫn đọc được tên).
 *   3. Thẻ của công ty khác không gắn được — khoá ngoại KHÔNG bắt được ca này.
 */

const CALLER: Caller = { userId: 'u1', permission: 'cemetery.plot_tag.assign' };
const CALLER_CUS: Caller = { userId: 'u1', permission: 'crm.customer_tag.assign' };

const PLOT = { id: 'plot-1', companyId: 'co-1', cemeteryId: 'cem-1', plotCode: 'A-01' };
const CUSTOMER = { id: 'kh-1', companyId: 'co-1' };

function tagType(over: Record<string, unknown> = {}) {
  return { id: 'tt-1', code: 'can-sua-bia', name: 'Cần sửa bia', status: 'Active', ...over };
}

function build(
  opts: {
    plotTagType?: unknown;
    customerTagType?: unknown;
    existingTag?: unknown;
    createThrowsP2002?: boolean;
  } = {},
) {
  const created = { id: 'gt-1' };
  const create =
    opts.createThrowsP2002 === true
      ? vi.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          }),
        )
      : vi.fn().mockResolvedValue(created);
  const update = vi
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'gt-1', ...args.data }),
    );

  const prisma = {
    gravePlot: { findUnique: vi.fn().mockResolvedValue(PLOT) },
    customer: { findUnique: vi.fn().mockResolvedValue(CUSTOMER) },
    gravePlotTagType: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.plotTagType === undefined ? tagType() : opts.plotTagType),
      create: vi.fn().mockResolvedValue({ id: 'tt-new', code: 'x', name: 'X' }),
    },
    customerTagType: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.customerTagType === undefined
            ? tagType({ code: 'thieu-cccd', subject: 'HO_SO' })
            : opts.customerTagType,
        ),
      create: vi.fn().mockResolvedValue({ id: 'tt-new', code: 'x', name: 'X', subject: 'HO_SO' }),
    },
    gravePlotTag: {
      create,
      update,
      findFirst: vi.fn().mockResolvedValue(opts.existingTag ?? null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    customerTag: {
      create,
      update,
      findFirst: vi.fn().mockResolvedValue(opts.existingTag ?? null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const assertCompanyFor = vi.fn().mockResolvedValue(undefined);
  const assertSiteFor = vi.fn().mockResolvedValue(undefined);
  const record = vi.fn().mockResolvedValue(undefined);
  const svc = new TagsService(
    prisma,
    { record } as unknown as AuditService,
    { assertCompanyFor, assertSiteFor } as unknown as ScopeService,
  );
  return { svc, prisma, create, update, record, assertCompanyFor, assertSiteFor };
}

describe('gắn thẻ cho phần mộ', () => {
  it('gắn được thẻ đang dùng, và ghi nhật ký kiểm toán', async () => {
    const { svc, create, record } = build();
    await svc.assignPlotTag('plot-1', { tagTypeId: 'tt-1' }, CALLER);
    expect(create).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLOT_TAG.ASSIGNED' }));
  });

  it('thẻ đã NGỪNG DÙNG thì không gắn mới được', async () => {
    const { svc, create } = build({ plotTagType: tagType({ status: 'Retired' }) });
    await expect(svc.assignPlotTag('plot-1', { tagTypeId: 'tt-1' }, CALLER)).rejects.toThrow(
      ConflictException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  /* Ranh giới giữa thẻ mộ và thẻ khách là CẤU TRÚC, không phải một câu `if`: hai bảng danh
   * mục, hai khoá ngoại. Ở tầng service nó hiện ra thành `findUnique` trên ĐÚNG bảng danh
   * mục trả `null` cho một id thuộc danh mục kia — nên ca này và ca "thẻ không tồn tại" là
   * cùng một đường mã, và cùng một câu trả lời cho người dùng. */
  it('id thuộc danh mục thẻ KHÁCH thì không gắn lên mộ được', async () => {
    const { svc, create } = build({ plotTagType: null });
    await expect(svc.assignPlotTag('plot-1', { tagTypeId: 'tt-1' }, CALLER)).rejects.toThrow(
      /danh mục thẻ phần mộ/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('id thuộc danh mục thẻ MỘ thì không gắn lên khách được', async () => {
    const { svc, create } = build({ customerTagType: null });
    await expect(svc.assignCustomerTag('kh-1', { tagTypeId: 'tt-1' }, CALLER_CUS)).rejects.toThrow(
      /danh mục thẻ khách hàng/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('thẻ không có trong danh mục thì báo không tìm thấy', async () => {
    const { svc } = build({ plotTagType: null });
    await expect(svc.assignPlotTag('plot-1', { tagTypeId: 'xx' }, CALLER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('gắn trùng thẻ đang có trả câu tiếng Việt, không phải lỗi Postgres thô', async () => {
    const { svc } = build({ createThrowsP2002: true });
    await expect(svc.assignPlotTag('plot-1', { tagTypeId: 'tt-1' }, CALLER)).rejects.toThrow(
      /Đang mang thẻ/,
    );
  });

  /* Thẻ mộ kể tình trạng thực địa, nên phạm vi phải bó tới NGHĨA TRANG chứ không dừng ở
   * công ty — nếu không, người phụ trách nghĩa trang A sửa được thực địa nghĩa trang B. */
  it('bó phạm vi theo CẢ công ty lẫn nghĩa trang', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build();
    await svc.assignPlotTag('plot-1', { tagTypeId: 'tt-1' }, CALLER);
    expect(assertCompanyFor).toHaveBeenCalledWith('u1', CALLER.permission, 'co-1');
    expect(assertSiteFor).toHaveBeenCalledWith('u1', CALLER.permission, 'cem-1');
  });
});

describe('gỡ thẻ — LƯU VẾT, không xoá dòng', () => {
  const existing = { id: 'gt-1', tagType: { code: 'can-sua-bia' } };

  it('gỡ là GHI removedAt/removedBy, không gọi delete', async () => {
    const { svc, update } = build({ existingTag: existing });
    await svc.removePlotTag('plot-1', 'tt-1', { reason: 'đã sửa xong' }, CALLER);
    const data = update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.removedAt).toBeInstanceOf(Date);
    expect(data.removedBy).toBe('u1');
    expect(data.removeReason).toBe('đã sửa xong');
  });

  it('gỡ thẻ không đang gắn thì báo không tìm thấy', async () => {
    const { svc } = build({ existingTag: null });
    await expect(svc.removePlotTag('plot-1', 'tt-1', {}, CALLER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('ghi nhật ký kiểm toán khi gỡ', async () => {
    const { svc, record } = build({ existingTag: existing });
    await svc.removePlotTag('plot-1', 'tt-1', {}, CALLER);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLOT_TAG.REMOVED' }));
  });
});

describe('thẻ khách hàng — nhánh TÁCH HẲN khỏi thẻ mộ', () => {
  it('gắn được, và nhật ký ghi cả `subject` của thẻ', async () => {
    const { svc, record } = build();
    await svc.assignCustomerTag('kh-1', { tagTypeId: 'tt-1' }, CALLER_CUS);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_TAG.ASSIGNED',
        afterData: expect.objectContaining({ subject: 'HO_SO' }),
      }),
    );
  });

  /* Khách hàng chỉ có công ty, không có nghĩa trang — một `assertCompanyFor`, và KHÔNG bịa
   * ra `cemeteryId` để gọi `assertSiteFor`. */
  it('bó phạm vi theo công ty, KHÔNG hỏi nghĩa trang', async () => {
    const { svc, assertCompanyFor, assertSiteFor } = build();
    await svc.assignCustomerTag('kh-1', { tagTypeId: 'tt-1' }, CALLER_CUS);
    expect(assertCompanyFor).toHaveBeenCalledWith('u1', CALLER_CUS.permission, 'co-1');
    expect(assertSiteFor).not.toHaveBeenCalled();
  });

  it('gỡ thẻ khách cũng LƯU VẾT', async () => {
    const { svc, update } = build({ existingTag: { id: 'ct-1', tagType: { code: 'thieu-cccd' } } });
    await svc.removeCustomerTag('kh-1', 'tt-1', { reason: 'đã bổ sung' }, CALLER_CUS);
    const data = update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data.removedAt).toBeInstanceOf(Date);
    expect(data.removedBy).toBe('u1');
  });
});

describe('danh mục thẻ', () => {
  it('mã thẻ trùng trả câu tiếng Việt, không phải lỗi Postgres thô', async () => {
    const { svc, prisma } = build();
    (
      prisma as unknown as { gravePlotTagType: { create: ReturnType<typeof vi.fn> } }
    ).gravePlotTagType.create = vi
      .fn()
      .mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
    await expect(
      svc.createPlotTagType({ code: 'can-sua-bia', name: 'Cần sửa bia' }, 'u1'),
    ).rejects.toThrow(/đã có trong danh mục/);
  });

  /* Danh mục thẻ MỘ cố ý không có `subject` — thẻ mộ nói về một VẬT. Canh ở đây để không ai
   * "thêm cho nhất quán" rồi mở đường cho một nhận định đi vào bảng thẻ mộ. */
  it('tạo thẻ MỘ không gửi subject xuống CSDL', async () => {
    const { svc, prisma } = build();
    await svc.createPlotTagType({ code: 'can-sua-bia', name: 'Cần sửa bia' }, 'u1');
    const create = (prisma as unknown as { gravePlotTagType: { create: ReturnType<typeof vi.fn> } })
      .gravePlotTagType.create;
    expect(create.mock.calls[0]?.[0]?.data).not.toHaveProperty('subject');
  });

  it('tạo thẻ KHÁCH truyền nguyên vẹn subject xuống CSDL', async () => {
    const { svc, prisma } = build();
    await svc.createCustomerTagType(
      { code: 'thieu-cccd', name: 'Thiếu CCCD', subject: 'HO_SO' },
      'u1',
    );
    const create = (prisma as unknown as { customerTagType: { create: ReturnType<typeof vi.fn> } })
      .customerTagType.create;
    expect(create.mock.calls[0]?.[0]?.data).toMatchObject({ subject: 'HO_SO' });
  });
});
