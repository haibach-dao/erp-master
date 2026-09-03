import { describe, expect, it, vi } from 'vitest';
import { CustomersService } from './customers.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PiiService } from '../../common/pii/pii.service';
import type { AuditService } from '../audit/audit.service';
import type { ScopeService } from '../authorization/scope.service';
import type { Caller } from '../authorization/caller';

/* NƠI AN NGHỈ trên danh sách khách hàng.
 *
 * VÌ SAO BỘ TEST NÀY TỒN TẠI (chủ doanh nghiệp nêu 27/08/2026): danh sách có cột "phần mộ
 * đứng tên", nên người ĐÃ MẤT gần như luôn hiện "—" ở đó, và việc vừa an táng họ không
 * thấy đâu cả. Hai trục mộ là hai câu hỏi khác nhau:
 *
 *   - ĐỨNG TÊN  : khách là chủ mộ            -> `gravePlotCodes`
 *   - NẰM TRONG : khách đã được an táng vào  -> `restingPlaces`
 *
 * Gộp hai trục làm một cột chính là cách hồ sơ an táng trở nên vô hình. Nhóm test này giữ
 * chúng tách nhau, VÀ pin cái bẫy quy chiếu ở dưới.
 */
const CALLER: Caller = { userId: 'u1', permission: 'crm.customer.search' };

