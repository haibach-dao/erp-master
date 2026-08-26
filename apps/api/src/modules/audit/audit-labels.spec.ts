import { describe, expect, it, vi } from 'vitest';
import {
  entityLabelFor,
  entityTypeLabel,
  resolveActorLabels,
  resolveEntityLabels,
} from './audit-labels';
import type { PrismaService } from '../../prisma/prisma.service';

function ev(entityType: string, entityId: string, actorId: string | null = 'u1') {
  return { actorId, actorType: 'USER', entityType, entityId };
}

function build(over: Record<string, unknown> = {}) {
  const calls: Record<string, number> = {};
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };

  const prisma = {
    user: {
      findMany: vi.fn().mockImplementation(() => {
        count('user');
        return Promise.resolve([
          { id: 'u1', email: 'thungan@indevco.vn' },
          { id: 'u2', email: 'quanly@indevco.vn' },
        ]);
      }),
    },
    person: {
      findMany: vi.fn().mockImplementation(() => {
        count('person');
        return Promise.resolve([
          { id: 'p1', fullName: 'Nguyễn Văn A' },
          { id: 'p2', fullName: 'Trần Thị B' },
        ]);
      }),
    },
    customer: {
      findMany: vi.fn().mockImplementation(() => {
        count('customer');
        return Promise.resolve([
          {
            id: 'c1',
            customerCode: 'KH-0001',
            orgName: null,
            person: { fullName: 'Nguyễn Văn A' },
          },
          { id: 'c2', customerCode: 'KH-0002', orgName: 'Công ty X', person: null },
        ]);
      }),
    },
    gravePlot: {
      findMany: vi.fn().mockImplementation(() => {
        count('gravePlot');
        return Promise.resolve([
          { id: 'g1', plotCode: 'A-01-05', cemetery: { name: 'An Lạc Viên' } },
        ]);
      }),
    },
    externalContract: {
      findMany: vi.fn().mockResolvedValue([{ id: 'ct1', contractNo: 'HD-001' }]),
    },
    burialRecord: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'br1', gravePlotId: 'g1', deceased: { person: { fullName: 'Lê Văn C' } } },
        ]),
    },
    serviceSubscription: {
      findMany: vi.fn().mockResolvedValue([{ id: 's1', catalog: { name: 'Chăm sóc mộ 1 năm' } }]),
    },
    familyRelationship: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'fr1',
          source: { fullName: 'Nguyễn Văn A' },
          target: { fullName: 'Trần Thị B' },
        },
      ]),
    },
    cardPrintLog: {
      findMany: vi.fn().mockResolvedValue([{ id: 'log1', printNumber: 2, customerId: 'c1' }]),
    },
    accessRule: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'ar1', effect: 'DENY', permissionCode: 'crm.*.*' }]),
    },
    fileObject: {
      findMany: vi.fn().mockResolvedValue([{ id: 'f1', originalName: 'giay-chung-tu.pdf' }]),
    },
    ...over,
  } as unknown as PrismaService;

  return { prisma, calls };
}

describe('nhãn nhật ký — người thao tác', () => {
  it('đổi id người dùng thành email', async () => {
    const { prisma } = build();

    const labels = await resolveActorLabels(prisma, [ev('person', 'p1', 'u1')]);

    expect(labels.get('u1')).toBe('thungan@indevco.vn');
  });

  it('không truy vấn gì khi mọi dòng đều do hệ thống sinh', async () => {
    const { prisma, calls } = build();

    const labels = await resolveActorLabels(prisma, [ev('person', 'p1', null)]);

    expect(labels.size).toBe(0);
    expect(calls.user).toBeUndefined();
  });

  it('gom id trùng lặp — 20 dòng cùng một người vẫn là MỘT lượt truy vấn', async () => {
    const { prisma, calls } = build();
    const rows = Array.from({ length: 20 }, () => ev('person', 'p1', 'u1'));

    await resolveActorLabels(prisma, rows);

    expect(calls.user).toBe(1);
  });
});

/* Điều đáng test nhất ở đây KHÔNG phải "nhãn có đúng chữ không" — mà là số LƯỢT TRUY VẤN.
 * Tra từng dòng là mẫu N+1: một trang 50 dòng thành 50 lượt, và nó chỉ lộ ra khi dữ liệu
 * đã nhiều. Test dưới đây neo cái bất biến đó lại.
 */
