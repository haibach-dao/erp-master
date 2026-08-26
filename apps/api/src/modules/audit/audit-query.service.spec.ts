import { describe, expect, it, vi } from 'vitest';
import { AuditQueryService } from './audit-query.service';
import type { PrismaService } from '../../prisma/prisma.service';

function build(over: { groups?: Record<string, unknown[]>; users?: unknown[] } = {}) {
  const groups = over.groups ?? {
    actorId: [
      { actorId: 'u2', _count: { _all: 3 } },
      { actorId: 'u1', _count: { _all: 10 } },
      { actorId: null, _count: { _all: 5 } },
    ],
    action: [
      { action: 'PERSON.CREATED', _count: { _all: 15 } },
      { action: 'CUSTOMER.CREATED', _count: { _all: 7 } },
    ],
    entityType: [
      { entityType: 'person', _count: { _all: 15 } },
      { entityType: 'grave_plot', _count: { _all: 2 } },
    ],
    result: [
      { result: 'SUCCESS', _count: { _all: 40 } },
      { result: 'DENIED', _count: { _all: 1 } },
    ],
  };

  const groupBy = vi.fn().mockImplementation((args: { by: string[] }) => {
    const key = args.by[0];
    return Promise.resolve(key === undefined ? [] : (groups[key] ?? []));
  });

  const prisma = {
    auditEvent: { groupBy },
    user: {
      findMany: vi.fn().mockResolvedValue(
        over.users ?? [
          { id: 'u1', email: 'zeta@indevco.vn' },
          { id: 'u2', email: 'alpha@indevco.vn' },
        ],
      ),
    },
  } as unknown as PrismaService;

  return { svc: new AuditQueryService(prisma), prisma, groupBy };
}

describe('facets — giá trị để dựng ô chọn', () => {
  it('đổi id người thao tác thành email', async () => {
    const { svc } = build();

    const f = await svc.facets();

    expect(f.actors.map((a) => a.label)).toEqual(['alpha@indevco.vn', 'zeta@indevco.vn']);
  });

  /* Dòng do hệ thống sinh có `actorId = null`. Không thể lọc theo "không có ai" vì DTO
   * nhận chuỗi — để nó lọt vào ô chọn là tạo ra một mục bấm vào thì lọc ra rỗng. */
  it('bỏ dòng do hệ thống sinh khỏi ô chọn người thao tác', async () => {
    const { svc } = build();

    const f = await svc.facets();

    expect(f.actors).toHaveLength(2);
    expect(f.actors.every((a) => a.id !== null)).toBe(true);
  });

  it('sắp người thao tác theo email, không theo thứ tự CSDL trả về', async () => {
    // Nguồn trả u2 trước u1; email của u2 là "alpha" nên nó vẫn phải đứng đầu.
    const { svc } = build();

    const f = await svc.facets();

    expect(f.actors[0]?.label).toBe('alpha@indevco.vn');
  });

  it('giữ số lượng để người rà soát biết nhìn đâu trước', async () => {
    const { svc } = build();

    const f = await svc.facets();

    expect(f.actors.find((a) => a.id === 'u1')?.count).toBe(10);
    expect(f.actions.find((a) => a.code === 'PERSON.CREATED')?.count).toBe(15);
    expect(f.results.find((r) => r.code === 'DENIED')?.count).toBe(1);
  });

  it('kèm nhãn tiếng Việt cho loại đối tượng', async () => {
    const { svc } = build();

    const f = await svc.facets();

    expect(f.entityTypes.find((t) => t.code === 'person')?.label).toBe('Nhân thân');
    expect(f.entityTypes.find((t) => t.code === 'grave_plot')?.label).toBe('Phần mộ');
  });

  it('tài khoản đã xoá thì hiện id thay vì bỏ mất dòng', async () => {
    const { svc } = build({ users: [{ id: 'u1', email: 'con@indevco.vn' }] });

    const f = await svc.facets();

    expect(f.actors.map((a) => a.label).sort()).toEqual(['con@indevco.vn', 'u2']);
  });

  it('nhật ký rỗng thì trả bốn danh sách rỗng, không nổ', async () => {
    const { svc, prisma } = build({
      groups: { actorId: [], action: [], entityType: [], result: [] },
    });

    const f = await svc.facets();

    expect(f).toEqual({ actors: [], actions: [], entityTypes: [], results: [] });
    // Không có actor nào thì đừng gọi bảng users chỉ để nhận về mảng rỗng.
    expect(
      (prisma as unknown as { user: { findMany: ReturnType<typeof vi.fn> } }).user.findMany,
    ).not.toHaveBeenCalled();
  });

  it('bốn nhóm là BỐN lượt group-by, không phải bốn lượt quét bảng riêng lẻ', async () => {
    const { svc, groupBy } = build();

    await svc.facets();

    expect(groupBy).toHaveBeenCalledTimes(4);
  });
});