function build(
  opts: {
    rows?: { id: string; personId: string | null }[];
    burials?: { gravePlotId: string; slotNumber: number | null; personId: string }[];
    owned?: { holderCustomerId: string; gravePlotId: string }[];
    plotCodes?: Record<string, string>;
  } = {},
) {
  const {
    rows = [{ id: 'cus-1', personId: 'per-1' }],
    burials = [],
    owned = [],
    plotCodes = { 'plot-1': 'P1', 'plot-2': 'P2' },
  } = opts;

  const customerFindMany = vi.fn().mockResolvedValue(
    rows.map((r) => ({
      id: r.id,
      // `search` chọn `person: { select: { id, ... } }` — `person.id` CHÍNH LÀ personId.
      person: r.personId === null ? null : { id: r.personId, deceased: { dateOfDeath: null } },
    })),
  );
  const burialFindMany = vi.fn().mockResolvedValue(
    burials.map((b) => ({
      gravePlotId: b.gravePlotId,
      slotNumber: b.slotNumber,
      deceased: { personId: b.personId },
    })),
  );
  const plotFindMany = vi
    .fn()
    .mockImplementation((args: { where: { id?: { in?: string[] }; cemeteryId?: string } }) => {
      if (args.where.cemeteryId !== undefined) return Promise.resolve([]);
      const ids = args.where.id?.in ?? [];
      return Promise.resolve(
        ids
          .filter((id) => plotCodes[id] !== undefined)
          .map((id) => ({ id, plotCode: plotCodes[id] })),
      );
    });

  const prisma = {
    customer: { findMany: customerFindMany, count: vi.fn().mockResolvedValue(rows.length) },
    graveUsageRight: {
      findMany: vi
        .fn()
        .mockImplementation((args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            (args.where as { holderCustomerId?: unknown }).holderCustomerId === undefined
              ? []
              : owned,
          ),
        ),
    },
    burialRecord: { findMany: burialFindMany },
    gravePlot: { findMany: plotFindMany },
  } as unknown as PrismaService;

  const svc = new CustomersService(
    prisma,
    {} as unknown as PiiService,
    { record: vi.fn() } as unknown as AuditService,
    {
      visibleCompanyIdsFor: vi.fn().mockResolvedValue(null),
      assertCompanyFor: vi.fn().mockResolvedValue(undefined),
      assertSiteFor: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScopeService,
  );
  return { svc, burialFindMany, plotFindMany };
}

describe('nơi an nghỉ — quy chiếu đúng bảng', () => {
  /* CÁI BẪY, pin lại ở đây: `BurialRecord.deceasedPersonId` trỏ tới `DeceasedPerson`, KHÔNG
   * trỏ thẳng tới `Person`. Lọc bằng `{ deceasedPersonId: { in: personIds } }` thì truy vấn
   * CHẠY ĐƯỢC và luôn trả rỗng — không lỗi, không cảnh báo, chỉ là cột trống mãi. Phải đi
   * qua `deceased: { personId: ... }`. */
  it('lọc qua `deceased.personId`, KHÔNG qua `deceasedPersonId`', async () => {
    const { svc, burialFindMany } = build({ rows: [{ id: 'cus-1', personId: 'per-1' }] });

    await svc.search({}, CALLER);

    const where = burialFindMany.mock.calls[0]?.[0].where as Record<string, unknown>;
    expect(where.deceased).toEqual({ personId: { in: ['per-1'] } });
    expect(where.deceasedPersonId).toBeUndefined();
  });

  it('trả mã mộ KÈM cốt số, gắn đúng khách hàng', async () => {
    const { svc } = build({
      rows: [{ id: 'cus-1', personId: 'per-1' }],
      burials: [{ gravePlotId: 'plot-1', slotNumber: 2, personId: 'per-1' }],
    });

    const out = await svc.search({}, CALLER);

    expect(out.items[0]!.restingPlaces).toEqual([{ plotCode: 'P1', slotNumber: 2 }]);
  });

  it('gắn đúng người khi nhiều khách trong cùng một trang', async () => {
    const { svc } = build({
      rows: [
        { id: 'cus-1', personId: 'per-1' },
        { id: 'cus-2', personId: 'per-2' },
      ],
      burials: [{ gravePlotId: 'plot-2', slotNumber: 1, personId: 'per-2' }],
    });

    const out = await svc.search({}, CALLER);

    expect(out.items[0]!.restingPlaces).toEqual([]);
    expect(out.items[1]!.restingPlaces).toEqual([{ plotCode: 'P2', slotNumber: 1 }]);
  });

  /* Hai trục phải TÁCH. Một người vừa đứng tên P1 vừa được an táng ở P2 là chuyện có thật
   * (chủ mộ mất, mộ chưa sang tên), và gộp lại thì màn hình nói sai cả hai điều. */
  it('ĐỨNG TÊN và NẰM TRONG là hai trường riêng, không trộn vào nhau', async () => {
    const { svc } = build({
      rows: [{ id: 'cus-1', personId: 'per-1' }],
      owned: [{ holderCustomerId: 'cus-1', gravePlotId: 'plot-1' }],
      burials: [{ gravePlotId: 'plot-2', slotNumber: 1, personId: 'per-1' }],
    });

    const out = await svc.search({}, CALLER);

    expect(out.items[0]!.gravePlotCodes).toEqual(['P1']);
    expect(out.items[0]!.restingPlaces).toEqual([{ plotCode: 'P2', slotNumber: 1 }]);
  });

  /* MỘT truy vấn mã mộ cho CẢ HAI trục. Hỏi hai lượt là hai lượt cho cùng một bảng, và mã
   * mộ của một phần mộ không phụ thuộc vào việc ai hỏi nó. */
  it('chỉ MỘT lượt hỏi mã mộ, phủ cả hai trục', async () => {
    const { svc, plotFindMany } = build({
      rows: [{ id: 'cus-1', personId: 'per-1' }],
      owned: [{ holderCustomerId: 'cus-1', gravePlotId: 'plot-1' }],
      burials: [{ gravePlotId: 'plot-2', slotNumber: 1, personId: 'per-1' }],
    });

    await svc.search({}, CALLER);

    expect(plotFindMany).toHaveBeenCalledTimes(1);
    const ids = (plotFindMany.mock.calls[0]?.[0].where as { id: { in: string[] } }).id.in;
    expect([...ids].sort()).toEqual(['plot-1', 'plot-2']);
  });

  it('khách TỔ CHỨC (không có nhân thân) thì rỗng, không nổ', async () => {
    const { svc, burialFindMany } = build({ rows: [{ id: 'cus-1', personId: null }] });

    const out = await svc.search({}, CALLER);

    expect(out.items[0]!.restingPlaces).toEqual([]);
    // Không có nhân thân nào để hỏi thì đừng hỏi.
    expect(burialFindMany).not.toHaveBeenCalled();
  });

  /* Một người CHỈ nên nằm ở một chỗ, và `assertNotAlreadyBuried` ép đúng điều đó. Nhưng dữ
   * liệu cũ có thể đã lệch, và một màn hình rút xuống "lấy cái đầu tiên" sẽ giấu đúng cái
   * sai cần thấy. Nên trả MẢNG. */
  it('dữ liệu lệch — nằm ở hai mộ — thì trả CẢ HAI, không rút xuống một', async () => {
    const { svc } = build({
      rows: [{ id: 'cus-1', personId: 'per-1' }],
      burials: [
        { gravePlotId: 'plot-1', slotNumber: 1, personId: 'per-1' },
        { gravePlotId: 'plot-2', slotNumber: 3, personId: 'per-1' },
      ],
    });

    const out = await svc.search({}, CALLER);

    expect(out.items[0]!.restingPlaces).toHaveLength(2);
  });

  it('phần mộ đã biến mất thì bỏ qua dòng đó, không in "undefined"', async () => {
    const { svc } = build({
      rows: [{ id: 'cus-1', personId: 'per-1' }],
      burials: [{ gravePlotId: 'plot-mat-tich', slotNumber: 1, personId: 'per-1' }],
      plotCodes: {},
    });

    const out = await svc.search({}, CALLER);

    expect(out.items[0]!.restingPlaces).toEqual([]);
  });
});