describe('nhãn nhật ký — số lượt truy vấn không phụ thuộc số dòng', () => {
  it('50 dòng cùng loại vẫn là MỘT lượt cho loại đó', async () => {
    const { prisma, calls } = build();
    const rows = Array.from({ length: 50 }, (_, i) => ev('person', i % 2 === 0 ? 'p1' : 'p2'));

    await resolveEntityLabels(prisma, rows);

    expect(calls.person).toBe(1);
  });

  it('ba loại khác nhau là ba lượt, không phải chín', async () => {
    const { prisma, calls } = build();
    const rows = [
      ev('person', 'p1'),
      ev('person', 'p2'),
      ev('customer', 'c1'),
      ev('customer', 'c2'),
      ev('grave_plot', 'g1'),
      ev('grave_plot', 'g1'),
    ];

    await resolveEntityLabels(prisma, rows);

    expect(calls.person).toBe(1);
    expect(calls.customer).toBe(1);
    expect(calls.gravePlot).toBe(1);
  });
});

describe('nhãn nhật ký — từng loại đối tượng', () => {
  it.each([
    ['person', 'p1', 'Nguyễn Văn A'],
    ['grave_plot', 'g1', 'A-01-05 · An Lạc Viên'],
    ['external_contract', 'ct1', 'HD-001'],
    ['burial_record', 'br1', 'Lê Văn C'],
    ['service_subscription', 's1', 'Chăm sóc mộ 1 năm'],
    ['family_relationship', 'fr1', 'Nguyễn Văn A → Trần Thị B'],
    ['card_print_log', 'log1', 'Lần cấp 02'],
    ['access_rule', 'ar1', 'DENY crm.*.*'],
    ['file', 'f1', 'giay-chung-tu.pdf'],
    ['file_object', 'f1', 'giay-chung-tu.pdf'],
  ])('%s → nhãn đọc được', async (type, id, expected) => {
    const { prisma } = build();

    const labels = await resolveEntityLabels(prisma, [ev(type, id)]);

    expect(entityLabelFor(labels, type, id)).toBe(expected);
  });

  it('khách hàng cá nhân lấy tên nhân thân, khách tổ chức lấy tên tổ chức', async () => {
    const { prisma } = build();

    const labels = await resolveEntityLabels(prisma, [ev('customer', 'c1'), ev('customer', 'c2')]);

    expect(entityLabelFor(labels, 'customer', 'c1')).toBe('Nguyễn Văn A · KH-0001');
    expect(entityLabelFor(labels, 'customer', 'c2')).toBe('Công ty X · KH-0002');
  });
});

/* Nhật ký sống LÂU HƠN thứ nó nói về. Đối tượng bị xoá, hoặc loại đối tượng chưa có
 * resolver, thì dòng nhật ký vẫn phải hiện ra — mất một cái tên còn được, mất một dòng
 * nhật ký thì không.
 */
describe('nhãn nhật ký — khi tra không ra', () => {
  it('loại chưa có resolver thì rơi về id rút gọn, không vỡ', async () => {
    const { prisma } = build();

    const labels = await resolveEntityLabels(prisma, [ev('test', '01M0SJQMZ8R00Y74GFT4RDM8YP')]);

    expect(entityLabelFor(labels, 'test', '01M0SJQMZ8R00Y74GFT4RDM8YP')).toBe('…T4RDM8YP');
  });

  it('đối tượng đã bị xoá thì rơi về id rút gọn', async () => {
    const { prisma } = build({ person: { findMany: vi.fn().mockResolvedValue([]) } });

    const labels = await resolveEntityLabels(prisma, [ev('person', 'da-xoa-0123456789')]);

    expect(entityLabelFor(labels, 'person', 'da-xoa-0123456789')).toBe('…23456789');
  });

  it('id ngắn thì hiện nguyên, không cắt cho có', async () => {
    const { prisma } = build();

    const labels = await resolveEntityLabels(prisma, [ev('test', 'abc')]);

    expect(entityLabelFor(labels, 'test', 'abc')).toBe('abc');
  });

  it('nhãn loại lạ hiện nguyên mã thay vì để trống', () => {
    expect(entityTypeLabel('person')).toBe('Nhân thân');
    expect(entityTypeLabel('loai_la_hoac_moi')).toBe('loai_la_hoac_moi');
  });
});
